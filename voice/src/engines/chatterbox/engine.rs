//! Chatterbox Nano, speaking in cloned voices. Measured in `spikes/chatterbox`: with WebGPU the
//! speech-token loop is fastest on the CPU, and the speech encoder and decoder are fastest on the
//! GPU, so only those two run there. With CUDA everything runs on the GPU, and the loop keeps its
//! KV cache there between tokens, which is about 1.6 times faster than the WebGPU split. The model has no speed input, so speed is a WSOLA time
//! stretch of the finished audio. See DOCS/MEMORY.md, 2026-09-22.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use ort::ep::WebGPU;
use ort::session::Session;
use sha2::{Digest, Sha256};
use tokenizers::Tokenizer;

use super::pipeline::{Conditioning, Pipeline, Sessions};
use crate::cuda;
use crate::engines::inline::{self, Say};
use crate::engines::kitten::tokens::chunks;
use crate::engines::traits::{
    Acceleration, EngineCapabilities, Respelling, SynthesisRequest, SynthesisResult, TextTag, TtsEngine, TtsError,
    VoiceInfo,
};
use crate::pronunciations::Pronunciation;
use crate::voices;

pub const SAMPLE_RATE: u32 = 24_000;
/// Part of every cache key. Change it when the model files change, so old clips are not reused.
const MODEL_ID: &str = "owensong/chatterbox-nano-ONNX@4a66d7da q4f16";
/// Also part of every cache key. Change it when decoding changes, so old clips are not reused.
const DECODING: &str = "top-p 0.95 t0.8, stop floor";
/// Speech tokens come at about 25 a second, and English about 15 characters a second, so this
/// leaves roughly twice the time a sentence needs. It stops a line that never finds its end.
const TOKENS_PER_CHAR: usize = 3;
const MIN_TOKENS: usize = 40;
const MAX_TOKENS: usize = 1000;
/// Nano sometimes stops right after a sound tag, as if the line were over. So the stop token is
/// held back until there has been time for 1 token per spoken character (Nano speaks about 1.3 to
/// 1.6), plus about half a second for each sound tag.
const MIN_TOKENS_PER_CHAR: usize = 1;
const MIN_TOKENS_PER_SOUND: usize = 15;
const SPEED_RANGE: (f32, f32) = (0.5, 2.0);
/// Nano talks about 1.3 times as fast as Kokoro's Heart. The user picked 0.85 by ear as a natural
/// pace, so 1.0 plays the model's audio at 0.85.
const PACE: f32 = 0.85;

/// The tags in Nano's `tokenizer.json` (its added tokens), at the pinned revision.
const TAGS: &[TextTag] = &[
    TextTag { tag: "[laugh]", kind: "sound" },
    TextTag { tag: "[chuckle]", kind: "sound" },
    TextTag { tag: "[sigh]", kind: "sound" },
    TextTag { tag: "[gasp]", kind: "sound" },
    TextTag { tag: "[cough]", kind: "sound" },
    TextTag { tag: "[clear throat]", kind: "sound" },
    TextTag { tag: "[sniff]", kind: "sound" },
    TextTag { tag: "[groan]", kind: "sound" },
    TextTag { tag: "[shush]", kind: "sound" },
    TextTag { tag: "[crying]", kind: "sound" },
    TextTag { tag: "[happy]", kind: "style" },
    TextTag { tag: "[angry]", kind: "style" },
    TextTag { tag: "[sarcastic]", kind: "style" },
    TextTag { tag: "[surprised]", kind: "style" },
    TextTag { tag: "[fear]", kind: "style" },
    TextTag { tag: "[whispering]", kind: "style" },
    TextTag { tag: "[dramatic]", kind: "style" },
    TextTag { tag: "[narration]", kind: "style" },
    TextTag { tag: "[advertisement]", kind: "style" },
];

pub const TOKENIZER_FILE: &str = "tokenizer.json";
const ENCODER: &str = "onnx/speech_encoder_q4f16.onnx";
const EMBED: &str = "onnx/embed_tokens_fp16.onnx";
const LANGUAGE_MODEL: &str = "onnx/language_model_q4f16.onnx";
const DECODER: &str = "onnx/conditional_decoder_q4.onnx";
const GRAPHS: [&str; 4] = [ENCODER, EMBED, LANGUAGE_MODEL, DECODER];

