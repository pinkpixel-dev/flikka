// Narration voices and speech-to-text on Linux with CUDA: Kokoro's voices, your own (lib/cloning.mjs, Chatterbox),
// and faster-whisper. Your voices live in the voices folder (~/.flikka/voices unless Settings says otherwise).
import fs from 'node:fs/promises';
import path from 'node:path';
import {cacheDir, run, python, setting} from './common.mjs';
import {cleanVoice} from './clean.mjs';
import {kokoroVoices, kokoroLanguages, voiceLanguage} from './kokoro.mjs';
import {findOwnVoice, speakCloned, ownVoices, saveOwnVoice, removeOwnVoice} from './cloning.mjs';
import {kokoroText} from './marks.mjs';

// Read aloud while recording: varied sounds, a number, a product-demo tone.
export const script = `Hi, I'm going to show you something I built. It records the screen, cuts the boring parts,
and turns it into a short video in about two minutes. Let's open the dashboard and look at the numbers.`;

// Kokoro neural TTS helper for Linux + CUDA.
const ttsHelper = `
import json, sys
import soundfile as sf
import numpy as np
from kokoro import KPipeline

job = json.loads(sys.argv[1])
lang = job.get("lang", "a")
speed = float(job.get("speed", 1.0))
pipeline = KPipeline(lang_code=lang)
voice_name = job.get("voice", "af_heart")
for line in job["lines"]:
    generator = pipeline(line["text"], voice=voice_name, speed=speed)
    chunks = [audio for _, _, audio in generator]
    if chunks:
        audio = np.concatenate(chunks)
        sf.write(line["out"], audio, 24000)
`;

// lines: [{text, out}]. One of your voices goes to Chatterbox (lib/cloning.mjs); a Kokoro voice uses Kokoro with
// CUDA, which reads the text with the voice's own language (its first letter), so bf_emma pronounces like a British
// speaker and ff_siwis reads French.
export async function speakAs(voice, lines, speed = 1.0) {
  const name = voice || setting('voice'), lang = voiceLanguage(name);
  if (!lang && findOwnVoice(name)) return speakCloned(name, lines, speed);
  if (!lang) throw new Error(`There's no voice "${name}". flikka voice list shows Kokoro's and yours, e.g. af_heart or bf_emma`);
  const file = path.join(cacheDir, 'flikka_tts.py');
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, ttsHelper);
  // Japanese and Mandarin need their own text-to-sound packages (misaki[ja], misaki[zh]); uv adds them for that run.
  const needs = kokoroLanguages[lang].needs?.startsWith('misaki') ? [kokoroLanguages[lang].needs] : [];
  // Say-as marks: sounds-like ones as their respelling, exact phonemes left for Misaki (lib/marks.mjs).
  const read = lines.map(line => ({...line, text: kokoroText(line.text, lang)}));
  try { await python([file, JSON.stringify({voice: name, lang, speed, lines: read})], {timeout: 600000}, needs); }
  catch (error) {
    // Japanese reads words with MeCab, whose dictionary is a separate one-time download.
    if (lang === 'j' && /mecabrc|unidic/.test(String(error.stderr || error.message))) throw new Error('Japanese voices need their dictionary first, a one-time download of about 500 MB: flikka voice setup japanese');
    throw error;
  }
}

// The one-time download a language needs before its voices can speak. Only Japanese has one (MeCab's UniDic).
async function setupLanguage(language) {
  if (!/^(japanese|ja|j)$/i.test(language || '')) throw new Error('Only Japanese needs setting up: flikka voice setup japanese. Every other language works as it is.');
  await python(['-m', 'unidic', 'download'], {timeout: 1800000}, ['misaki[ja]']);
  return {ready: 'japanese', next: 'flikka voice say jf_alpha "こんにちは"'};
}

// faster-whisper transcription helper on CUDA with CPU fallback.
const whisperHelper = `
import json, sys
from faster_whisper import WhisperModel

audio, out_json = sys.argv[1], sys.argv[2]
model_size = sys.argv[3] if len(sys.argv) > 3 else "tiny"
# The language when it's known (a film's voice): Whisper guesses wrong on short lines otherwise.
language = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
try:
    model = WhisperModel(model_size, device="cuda", compute_type="float16")
    segments, info = model.transcribe(audio, word_timestamps=True, language=language)
    all_segments = []
    full_text = []
    for seg in segments:
        words = [{"start": w.start, "end": w.end, "word": w.word} for w in (seg.words or [])]
        all_segments.append({"start": seg.start, "end": seg.end, "text": seg.text, "words": words})
        full_text.append(seg.text)
except Exception:
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio, word_timestamps=True, language=language)
    all_segments = []
    full_text = []
    for seg in segments:
        words = [{"start": w.start, "end": w.end, "word": w.word} for w in (seg.words or [])]
        all_segments.append({"start": seg.start, "end": seg.end, "text": seg.text, "words": words})
        full_text.append(seg.text)

with open(out_json, "w") as f:
    json.dump({"text": " ".join(full_text).strip(), "segments": all_segments}, f)
`;

