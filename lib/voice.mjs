// Narration voices and speech-to-text on Linux with CUDA.
// Local neural voices powered by Kokoro and faster-whisper.
// Samples live in ~/.flikka/voices: <name>.wav and <name>.txt.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {cacheDir, run, python} from './common.mjs';
import {cleanVoice} from './clean.mjs';

export const voicesDir = process.env.FLIKKA_VOICES || path.join(os.homedir(), '.flikka/voices');
const defaultVoice = process.env.FLIKKA_DEFAULT_VOICE || 'af_heart';
const exists = file => fs.access(file).then(() => true, () => false);

// Read aloud while recording: varied sounds, a number, a product-demo tone.
export const script = `Hi, I'm going to show you something I built. It records the screen, cuts the boring parts,
and turns it into a short video in about two minutes. Let's open the dashboard and look at the numbers.`;

export async function findVoice(name) {
  const audio = path.join(voicesDir, `${name}.wav`);
  if (!await exists(audio)) return null;
  return {audio, text: (await fs.readFile(path.join(voicesDir, `${name}.txt`), 'utf8')).trim()};
}

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

// lines: [{text, out}]. Uses Kokoro with CUDA.
export async function speakAs(voice, lines, speed = 1.0) {
  const file = path.join(cacheDir, 'flikka_tts.py');
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, ttsHelper);
  const voiceName = typeof voice === 'string' ? voice : voice?.name || defaultVoice;
  await python([file, JSON.stringify({voice: voiceName, speed, lines})], {timeout: 600000});
}

// faster-whisper transcription helper on CUDA with CPU fallback.
const whisperHelper = `
import json, sys
from faster_whisper import WhisperModel

audio, out_json = sys.argv[1], sys.argv[2]
model_size = sys.argv[3] if len(sys.argv) > 3 else "tiny"
try:
    model = WhisperModel(model_size, device="cuda", compute_type="float16")
    segments, info = model.transcribe(audio, word_timestamps=True)
    all_segments = []
    full_text = []
    for seg in segments:
        words = [{"start": w.start, "end": w.end, "word": w.word} for w in (seg.words or [])]
        all_segments.append({"start": seg.start, "end": seg.end, "text": seg.text, "words": words})
        full_text.append(seg.text)
except Exception:
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio, word_timestamps=True)
    all_segments = []
    full_text = []
    for seg in segments:
        words = [{"start": w.start, "end": w.end, "word": w.word} for w in (seg.words or [])]
        all_segments.append({"start": seg.start, "end": seg.end, "text": seg.text, "words": words})
        full_text.append(seg.text)

with open(out_json, "w") as f:
    json.dump({"text": " ".join(full_text).strip(), "segments": all_segments}, f)
`;

export async function transcribeAudio(audioPath, outJsonPath, modelSize = 'tiny') {
  const file = path.join(cacheDir, 'flikka_whisper.py');
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, whisperHelper);
  await python([file, audioPath, outJsonPath, modelSize], {timeout: 600000});
}

// flikka voice add <name> [--from file] [--seconds 15] [--mic default] | list | say <name> "<text>" [--out f] | remove <name>
export async function voiceCommand([action, name, ...rest]) {
  if (action === 'list' || !action) {
    const names = (await fs.readdir(voicesDir).catch(() => [])).filter(file => /^[\w-]+\.wav$/.test(file)).map(file => file.slice(0, -4));
    return Promise.all(names.map(async item => ({
      name: item,
      said: (await findVoice(item))?.text || '',
      audio: path.join(voicesDir, `${item}.wav`),
      created: (await fs.stat(path.join(voicesDir, `${item}.wav`))).mtimeMs
    })));
  }
  if (!name || !/^[\w-]+$/.test(name)) throw new Error('Give the voice a name (letters, digits, - or _), e.g. flikka voice add me');
  if (action === 'remove') {
    if (!await findVoice(name)) throw new Error(`No voice named ${name}`);
    for (const ext of ['wav', 'txt']) {
      const target = path.join(voicesDir, `${name}.${ext}`);
      await run('gio', ['trash', target]).catch(() => fs.rm(target, {force: true}));
    }
    return {removed: name};
  }
  if (action === 'say') {
    const at = rest.indexOf('--out');
    const out = path.resolve(at < 0 ? `voice-${name}.wav` : rest.splice(at, 2)[1]);
    const text = rest.join(' ') || script;
    await speakAs(name, [{text, out}]);
    return {output: out};
  }
  if (action !== 'add') throw new Error('Usage: flikka voice add <name> [--from file] | list | say <name> "<text>" | remove <name>');
  const option = flag => { const index = rest.indexOf(flag); return index < 0 ? undefined : rest[index + 1]; };
  await fs.mkdir(voicesDir, {recursive: true});
  try { return await addVoice(name, option); }
  finally { for (const ext of ['raw.wav', 'clean.wav', 'new.wav', 'json']) await fs.rm(path.join(voicesDir, `${name}.${ext}`), {force: true}); }
}

async function addVoice(name, option) {
  const raw = path.join(voicesDir, `${name}.raw.wav`);
  if (option('--from')) {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.resolve(option('--from')), '-t', '20', raw]);
  } else {
    const seconds = Number(option('--seconds') || 15);
    console.error(`Read this aloud in your normal demo voice (recording ${seconds} s, starts in 3):\n\n${script}\n`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.error('Recording via PipeWire/PulseAudio...');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'pulse', '-i', option('--mic') || 'default', '-t', String(seconds), raw]);
    console.error('Done.');
  }

  const audio = path.join(voicesDir, `${name}.new.wav`);
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.2';
  await cleanVoice(raw, raw.replace(/\.raw\.wav$/, '.clean.wav'));
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw.replace(/\.raw\.wav$/, '.clean.wav'), '-af', `${trim},areverse,${trim},areverse,loudnorm=I=-20:TP=-2`, '-ar', '24000', '-ac', '1', audio]);
  await fs.rm(raw.replace(/\.raw\.wav$/, '.clean.wav'), {force: true});

  const heardFile = path.join(voicesDir, `${name}.json`);
  await transcribeAudio(audio, heardFile, process.env.FLIKKA_WHISPER_MODEL || 'tiny');
  const heard = JSON.parse(await fs.readFile(heardFile, 'utf8'));
  await fs.rm(heardFile, {force: true});

  const text = heard.text.trim();
  const end = heard.segments?.flatMap(segment => segment.words || []).at(-1)?.end;
  if (end) {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', audio, '-t', String(end + 0.3), raw]);
    await fs.rename(raw, audio);
  }
  await fs.rm(raw, {force: true});
  if (text.split(/\s+/).length < 4) {
    await fs.rm(audio, {force: true});
    throw new Error(`Heard only "${text}". Speak closer to the mic and try again.`);
  }
  await fs.writeFile(path.join(voicesDir, `${name}.txt`), text);
  await fs.rename(audio, path.join(voicesDir, `${name}.wav`));
  return {voice: name, audio: path.join(voicesDir, `${name}.wav`), said: text, next: `flikka voice say ${name} "Hello, this is my voice."`};
}