pub struct ChatterboxEngine {
    dir: PathBuf,
    /// Where cloned voices are stored, outside the model folder.
    voices_dir: PathBuf,
    loaded: Option<Loaded>,
    pronunciations: Vec<Pronunciation>,
    gpu: bool,
    /// The CUDA plugin to try before WebGPU, when it is installed and turned on.
    cuda: Option<PathBuf>,
    fallback: Option<String>,
}

struct Loaded {
    pipeline: Pipeline,
    /// `cuda` or `webgpu` when the GPU is used, `None` on the CPU.
    provider: Option<&'static str>,
    /// Encoded voices, keyed by id and checked against the reference clip's hash.
    voices: HashMap<String, (String, Conditioning)>,
}

/// The model's token cap for one chunk of text.
fn max_tokens(chunk: &str) -> usize {
    (MIN_TOKENS + TOKENS_PER_CHAR * chunk.chars().count()).min(MAX_TOKENS)
}

/// The fewest speech tokens a chunk can end at. Tags are not counted as spoken characters.
fn min_tokens(chunk: &str) -> usize {
    let mut spoken = 0;
    let mut in_tag = false;
    for c in chunk.chars() {
        match c {
            '[' => in_tag = true,
            ']' => in_tag = false,
            _ if !in_tag => spoken += 1,
            _ => {}
        }
    }
    let sounds: usize = TAGS.iter().filter(|t| t.kind == "sound").map(|t| chunk.matches(t.tag).count()).sum();
    MIN_TOKENS_PER_CHAR * spoken + MIN_TOKENS_PER_SOUND * sounds
}

/// The sampling seed for one chunk in one voice, so the same line always sounds the same.
fn seed(reference_hash: &str, chunk: &str) -> u64 {
    let digest = Sha256::digest(format!("{reference_hash}\n{chunk}").as_bytes());
    u64::from_le_bytes(digest[..8].try_into().expect("a SHA-256 digest has 32 bytes"))
}

/// Swaps dictionary words for their sounds-like text, as whole words and ignoring case. "Narra's"
/// matches a "Narra" entry. Tags in brackets are left alone, and entries with only exact phonemes
/// are skipped, since Chatterbox reads text.
fn apply_words(text: &str, entries: &[Pronunciation]) -> String {
    let lookup = |word: &str| {
        let lower = word.to_lowercase();
        entries.iter().filter(|e| !e.sounds_like.is_empty()).find(|e| e.word.to_lowercase() == lower)
    };
    let is_word_char = |c: char| c.is_alphanumeric() || matches!(c, '\'' | '’' | '-');
    let mut out = String::with_capacity(text.len());
    let mut chars = text.char_indices().peekable();
    let mut in_tag = false;
    while let Some((start, c)) = chars.next() {
        if in_tag || !is_word_char(c) {
            in_tag = match c {
                '[' => true,
                ']' => false,
                _ => in_tag,
            };
            out.push(c);
            continue;
        }
        let mut end = start + c.len_utf8();
        while let Some(&(i, next)) = chars.peek().filter(|(_, next)| is_word_char(*next)) {
            end = i + next.len_utf8();
            chars.next();
        }
        let word = &text[start..end];
        let possessive = ["'s", "’s", "'S", "’S"].iter().find_map(|s| word.strip_suffix(s).map(|w| (w, &word[w.len()..])));
        match (lookup(word), possessive.and_then(|(w, s)| lookup(w).map(|e| (e, s)))) {
            (Some(entry), _) => out.push_str(&entry.sounds_like),
            (None, Some((entry, suffix))) => {
                out.push_str(&entry.sounds_like);
                out.push_str(suffix);
            }
            _ => out.push_str(word),
        }
    }
    out
}

/// Chatterbox reads text, not phonemes, so a `[word](sounds like)` mark is read as its
/// respelling, and a mark with exact phonemes as the plain word. Marks win over the dictionary.
fn resolve_marks(text: &str, entries: &[Pronunciation]) -> String {
    let marked = inline::parse(text);
    let text = apply_words(&marked.text, entries);
    marked.marks.iter().rev().fold(text, |out, mark| {
        let said = match &mark.say {
            Say::SoundsLike(sounds) => sounds.as_str(),
            Say::Phonemes(_) => mark.word.as_str(),
        };
        out.replace(&mark.placeholder, said)
    })
}

