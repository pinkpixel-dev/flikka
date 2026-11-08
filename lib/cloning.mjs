// Your own voices, spoken by Chatterbox Nano through flikka-voice (voice/: Narra's engine as a helper program).
// A voice is a folder in the voices folder, the way Narra stores them: <id>/reference.wav (up to 10 s, 24 kHz mono)
// and <id>/voice.json ({name, source, createdMs, consentMs}). Ids look like v19a4f2c0b1e, since flikka-voice only
// accepts those; people use the name. Narra's voices can be copied straight across (importNarraVoices).
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {flikkaHome, binDir, root, voicesDir, run, trace} from './common.mjs';
import {isKokoroVoice, voiceLanguage} from './kokoro.mjs';

// Part of every cached line's name: change it when the model or the helper's decoding changes.
export const cloningEngine = 'chatterbox-nano@4a66d7da-q4f16';
export const modelDir = path.join(flikkaHome, 'models', 'chatterbox');
const narraHome = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'dev.pinkpixel.narra');
const narraModel = path.join(narraHome, 'models', 'chatterbox');
export const narraVoices = path.join(narraHome, 'voices', 'chatterbox');

// owensong/chatterbox-nano-ONNX, pinned to the commit Narra was tested with: path, size, SHA-256 (Narra's
// src-tauri/src/models/manifest.rs).
const modelRepo = 'https://huggingface.co/owensong/chatterbox-nano-ONNX/resolve/4a66d7dab72a9e98f24b515d49a1d7a81632df2e';
export const modelFiles = [
  ['onnx/speech_encoder_q4f16.onnx', 1219352, '29e249f59eaf95015527588b955e5286c7ee4524e7bb54a2f8d589b838e8aed2'],
  ['onnx/speech_encoder_q4f16.onnx_data', 176273652, '55d89bd87fd36be48b2e831c99c2e309d432169119049066f9f22fcfe517798d'],
  ['onnx/embed_tokens_fp16.onnx', 1520, '019d257243774091d78c2ad91c2c0f61e4e442740cb7b3b00b5a89109417b18d'],
  ['onnx/embed_tokens_fp16.onnx_data', 87304704, 'bcd7b35ae4f206932e2491cb60b42ebb80f6d8facfdb53ba7d7449ad00a3237b'],
  ['onnx/language_model_q4f16.onnx', 522078, '8fe9620856d86b8a0235041d7fd2a8a47292da50828044bab5740b246e66e65b'],
  ['onnx/language_model_q4f16.onnx_data', 55911658, '8f2fdc616373c9ccaebbf2db3210dc80c860922a672898bca111eb75f6d3abd2'],
  ['onnx/conditional_decoder_q4.onnx', 2179022, '745faa9c2e2494a81e47f2a72601ac248639fd417ae53d999c5068bc441d1f97'],
  ['onnx/conditional_decoder_q4.onnx_data', 246397384, 'b5c5317e0b79a1a19dd3d5e2b2091ea06b15716716ab801a54eaeb906c6971ec'],
  ['tokenizer.json', 3562272, '3f04e34bea22f9144d1a19151154095bc9ce0430bf421304f5797e716288a906'],
];

const validId = id => /^v[a-z0-9]+$/i.test(id);
const exists = file => fs.access(file).then(() => true, () => false);

// Every voice in a voices folder, oldest first: {id, name, source, created, consent}. Synchronous, because checking
// a project or a film (which name voices) is.
export function ownVoices(dir = voicesDir) {
  let entries;
  try { entries = fsSync.readdirSync(dir, {withFileTypes: true}); } catch { return []; }
  return entries.filter(entry => entry.isDirectory() && validId(entry.name)).flatMap(entry => {
    try {
      const meta = JSON.parse(fsSync.readFileSync(path.join(dir, entry.name, 'voice.json'), 'utf8'));
      if (!fsSync.statSync(path.join(dir, entry.name, 'reference.wav')).isFile()) return [];
      return [{id: entry.name, name: String(meta.name), source: meta.source || '', created: meta.createdMs || 0, ...(meta.consentMs && {consent: meta.consentMs})}];
    } catch { return []; }
  }).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
}