// `language`: Whisper's code (en, es, ja, ...), or left out to let Whisper tell.
export async function transcribeAudio(audioPath, outJsonPath, modelSize = 'tiny', language = '') {
  const file = path.join(cacheDir, 'flikka_whisper.py');
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, whisperHelper);
  await python([file, audioPath, outJsonPath, modelSize, language], {timeout: 600000});
}

// Kokoro's voices, then yours (own: true): what flikka voice list prints and the panel's pickers show.
export const allVoices = () => [...kokoroVoices, ...ownVoices().map(voice => ({name: voice.name, id: voice.id, own: true, code: 'a', language: 'Your voices',
  source: voice.source, created: voice.created}))];

// Making a voice from someone's recording needs their say-so.
const consentNote = 'Add --consent to confirm this is your voice, or that you have permission to use it';

// flikka voice list | add <name> [--from file] [--seconds 15] [--mic default] --consent
//   | say <name> "<text>" [--out f] | remove <name> | setup japanese | cuda [install | remove]
export async function voiceCommand([action, name, ...rest]) {
  if (action === 'list' || !action) return allVoices();
  if (action === 'setup') return setupLanguage(name);
  if (action === 'cuda') {
    const cuda = await import('./cuda.mjs');
    if (name === 'install') return {...await cuda.installCuda({progress: message => console.error(message)}), ...await cuda.cudaStatus()};
    if (name === 'remove') { await cuda.removeCuda(); return cuda.cudaStatus(); }
    if (name) throw new Error('Usage: flikka voice cuda [install | remove]');
    return cuda.cudaStatus();
  }
  if (!name || !name.trim() || name.length > 40 || /[\/\n]/.test(name)) throw new Error('Give the voice a name (up to 40 characters), e.g. flikka voice add me --consent');
  if (action === 'remove') return removeOwnVoice(name);
  if (action === 'say') {
    const at = rest.indexOf('--out');
    const out = path.resolve(at < 0 ? `voice-${findOwnVoice(name)?.id || name}.wav` : rest.splice(at, 2)[1]);
    const text = rest.join(' ') || script;
    await speakAs(name, [{text, out}]);
    return {output: out};
  }
  if (action !== 'add') throw new Error('Usage: flikka voice list | add <name> --consent [--from file] | say <name> "<text>" | remove <name>');
  const consent = rest.includes('--consent');
  if (!consent) throw new Error(consentNote);
  const option = flag => { const index = rest.indexOf(flag); return index < 0 ? undefined : rest[index + 1]; };
  const work = await fs.mkdtemp(path.join(cacheDir, 'voice-add-'));
  try { return await addVoice(name.trim(), option, work); }
  finally { await fs.rm(work, {recursive: true, force: true}); }
}

// Records (or reads a file), removes the background noise, trims the silence, checks the words with Whisper, and
// keeps up to 10 s that ends on a whole word: what Chatterbox copies the voice from.
async function addVoice(name, option, work) {
  const raw = path.join(work, 'raw.wav');
  const from = option('--from');
  if (from) {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.resolve(from), '-t', '20', raw]);
  } else {
    const seconds = Number(option('--seconds') || 15);
    console.error(`Read this aloud in your normal demo voice (recording ${seconds} s, starts in 3):\n\n${script}\n`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.error('Recording via PipeWire/PulseAudio...');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'pulse', '-i', option('--mic') || 'default', '-t', String(seconds), raw]);
    console.error('Done.');
  }

  const clean = path.join(work, 'clean.wav');
  const audio = path.join(work, 'voice.wav');
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.2';
  await cleanVoice(raw, clean);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', clean, '-af', `${trim},areverse,${trim},areverse,loudnorm=I=-20:TP=-2`, '-ar', '24000', '-ac', '1', audio]);

  const heardFile = path.join(work, 'heard.json');
  await transcribeAudio(audio, heardFile, setting('whisper-model'));
  const heard = JSON.parse(await fs.readFile(heardFile, 'utf8'));
  const words = heard.segments?.flatMap(segment => segment.words || []) || [];
  const kept = words.filter(word => word.end <= 9.7);
  const text = (kept.length ? kept.map(word => word.word).join('') : heard.text).trim();
  if (text.split(/\s+/).length < 4) throw new Error(`Heard only "${text}". Speak closer to the mic and try again.`);
  // Chatterbox takes 10 s at most: end just after the last whole word that fits.
  const end = Math.min(10, (kept.at(-1)?.end ?? 9.7) + 0.3);
  const clip = path.join(work, 'reference.wav');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', audio, '-t', String(end), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', clip]);
  const saved = await saveOwnVoice({name, source: from ? 'Imported' : 'Recorded', clip, consent: true});
  return {voice: saved.name, id: saved.id, ...(saved.replaced && {replaced: true}), said: text, seconds: +end.toFixed(1),
    next: `flikka voice say "${saved.name}" "Hello, this is my voice."`};
}