/// The chunks Chatterbox speaks one at a time: a sentence each, like Kitten.
/// Line breaks and runs of spaces become single spaces first, as Kokoro and Kitten do, so a
/// segment of several paragraphs never sends the tokenizer newlines.
fn request_chunks(request: &SynthesisRequest, entries: &[Pronunciation]) -> Result<Vec<String>, TtsError> {
    let text = resolve_marks(request.text.trim(), entries).split_whitespace().collect::<Vec<_>>().join(" ");
    let pieces = chunks(&text);
    if pieces.is_empty() {
        return Err(TtsError::EmptyText);
    }
    Ok(pieces)
}

/// How fast the finished audio plays, relative to the model's own pace.
fn tempo(speed: Option<f32>) -> f32 {
    speed.unwrap_or(1.0).clamp(SPEED_RANGE.0, SPEED_RANGE.1) * PACE
}

/// Changes the pace without changing the pitch.
fn stretch(samples: Vec<f32>, tempo: f32) -> Result<Vec<f32>, TtsError> {
    if (tempo - 1.0).abs() < 1e-3 || samples.is_empty() {
        return Ok(samples);
    }
    wsola::stretch(&samples, SAMPLE_RATE, 1, tempo).map_err(|e| TtsError::Inference(format!("time stretch failed: {e}")))
}

/// The first line of a provider error, cut to fit on the Settings page.
fn first_line(reason: &str) -> String {
    reason.lines().next().unwrap_or(reason).chars().take(240).collect()
}

fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

impl ChatterboxEngine {
    pub fn new(dir: PathBuf, voices_dir: PathBuf) -> Self {
        Self { dir, voices_dir, loaded: None, pronunciations: Vec::new(), gpu: false, cuda: None, fallback: None }
    }

    fn session(&self, path: &str, gpu: bool) -> Result<Session, String> {
        let mut builder = Session::builder().map_err(|e| e.to_string())?;
        if gpu {
            builder = builder
                .with_execution_providers([WebGPU::default().build().error_on_failure()])
                .map_err(|e| e.to_string())?;
        }
        builder.commit_from_file(self.dir.join(path)).map_err(|e| e.to_string())
    }

    /// Every graph on CUDA when that is set and works. Otherwise the encoder and decoder on WebGPU
    /// when the GPU is on and works, and everything else on the CPU. A GPU failure is kept in
    /// `fallback` for Settings rather than failing the load.
    fn open_sessions(&mut self) -> Result<(Sessions, Option<&'static str>), TtsError> {
        self.fallback = None;
        if let Some(plugin) = self.cuda.as_ref().filter(|_| self.gpu) {
            let on_cuda = |path: &str| {
                cuda::builder(plugin).and_then(|mut b| b.commit_from_file(self.dir.join(path)).map_err(|e| e.to_string()))
            };
            let sessions = (|| {
                Ok::<_, String>(Sessions {
                    encoder: on_cuda(ENCODER)?,
                    embed: on_cuda(EMBED)?,
                    lm: on_cuda(LANGUAGE_MODEL)?,
                    decoder: on_cuda(DECODER)?,
                })
            })();
            match sessions {
                Ok(sessions) => return Ok((sessions, Some("cuda"))),
                Err(reason) => {
                    eprintln!("Chatterbox could not use CUDA, so it tries WebGPU: {reason}");
                    self.fallback = Some(format!("CUDA could not be used: {}", first_line(&reason)));
                }
            }
        }
        let (mut encoder, mut decoder, mut provider) = (None, None, None);
        if self.gpu {
            match self.session(ENCODER, true).and_then(|e| Ok((e, self.session(DECODER, true)?))) {
                Ok((e, d)) => {
                    cuda::note_webgpu();
                    (encoder, decoder, provider) = (Some(e), Some(d), Some("webgpu"));
                }
                Err(reason) => {
                    eprintln!("Chatterbox could not use the GPU, so it runs on the CPU: {reason}");
                    self.fallback = Some(first_line(&reason));
                }
            }
        }
        let cpu = |path: &str| self.session(path, false).map_err(TtsError::Load);
        let sessions = Sessions {
            encoder: match encoder {
                Some(e) => e,
                None => cpu(ENCODER)?,
            },
            decoder: match decoder {
                Some(d) => d,
                None => cpu(DECODER)?,
            },
            embed: cpu(EMBED)?,
            lm: cpu(LANGUAGE_MODEL)?,
        };
        Ok((sessions, provider))
    }

