//! Chatterbox Nano's four ONNX graphs, from the model card's Python and `spikes/chatterbox`:
//! the speech encoder turns a reference clip into conditioning, the language model generates
//! speech tokens one at a time from embedded text, and the conditional decoder turns the tokens
//! into a 24 kHz waveform.

use std::collections::HashSet;

use half::f16;
use ort::memory::{AllocationDevice, AllocatorType, MemoryInfo, MemoryType};
use ort::session::{Session, SessionInputValue, SessionOutputs};
use ort::value::{DynValue, Tensor, TensorElementType, ValueType};
use tokenizers::Tokenizer;

use crate::engines::traits::TtsError;

const START_SPEECH: i64 = 6561;
const STOP_SPEECH: i64 = 6562;
/// The decoder gets three of these after the speech tokens, so the audio does not end abruptly.
const SILENCE: i64 = 4299;
const REPETITION_PENALTY: f32 = 1.2;
/// Sampling settings from the model card's `run_onnx.py`. Greedy decoding got stuck on silence
/// tokens after some sound tags, so the line went quiet until the token cap.
const TEMPERATURE: f64 = 0.8;
const TOP_P: f64 = 0.95;

fn infer<E: std::fmt::Display>(e: E) -> TtsError {
    TtsError::Inference(e.to_string())
}

fn missing(name: &str) -> TtsError {
    TtsError::Inference(format!("the model gave no {name}"))
}

/// One language model step's output: the new KV cache, then the logits with their shape.
type Step = (Vec<DynValue>, (Vec<usize>, Vec<f32>));

pub struct Sessions {
    pub encoder: Session,
    pub embed: Session,
    pub lm: Session,
    pub decoder: Session,
}

pub struct Pipeline {
    sessions: Sessions,
    tokenizer: Tokenizer,
    /// `past_key_values.*` input names, and the matching `present.*` output names.
    past: Vec<String>,
    present: Vec<String>,
    kv_type: TensorElementType,
    kv_heads: usize,
    head_dim: usize,
    /// Keep the KV cache in CUDA memory between tokens (IoBinding), so only the logits come back
    /// to the CPU. Otherwise the whole cache comes back after every token.
    kv_on_cuda: bool,
}

/// A reference voice, encoded once and reused for every line in it.
pub struct Conditioning {
    embeddings: (usize, Vec<f32>),
    prompt_tokens: Vec<i64>,
    speaker_embeddings: DynValue,
    speaker_features: DynValue,
}

impl Pipeline {
    pub fn new(sessions: Sessions, tokenizer: Tokenizer, kv_on_cuda: bool) -> Result<Self, TtsError> {
        let past: Vec<String> =
            sessions.lm.inputs().iter().map(|i| i.name().to_string()).filter(|n| n.starts_with("past_key_values.")).collect();
        let first = sessions.lm.inputs().iter().find(|i| Some(i.name()) == past.first().map(String::as_str));
        let Some(ValueType::Tensor { ty, shape, .. }) = first.map(|i| i.dtype()) else {
            return Err(TtsError::Load("the language model has no KV cache inputs".into()));
        };
        Ok(Self {
            present: past.iter().map(|n| n.replace("past_key_values.", "present.")).collect(),
            kv_type: *ty,
            kv_heads: shape[1] as usize,
            head_dim: shape[3] as usize,
            kv_on_cuda,
            past,
            sessions,
            tokenizer,
        })
    }

    /// Encodes a 24 kHz mono reference clip.
    pub fn condition(&mut self, audio: &[f32]) -> Result<Conditioning, TtsError> {
        let input = Tensor::from_array(([1usize, audio.len()], audio.to_vec())).map_err(infer)?;
        let mut out = self.sessions.encoder.run(vec![("audio_values", SessionInputValue::from(input))]).map_err(infer)?;
        let (shape, embeddings) = read_f32(out.get("audio_features").ok_or_else(|| missing("audio features"))?)?;
        let (_, tokens) = out.get("audio_tokens").ok_or_else(|| missing("audio tokens"))?.try_extract_tensor::<i64>().map_err(infer)?;
        Ok(Conditioning {
            embeddings: (shape[2], embeddings),
            prompt_tokens: tokens.to_vec(),
            speaker_embeddings: out.remove("speaker_embeddings").ok_or_else(|| missing("speaker embeddings"))?,
            speaker_features: out.remove("speaker_features").ok_or_else(|| missing("speaker features"))?,
        })
    }

