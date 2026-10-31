import {execFile, spawn} from 'node:child_process';
import os from 'node:os';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Finished videos (and screenshots) for the user; everything a recording is made of stays in its project folder.
export const outputDir = path.resolve(process.env.FLIKKA_DIR || path.join(process.env.HOME, 'Documents/flikka'));
export const projectsDir = path.resolve(process.env.FLIKKA_PROJECTS || path.join(process.env.HOME, '.flikka/projects'));
const execFileAsync = promisify(execFile);
// ffmpeg, uv and deep-filter come from tool(): installed ones first, otherwise downloaded on first use.
export const execute = async (command, args, options) => execFileAsync(await tool(command), args, options);
// One timeline of what every flikka process did, with times (cli, session, recorder, panel), to see where a
// slow or failed start waited: tail -f ~/.flikka/trace.log
export const traceFile = path.join(process.env.HOME, '.flikka/trace.log');
export function trace(source, message) {
  const now = new Date();
  try { appendFileSync(traceFile, `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')} ${source}[${process.pid}] ${message}\n`); } catch {}
}
// Visually lossless for screen content and ~10x smaller than the hardware encoder at the same quality.
export const x264 = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'];
export const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
// A time limit for Promise.race that does not keep the process alive once the race is won.
export const limit = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds).unref());
export const readJSON = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  await fs.rename(temporary, file);
}
// Tools flikka gets by itself the first time it needs one that isn't installed, into ~/.flikka/bin.
export const binDir = path.join(process.env.HOME, '.flikka/bin');
const downloads = {
  ffmpeg: {url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz', tar: ['ffmpeg']},
  ffprobe: {url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz', tar: ['ffprobe']},
  uv: {url: 'https://github.com/astral-sh/uv/releases/download/0.13.6/uv-x86_64-unknown-linux-gnu.tar.gz', tar: ['uv', 'uvx']},
  uvx: {url: 'https://github.com/astral-sh/uv/releases/download/0.13.6/uv-x86_64-unknown-linux-gnu.tar.gz', tar: ['uv', 'uvx']},
  // The noise remover: DeepFilterNet standalone binary for Linux x86_64 (model built in).
  'deep-filter': {url: 'https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-unknown-linux-musl'},
};
const tools = new Map();
export function tool(name) {
  if (!downloads[name]) return name;
  if (!tools.has(name)) tools.set(name, (async () => {
    const usable = file => fs.access(file, fs.constants.X_OK).then(() => true, () => false);
    for (const folder of [...(process.env.PATH || '').split(':').filter(Boolean), '/usr/local/bin', '/usr/bin', path.join(process.env.HOME, '.local/bin'), binDir]) {
      if (await usable(path.join(folder, name))) return path.join(folder, name);
    }
    const {url, zip, tar} = downloads[name];
    trace('tool', `downloading ${name} (first use): ${url}`);
    console.error(`flikka: downloading ${name}, once`);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-tool-'));
    try {
      const file = path.join(work, 'download');
      await execFileAsync('curl', ['-fsSL', '--retry', '2', '-o', file, url]);
      if (zip) await execFileAsync('unzip', ['-oq', file, '-d', work]);
      if (tar) await execFileAsync('tar', ['-xf', file, '-C', work, '--strip-components', '1']);
      await fs.mkdir(binDir, {recursive: true});
      for (const part of tar || [name]) {
        const source = zip || tar ? path.join(work, part) : file;
        await fs.chmod(source, 0o755);
        const destination = path.join(binDir, part);
        try {
          await fs.rename(source, destination);
        } catch (err) {
          if (err.code === 'EXDEV') {
            await fs.copyFile(source, destination);
            await fs.rm(source, {force: true});
          } else throw err;
        }
      }
    } finally { await fs.rm(work, {recursive: true, force: true}); }
    return path.join(binDir, name);
  })().catch(error => { tools.delete(name); throw error; }));
  return tools.get(name);
}

// One Python environment for models (speech to text, voice synthesis) via uv with CUDA support.
const pythonSpec = ['--python', '3.12', '--with', 'faster-whisper==1.2.1', '--with', 'av<14', '--with', 'kokoro==0.9.4', '--with', 'soundfile', '--with', 'numpy', '--with', 'torch'];
export const python = (args, options) => run('uv', ['run', ...pythonSpec, 'python', '-I', ...args], options);

export async function run(command, args, options = {}) {
  const {stdout} = await execute(command, args, {maxBuffer: 16 * 1024 * 1024, ...options});
  return stdout;
}
export async function probe(file) {
  return JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
}
export async function build(name = 'rec') {
  const binary = path.join(root, `.build/flikka-${name}`);
  return binary;
}
export function launch(command, args, options = {}) {
  const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe'], ...options});
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code ?? signal}): ${stderr}`)));
  });
  finished.catch(() => {});
  return {child, finished};
}
export async function request(session, action, body = {}) {
  const response = await fetch(`http://127.0.0.1:${session.port}/${action}`, {
    method: 'POST', headers: {'Authorization': `Bearer ${session.token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body), signal: AbortSignal.timeout(action === 'stop' ? 180000 : 60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`);
  return result;
}

// What a project is doing, step by step with timings: <project folder>/steps.json, for the recording panel.
export function stepLog(directory, phase) {
  if (!directory) return (name, work) => work(() => {});
  const file = path.join(directory, 'steps.json');
  let steps = [], writing = Promise.resolve(), last = 0;
  const save = () => (writing = writing.then(() => writeJSON(file, steps)).catch(() => {}));
  const ready = readJSON(file).then(old => { steps = old.filter(item => item.phase !== phase); }, () => {});
  return async (name, work) => {
    await ready;
    const step = {phase, name, started: Date.now()};
    trace(phase, `${path.basename(directory)} ${name}…`);
    steps.push(step);
    await save();
    const update = detail => { step.detail = detail; if (Date.now() - last > 250) { last = Date.now(); save(); } };
    try {
      const result = await work(update);
      if (typeof result === 'string') step.detail = result;
      return result;
    } catch (error) { step.error = error.message; throw error; }
    finally {
      step.ended = Date.now();
      trace(phase, `${path.basename(directory)} ${name}: ${step.error ? 'failed: ' + step.error : 'done'} in ${((step.ended - step.started) / 1000).toFixed(2)} s`);
      await save();
    }
  };
}