    /// The voice to use: the one asked for, or the first one when none is.
    fn resolve_voice(&self, requested: Option<&str>) -> Result<String, TtsError> {
        match requested.filter(|id| !id.is_empty()) {
            Some(id) if voices::exists(&self.voices_dir, id) => Ok(id.to_string()),
            Some(id) => Err(TtsError::UnknownVoice(id.to_string())),
            None => voices::list(&self.voices_dir).into_iter().next().map(|v| v.id).ok_or(TtsError::NoVoices),
        }
    }

    fn reference_hash(&self, voice: &str) -> Result<String, TtsError> {
        let path = voices::reference_path(&self.voices_dir, voice);
        std::fs::read(&path).map(|bytes| hash(&bytes)).map_err(|e| TtsError::Load(format!("reading {}: {e}", path.display())))
    }
}

impl TtsEngine for ChatterboxEngine {
    fn id(&self) -> &'static str {
        "chatterbox"
    }

    fn display_name(&self) -> &'static str {
        "Chatterbox"
    }

    fn tier(&self) -> &'static str {
        "Advanced"
    }

    /// There are no built-in voices, so a request without one uses the first saved voice.
    fn default_voice(&self) -> &'static str {
        ""
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            built_in_voices: false,
            voice_cloning: true,
            multilingual: false,
            speed_control: true,
            expression_control: false,
            streaming: false,
            phoneme_input: false,
        }
    }

    fn model_dir(&self) -> &Path {
        &self.dir
    }

    fn required_files(&self) -> Vec<String> {
        GRAPHS
            .iter()
            .flat_map(|g| [g.to_string(), format!("{g}_data")])
            .chain([TOKENIZER_FILE.to_string()])
            .collect()
    }

    fn missing_files(&self) -> Vec<String> {
        self.required_files().into_iter().filter(|f| !self.dir.join(f).is_file()).collect()
    }

    fn voices(&self) -> Vec<VoiceInfo> {
        voices::list(&self.voices_dir)
            .into_iter()
            .map(|v| VoiceInfo { id: v.id, name: v.meta.name, accent: None, gender: None })
            .collect()
    }

    fn is_loaded(&self) -> bool {
        self.loaded.is_some()
    }

    fn load(&mut self) -> Result<(), TtsError> {
        if self.loaded.is_some() {
            return Ok(());
        }
        let missing = self.missing_files();
        if !missing.is_empty() {
            return Err(TtsError::MissingFiles(missing));
        }
        let tokenizer = Tokenizer::from_file(self.dir.join(TOKENIZER_FILE)).map_err(|e| TtsError::Load(e.to_string()))?;
        let (sessions, provider) = self.open_sessions()?;
        // On CUDA the KV cache stays in GPU memory between tokens.
        let pipeline = Pipeline::new(sessions, tokenizer, provider == Some("cuda"))?;
        self.loaded = Some(Loaded { pipeline, provider, voices: HashMap::new() });
        Ok(())
    }

    fn unload(&mut self) {
        self.loaded = None;
    }

    /// `speed` is applied afterwards as a time stretch, times `PACE`.
    fn synthesize(&mut self, request: SynthesisRequest) -> Result<SynthesisResult, TtsError> {
        let voice = self.resolve_voice(request.voice_id.as_deref())?;
        let pieces = request_chunks(&request, &self.pronunciations)?;
        let reference_hash = self.reference_hash(&voice)?;
        self.load()?;
        let loaded = self.loaded.as_mut().expect("engine was just loaded");

        if loaded.voices.get(&voice).is_none_or(|(h, _)| *h != reference_hash) {
            let audio = voices::read_reference(&self.voices_dir, &voice).map_err(TtsError::Load)?;
            let conditioning = loaded.pipeline.condition(&audio)?;
            loaded.voices.insert(voice.clone(), (reference_hash.clone(), conditioning));
        }
        let (_, conditioning) = &loaded.voices[&voice];

        let mut samples = Vec::new();
        for piece in &pieces {
            let seed = seed(&reference_hash, piece);
            samples.extend(loaded.pipeline.speak(conditioning, piece, min_tokens(piece), max_tokens(piece), seed)?);
        }
        Ok(SynthesisResult { samples: stretch(samples, tempo(request.speed))?, sample_rate: SAMPLE_RATE })
    }

    /// Keyed on the exact text spoken and the reference clip, so replacing a voice's clip or
    /// changing a mark makes new audio. It does not need the model loaded.
    fn cache_key(&mut self, request: &SynthesisRequest) -> Result<String, TtsError> {
        let voice = self.resolve_voice(request.voice_id.as_deref())?;
        let pieces = request_chunks(request, &self.pronunciations)?;
        let input = format!(
            "chatterbox\n{MODEL_ID}\n{DECODING}\n{voice}\n{}\n{:.3}\n{}",
            self.reference_hash(&voice)?,
            tempo(request.speed),
            pieces.join("\n")
        );
        Ok(hash(input.as_bytes()))
    }

    /// Applied as text: each word is swapped for its sounds-like spelling before tokenizing.
    fn set_pronunciations(&mut self, entries: Vec<Pronunciation>) -> Result<(), TtsError> {
        self.pronunciations = entries;
        Ok(())
    }

    fn pronunciations(&self) -> &[Pronunciation] {
        &self.pronunciations
    }

    /// Chatterbox reads the respelling as it is, so it only checks there is one. It knows every
    /// word, so nothing is spelled out.
    fn respell(&mut self, sounds_like: &str) -> Result<Respelling, TtsError> {
        let text = sounds_like.trim();
        if text.is_empty() {
            return Err(TtsError::EmptyText);
        }
        Ok(Respelling { phonemes: text.to_string(), unknown_words: Vec::new() })
    }

    fn tags(&self) -> &'static [TextTag] {
        TAGS
    }

    fn acceleration(&self) -> Option<Acceleration> {
        Some(Acceleration {
            enabled: self.gpu,
            active: self.loaded.as_ref().map(|l| if l.provider.is_some() { "gpu" } else { "cpu" }),
            provider: self.loaded.as_ref().and_then(|l| l.provider),
            fallback: self.fallback.clone(),
        })
    }

    fn set_gpu(&mut self, enabled: bool) {
        if enabled != self.gpu {
            self.gpu = enabled;
            self.fallback = None;
            self.loaded = None;
        }
    }

    fn set_cuda(&mut self, plugin: Option<PathBuf>) {
        if plugin != self.cuda {
            self.cuda = plugin;
            self.fallback = None;
            self.loaded = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(text: &str) -> SynthesisRequest {
        SynthesisRequest { text: text.into(), voice_id: None, speed: None, phonemes: None }
    }

    fn entry(word: &str, sounds_like: &str) -> Pronunciation {
        Pronunciation { word: word.into(), sounds_like: sounds_like.into(), phonemes: None }
    }

    #[test]
    fn marks_are_read_as_their_respelling() {
        assert_eq!(resolve_marks("I [read](red) it and [read](/ɹˈid/) it.", &[]), "I red it and read it.");
        assert_eq!(resolve_marks("Oh [chuckle] fine.", &[]), "Oh [chuckle] fine.");
    }

    #[test]
    fn dictionary_words_are_swapped_as_whole_words() {
        let words = [entry("Narra", "vox see"), entry("laugh", "laff"), entry("Nguyen", "win"), Pronunciation {
            word: "Kai".into(),
            sounds_like: String::new(),
            phonemes: Some("kˈI".into()),
        }];
        assert_eq!(
            resolve_marks("NARRA and Narra's app. Narras stays. [laugh] I laugh.", &words),
            "vox see and vox see's app. Narras stays. [laugh] I laff."
        );
        assert_eq!(resolve_marks("Mr. Nguyen-Smith met Nguyen.", &words), "Mr. Nguyen-Smith met win.");
        // Phoneme-only entries do nothing here, and a mark wins over the dictionary.
        assert_eq!(resolve_marks("Kai said [Narra](vocks ee).", &words), "Kai said vocks ee.");
    }

    #[test]
    fn tags_match_the_tokenizer() {
        assert_eq!(TAGS.len(), 19);
        assert!(TAGS.iter().all(|t| t.tag.starts_with('[') && t.tag.ends_with(']') && matches!(t.kind, "sound" | "style")));
    }

    #[test]
    fn text_is_spoken_a_sentence_at_a_time() {
        let pieces = request_chunks(&request("Dr. Lee is here. [laugh] Is that so? Yes"), &[]).unwrap();
        assert_eq!(pieces, ["Dr. Lee is here.", "[laugh] Is that so?", "Yes,"]);
        assert!(matches!(request_chunks(&request("   "), &[]), Err(TtsError::EmptyText)));
        let packed = request_chunks(&request("Chapter One.\n\nIt was  late.\nVery late."), &[]).unwrap();
        assert_eq!(packed, ["Chapter One.", "It was late.", "Very late."]);
    }

    #[test]
    fn token_cap_grows_with_the_text_and_stops_at_the_limit() {
        assert_eq!(max_tokens("Hi."), MIN_TOKENS + 9);
        assert!(max_tokens(&"a".repeat(100)) > 300);
        assert_eq!(max_tokens(&"a".repeat(1000)), MAX_TOKENS);
    }

    #[test]
    fn stop_floor_counts_spoken_characters_and_sound_tags() {
        assert_eq!(min_tokens("You know what never mind."), 25);
        // The tag's letters do not count, but the sound gets its own time. Styles get none.
        assert_eq!(min_tokens("You know what [sigh] never mind."), 26 + MIN_TOKENS_PER_SOUND);
        assert_eq!(min_tokens("[whispering] Hi there."), 10);
        assert_eq!(min_tokens("[clear throat] Hi. [clear throat]"), 5 + 2 * MIN_TOKENS_PER_SOUND);
        // Each tag raises the cap by more than it raises the floor, so the floor stays under it.
        assert!(TAGS.iter().all(|t| TOKENS_PER_CHAR * t.tag.len() > MIN_TOKENS_PER_SOUND));
    }

    #[test]
    fn seed_follows_the_voice_and_the_text() {
        assert_eq!(seed("abc", "Hi."), seed("abc", "Hi."));
        assert_ne!(seed("abc", "Hi."), seed("abd", "Hi."));
        assert_ne!(seed("abc", "Hi."), seed("abc", "Hi!"));
    }

    #[test]
    fn speed_is_a_stretch_at_the_natural_pace() {
        assert!((tempo(None) - PACE).abs() < 1e-6);
        assert!((tempo(Some(0.1)) - SPEED_RANGE.0 * PACE).abs() < 1e-6);
        assert!((tempo(Some(1.3)) - 1.3 * PACE).abs() < 1e-6);
        let second = vec![0.1f32; SAMPLE_RATE as usize];
        let slower = stretch(second.clone(), 0.85).unwrap();
        assert!((slower.len() as f32 / SAMPLE_RATE as f32 - 1.0 / 0.85).abs() < 0.02, "{}", slower.len());
        assert_eq!(stretch(second.clone(), 1.0).unwrap().len(), second.len());
    }

    #[test]
    fn needs_a_saved_voice() {
        let dir = std::env::temp_dir().join(format!("narra-chatterbox-voices-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut engine = ChatterboxEngine::new(PathBuf::from("unused"), dir.clone());
        assert!(matches!(engine.cache_key(&request("Hello.")), Err(TtsError::NoVoices)));

        let id = voices::create(&dir, "Test", "test", &[0.1; 2400], false).unwrap();
        let key = engine.cache_key(&request("Hello.")).unwrap();
        assert_eq!(engine.cache_key(&SynthesisRequest { voice_id: Some(id), ..request("Hello.") }).unwrap(), key);
        assert_ne!(engine.cache_key(&request("Hello there.")).unwrap(), key);
        assert_ne!(engine.cache_key(&SynthesisRequest { speed: Some(1.2), ..request("Hello.") }).unwrap(), key);
        assert!(matches!(
            engine.cache_key(&SynthesisRequest { voice_id: Some("vmissing".into()), ..request("Hello.") }),
            Err(TtsError::UnknownVoice(_))
        ));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Runs the real model. Point `NARRA_CHATTERBOX_DIR` at a folder laid out like the app's
    /// model folder, for example `spikes/chatterbox/models/nano`, and `NARRA_CHATTERBOX_VOICE` at a
    /// 24 kHz mono WAV of someone speaking. A reference without speech makes almost no audio.
    #[test]
    #[ignore = "needs Chatterbox model files, a reference clip, and a GPU"]
    fn speaks_in_a_saved_voice() {
        let dir = PathBuf::from(std::env::var("NARRA_CHATTERBOX_DIR").expect("set NARRA_CHATTERBOX_DIR"));
        let clip = PathBuf::from(std::env::var("NARRA_CHATTERBOX_VOICE").expect("set NARRA_CHATTERBOX_VOICE"));
        let voices_dir = std::env::temp_dir().join(format!("narra-chatterbox-real-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&voices_dir);
        let speech: Vec<f32> = hound::WavReader::open(clip).unwrap().samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
        voices::create(&voices_dir, "Reference", "test", &speech, true).unwrap();

        let mut engine = ChatterboxEngine::new(dir, voices_dir.clone());
        assert!(engine.missing_files().is_empty(), "missing: {:?}", engine.missing_files());
        let result = engine.synthesize(request("This is a quick test. It has two sentences.")).unwrap();
        let seconds = result.samples.len() as f32 / SAMPLE_RATE as f32;
        assert!((1.0..20.0).contains(&seconds), "{seconds:.1}s of audio");
        assert!(result.samples.iter().all(|s| s.is_finite()));

        // With the GPU on, the encoder and decoder move to WebGPU and the words stay the same.
        engine.set_gpu(true);
        let on_gpu = engine.synthesize(request("This is a quick test. It has two sentences.")).unwrap();
        let acceleration = engine.acceleration().unwrap();
        assert_eq!(acceleration.active, Some("gpu"), "fell back: {:?}", acceleration.fallback);
        let gpu_seconds = on_gpu.samples.len() as f32 / SAMPLE_RATE as f32;
        assert!((gpu_seconds - seconds).abs() < 0.5, "{gpu_seconds:.1}s on the GPU, {seconds:.1}s on the CPU");
        std::fs::remove_dir_all(&voices_dir).unwrap();
    }

    /// Like `speaks_in_a_saved_voice`, on CUDA with the KV cache kept on the GPU. Also needs
    /// `NARRA_CUDA_PLUGIN` at `libonnxruntime_providers_cuda.so`, CUDA 13, and cuDNN 9.
    #[test]
    #[ignore = "needs Chatterbox model files, a reference clip, the CUDA plugin, and an NVIDIA GPU"]
    fn speaks_on_cuda() {
        let dir = PathBuf::from(std::env::var("NARRA_CHATTERBOX_DIR").expect("set NARRA_CHATTERBOX_DIR"));
        let clip = PathBuf::from(std::env::var("NARRA_CHATTERBOX_VOICE").expect("set NARRA_CHATTERBOX_VOICE"));
        let plugin = PathBuf::from(std::env::var("NARRA_CUDA_PLUGIN").expect("set NARRA_CUDA_PLUGIN"));
        let voices_dir = std::env::temp_dir().join(format!("narra-chatterbox-cuda-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&voices_dir);
        let speech: Vec<f32> = hound::WavReader::open(clip).unwrap().samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
        voices::create(&voices_dir, "Reference", "test", &speech, true).unwrap();

        let mut engine = ChatterboxEngine::new(dir, voices_dir.clone());
        engine.set_gpu(true);
        engine.set_cuda(Some(plugin));
        let result = engine.synthesize(request("This is a quick test. It has two sentences.")).unwrap();
        let acceleration = engine.acceleration().unwrap();
        assert_eq!(acceleration.provider, Some("cuda"), "fell back: {:?}", acceleration.fallback);
        let seconds = result.samples.len() as f32 / SAMPLE_RATE as f32;
        assert!((1.0..20.0).contains(&seconds), "{seconds:.1}s of audio");
        assert!(result.samples.iter().all(|s| s.is_finite()));
        std::fs::remove_dir_all(&voices_dir).unwrap();
    }
}