    fn embed(&mut self, ids: &[i64]) -> Result<Vec<f32>, TtsError> {
        let input = Tensor::from_array(([1usize, ids.len()], ids.to_vec())).map_err(infer)?;
        let out = self.sessions.embed.run(vec![("input_ids", SessionInputValue::from(input))]).map_err(infer)?;
        Ok(read_f32(out.get("inputs_embeds").ok_or_else(|| missing("embeddings"))?)?.1)
    }

    /// Speaks `text` in the conditioned voice. Tokens are sampled with the model card's settings
    /// from a generator seeded with `seed`, so the same input and seed always give the same audio.
    /// The stop token is held back for the first `min_tokens` speech tokens (about 25 a second),
    /// and generation ends at `max_tokens` even without one.
    pub fn speak(
        &mut self,
        voice: &Conditioning,
        text: &str,
        min_tokens: usize,
        max_tokens: usize,
        seed: u64,
    ) -> Result<Vec<f32>, TtsError> {
        let encoding = self.tokenizer.encode(text, true).map_err(infer)?;
        let ids: Vec<i64> = encoding.get_ids().iter().map(|&i| i as i64).collect();
        if ids.is_empty() {
            return Err(TtsError::EmptyText);
        }

        // Step 0 sees the voice conditioning, then the text. Every later step sees one new token.
        let (hidden, conditioning) = &voice.embeddings;
        let mut embeds = conditioning.clone();
        embeds.extend(self.embed(&ids)?);
        let mut seq = embeds.len() / hidden;
        let mut positions: Vec<i64> = (0..seq as i64).collect();
        let mut past: Vec<DynValue> = self.past.iter().map(|_| self.empty_kv()).collect::<Result<_, _>>()?;

        let mut generated = vec![START_SPEECH];
        let mut rng = Rng(seed);
        // The attention mask covers everything so far, one more token each step.
        for attention in (seq..).take(max_tokens) {
            let mut inputs: Vec<(String, SessionInputValue)> = vec![
                ("inputs_embeds".into(), Tensor::from_array(([1usize, seq, *hidden], embeds)).map_err(infer)?.into()),
                ("attention_mask".into(), Tensor::from_array(([1usize, attention], vec![1i64; attention])).map_err(infer)?.into()),
                ("position_ids".into(), Tensor::from_array(([1usize, positions.len()], positions.clone())).map_err(infer)?.into()),
            ];
            inputs.extend(self.past.iter().cloned().zip(past.drain(..).map(SessionInputValue::from)));
            let (next_past, (shape, logits)) = self.run_lm(inputs)?;
            past = next_past;

            let vocab = shape[2];
            let mut last = logits[(shape[1] - 1) * vocab..].to_vec();
            for &token in generated.iter().collect::<HashSet<_>>() {
                let score = &mut last[token as usize];
                *score = if *score < 0.0 { *score * REPETITION_PENALTY } else { *score / REPETITION_PENALTY };
            }
            if generated.len() <= min_tokens {
                last[STOP_SPEECH as usize] = f32::NEG_INFINITY;
            }
            let next = sample(&last, rng.next()) as i64;
            if next == STOP_SPEECH {
                break;
            }
            generated.push(next);

            let position = positions[positions.len() - 1] + 1;
            embeds = self.embed(&[next])?;
            seq = 1;
            positions = vec![position];
        }

        let mut tokens = voice.prompt_tokens.clone();
        tokens.extend(&generated[1..]);
        tokens.extend([SILENCE; 3]);
        let out = self
            .sessions
            .decoder
            .run(vec![
                ("speech_tokens", SessionInputValue::from(Tensor::from_array(([1usize, tokens.len()], tokens)).map_err(infer)?)),
                ("speaker_embeddings", (&voice.speaker_embeddings).into()),
                ("speaker_features", (&voice.speaker_features).into()),
            ])
            .map_err(infer)?;
        Ok(read_f32(out.get("waveform").ok_or_else(|| missing("waveform"))?)?.1)
    }