// A voice by its id or its name (any case). Kokoro's names always mean Kokoro.
export function findOwnVoice(reference, dir = voicesDir) {
  if (!reference || isKokoroVoice(reference)) return null;
  const voices = ownVoices(dir);
  const name = String(reference).trim().toLowerCase();
  return voices.find(voice => voice.id === reference) || voices.find(voice => voice.name.toLowerCase() === name) || null;
}

// The language a voice speaks: a Kokoro voice's own, or American English for yours (Chatterbox Nano is English
// only). null for a name that's neither.
export const speechLanguage = name => voiceLanguage(name) || (findOwnVoice(name) ? 'a' : null);

// Changes when a voice's reference clip is replaced, so lines spoken in the old one are made again.
export function voiceStamp(voice, dir = voicesDir) {
  const stat = fsSync.statSync(path.join(dir, voice.id, 'reference.wav'));
  return `${stat.size}-${Math.round(stat.mtimeMs)}`;
}

// flikka-voice: FLIKKA_VOICE_BIN, the downloaded copy, the system package's (AUR), or a build in a source checkout.
export async function voiceHelper() {
  const places = [process.env.FLIKKA_VOICE_BIN, path.join(binDir, 'flikka-voice'), '/usr/lib/flikka/flikka-voice', path.join(root, 'voice/target/release/flikka-voice')].filter(Boolean);
  for (const file of places) if (await fs.access(file, fs.constants.X_OK).then(() => true, () => false)) return file;
  throw new Error('Your own voices need flikka-voice, which isn’t installed. From a source checkout: cd voice && cargo build --release');
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of fsSync.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// The Chatterbox model in ~/.flikka/models/chatterbox, about 550 MB. Files of the right size are trusted; a missing
// one is linked from Narra's copy when that one checks out, otherwise downloaded, and checked either way.
export async function cloningModel() {
  for (const [name, size, hash] of modelFiles) {
    const target = path.join(modelDir, name);
    if ((await fs.stat(target).catch(() => null))?.size === size) continue;
    await fs.mkdir(path.dirname(target), {recursive: true});
    const partial = `${target}.part`;
    await fs.rm(partial, {force: true});
    const narra = path.join(narraModel, name);
    if ((await fs.stat(narra).catch(() => null))?.size === size && await sha256(narra) === hash) {
      trace('voice', `model: ${name} from Narra`);
      await fs.link(narra, partial).catch(() => fs.copyFile(narra, partial));
    } else {
      trace('voice', `model: downloading ${name}`);
      console.error(`flikka: downloading the voice model (${name}, ${Math.round(size / 1e6)} MB), once`);
      await run('curl', ['-fsSL', '--retry', '2', '-o', partial, `${modelRepo}/${name}`], {timeout: 3600000});
      if (await sha256(partial) !== hash) {
        await fs.rm(partial, {force: true});
        throw new Error(`The voice model file ${name} didn’t download correctly (its checksum is wrong). Try again.`);
      }
    }
    await fs.rename(partial, target);
  }
  return modelDir;
}

// Speaks lines ([{text, out}]) in one of your voices: starts flikka-voice once, sends every line, and waits for all of
// them. The first line also waits for the model to load (about 15 s).
export async function speakCloned(reference, lines, speed = 1) {
  const voice = findOwnVoice(reference);
  if (!voice) throw new Error(`There's no voice "${reference}". flikka voice list shows Kokoro's and yours`);
  const [helper, model] = await Promise.all([voiceHelper(), cloningModel()]);
  const child = spawn(helper, ['speak', '--model', model, '--voices', voicesDir], {stdio: ['pipe', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  // Writing to a helper that already stopped fails with EPIPE; the close handler explains why it stopped.
  child.stdin.on('error', () => {});
  const waiting = new Map();
  const finished = new Promise((resolve, reject) => {
    let failed = null;
    createInterface({input: child.stdout}).on('line', text => {
      let event;
      try { event = JSON.parse(text); } catch { return; }
      if (event.event === 'loaded') return trace('voice', `chatterbox loaded on ${event.provider} in ${event.seconds?.toFixed(1)} s${event.fallback ? ` (${event.fallback})` : ''}`);
      const job = waiting.get(event.id);
      if (!job) { failed = new Error(`Your voice couldn't load: ${event.error}`); return; }
      waiting.delete(event.id);
      if (event.event === 'done') job.resolve(event); else job.reject(new Error(`Couldn't say "${job.text.slice(0, 60)}" in ${voice.name}: ${event.error}`));
    });
    child.on('error', error => { for (const job of waiting.values()) job.reject(error); waiting.clear(); resolve(); });
    child.on('close', code => {
      // A system older than the helper (glibc below 2.38) fails before it starts.
      const reason = /GLIBC_|GLIBCXX_/.test(stderr) ? new Error('Your own voices need a newer Linux: glibc 2.38 or later (Ubuntu 24.04, Fedora 39, or newer). Kokoro’s voices still work.')
        : failed || new Error(`flikka-voice stopped (${code})${stderr.trim() ? `: ${stderr.trim().split('\n').at(-1)}` : ''}`);
      for (const job of waiting.values()) job.reject(reason);
      resolve();
    });
  });
  const jobs = lines.map((line, index) => new Promise((resolve, reject) => {
    const id = `l${index}`;
    waiting.set(id, {resolve, reject, text: line.text});
    child.stdin.write(JSON.stringify({id, text: line.text, voice: voice.id, speed, out: line.out}) + '\n');
  }));
  child.stdin.end();
  const results = await Promise.allSettled(jobs);
  await finished;
  const problem = results.find(result => result.status === 'rejected');
  if (problem) throw problem.reason;
  return results.map(result => result.value);
}

// Saves a voice from a prepared clip (24 kHz mono WAV, already cut to 10 s). The same name replaces that voice's
// clip and keeps its id. consent: the person confirmed it's their voice or they may use it.
export async function saveOwnVoice({name, source, clip, consent}) {
  const existing = findOwnVoice(name);
  if (isKokoroVoice(name)) throw new Error(`${name} is one of Kokoro's voices. Pick another name`);
  const id = existing?.id || `v${Date.now().toString(16)}`;
  const folder = path.join(voicesDir, id);
  await fs.mkdir(folder, {recursive: true});
  const now = Date.now();
  await fs.copyFile(clip, path.join(folder, 'reference.wav'));
  await fs.writeFile(path.join(folder, 'voice.json'), JSON.stringify({name, source, createdMs: existing?.created || now, ...(consent && {consentMs: now})}, null, 2) + '\n');
  return {id, name, replaced: Boolean(existing)};
}

export async function removeOwnVoice(reference) {
  const voice = findOwnVoice(reference);
  if (!voice) throw new Error(`There's no voice "${reference}" of yours (flikka voice list)`);
  const folder = path.join(voicesDir, voice.id);
  await run('gio', ['trash', folder]).catch(() => fs.rm(folder, {recursive: true, force: true}));
  return {removed: voice.name};
}

// Copies the voices made in Narra across, once each. Ones whose name is already taken here are skipped.
export async function importNarraVoices() {
  const imported = [], skipped = [];
  for (const voice of ownVoices(narraVoices)) {
    if (ownVoices().some(mine => mine.id === voice.id)) continue;
    if (findOwnVoice(voice.name)) { skipped.push(voice.name); continue; }
    await fs.cp(path.join(narraVoices, voice.id), path.join(voicesDir, voice.id), {recursive: true});
    imported.push(voice.name);
  }
  if (!imported.length && !skipped.length && !await exists(narraVoices)) throw new Error(`Narra has no voices here: ${narraVoices}`);
  return {imported, skipped, voices: ownVoices().map(voice => voice.name)};
}