    /// One step of the language model: the new KV cache and the logits. With `kv_on_cuda`, only
    /// the logits come back to the CPU, and the cache stays in CUDA memory for the next step.
    fn run_lm(&mut self, inputs: Vec<(String, SessionInputValue)>) -> Result<Step, TtsError> {
        let take = |mut out: SessionOutputs<'_>, present: &[String]| {
            let past = present.iter().map(|n| out.remove(n).ok_or_else(|| missing(n))).collect::<Result<_, _>>()?;
            Ok((past, read_f32(out.get("logits").ok_or_else(|| missing("logits"))?)?))
        };
        if !self.kv_on_cuda {
            let out = self.sessions.lm.run(inputs).map_err(infer)?;
            return take(out, &self.present);
        }
        let mut binding = self.sessions.lm.create_binding().map_err(infer)?;
        for (name, value) in inputs {
            match value {
                SessionInputValue::Owned(v) => binding.bind_input(name, &v).map_err(infer)?,
                _ => unreachable!("every language model input is owned"),
            }
        }
        let memory = |device| MemoryInfo::new(device, 0, AllocatorType::Device, MemoryType::Default).map_err(infer);
        binding.bind_output_to_device("logits", &memory(AllocationDevice::CPU)?).map_err(infer)?;
        let on_cuda = memory(AllocationDevice::CUDA)?;
        for name in &self.present {
            binding.bind_output_to_device(name, &on_cuda).map_err(infer)?;
        }
        let out = self.sessions.lm.run_binding(&binding).map_err(infer)?;
        take(out, &self.present)
    }

    fn empty_kv(&self) -> Result<DynValue, TtsError> {
        let shape = [1usize, self.kv_heads, 0, self.head_dim];
        Ok(match self.kv_type {
            TensorElementType::Float16 => Tensor::<f16>::from_array((shape, Vec::new())).map_err(infer)?.into_dyn(),
            _ => Tensor::<f32>::from_array((shape, Vec::new())).map_err(infer)?.into_dyn(),
        })
    }
}

/// Picks a token from the smallest set of likeliest ones that together hold `TOP_P` of the
/// probability, after scaling by `TEMPERATURE`. `roll` is uniform in [0, 1).
fn sample(logits: &[f32], roll: f64) -> usize {
    let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut weights: Vec<(usize, f64)> =
        logits.iter().enumerate().map(|(i, &l)| (i, (f64::from(l - max) / TEMPERATURE).exp())).collect();
    weights.sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let total: f64 = weights.iter().map(|w| w.1).sum();
    let mut kept = 0.0;
    let mut count = 0;
    for &(_, weight) in &weights {
        kept += weight;
        count += 1;
        if kept >= TOP_P * total {
            break;
        }
    }
    let mut target = roll * kept;
    for &(token, weight) in &weights[..count] {
        if target < weight {
            return token;
        }
        target -= weight;
    }
    weights[count - 1].0
}

/// SplitMix64. Written out here instead of taken from a crate, so a dependency update can never
/// change the numbers and make cached clips differ from fresh ones.
struct Rng(u64);

impl Rng {
    /// Uniform in [0, 1).
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// A float output as f32, with its shape.
fn read_f32(value: &DynValue) -> Result<(Vec<usize>, Vec<f32>), TtsError> {
    if let Ok((shape, data)) = value.try_extract_tensor::<f32>() {
        return Ok((shape.iter().map(|d| *d as usize).collect(), data.to_vec()));
    }
    let (shape, data) = value.try_extract_tensor::<f16>().map_err(infer)?;
    Ok((shape.iter().map(|d| *d as usize).collect(), data.iter().map(|x| x.to_f32()).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sampling_keeps_to_the_likeliest_tokens() {
        // Token 2 alone holds far more than 95% of the probability, so it is always picked.
        let logits = [0.0, 1.0, 20.0, 0.5];
        assert!((0..20).all(|i| sample(&logits, i as f64 / 20.0) == 2));
        // Two equal tokens split the rolls between them, and the unlikely one never comes up.
        let logits = [10.0, 10.0, -10.0];
        assert_eq!(sample(&logits, 0.1), 0);
        assert_eq!(sample(&logits, 0.9), 1);
        // A token set to minus infinity, like a held-back stop token, is never picked.
        let logits = [f32::NEG_INFINITY, 0.0];
        assert!((0..20).all(|i| sample(&logits, i as f64 / 20.0) == 1));
    }

    #[test]
    fn the_generator_repeats_for_the_same_seed() {
        let rolls = |seed| {
            let mut rng = Rng(seed);
            (0..5).map(|_| rng.next()).collect::<Vec<_>>()
        };
        assert_eq!(rolls(7), rolls(7));
        assert_ne!(rolls(7), rolls(8));
        assert!(rolls(7).iter().all(|r| (0.0..1.0).contains(r)));
    }
}
