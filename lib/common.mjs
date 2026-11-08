import {execFile, spawn} from 'node:child_process';
import os from 'node:os';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import {appendFileSync, readFileSync, createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.HOME || os.homedir();
const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
// Flikka's own things: tools it downloads, browser profiles, the trace log, the terminal's state.
export const flikkaHome = path.join(home, '.flikka');
// What `flikka app config` and the panel's Settings save.
export const settingsFile = path.join(configHome, 'flikka/config.json');

// A desktop folder as the system names it (xdg-user-dirs: renamed or translated, like ~/Vidéos), or ~/<fallback>.
function userDir(kind, fallback) {
  try {
    const found = readFileSync(path.join(configHome, 'user-dirs.dirs'), 'utf8').match(new RegExp(`^XDG_${kind}_DIR="(.*)"`, 'm'))?.[1].replace(/^\$HOME/, home);
    // Pointing at home itself means the folder is turned off.
    if (found && path.isAbsolute(found) && path.resolve(found) !== path.resolve(home)) return found;
  } catch {}
  return path.join(home, fallback);
}
export const expandHome = value => path.resolve(String(value).replace(/^~(?=$|\/)/, home));

// Browsers Flikka knows by name for browser demos (lib/browser.mjs has where each one lives).
export const browserNames = ['google-chrome', 'chromium', 'brave', 'edge', 'vivaldi'];

// Everything a person can set. Each comes from, in order: an environment variable (one run, a script), the
// settings file (flikka app config, or Settings in the panel), or the default. `type` decides how a value is
// checked and shown: folder (made if new), path, choice, browser, voice, port or command. `shown`: what a default
// of null means.
export const settingKinds = {
  videos: {group: 'Folders', label: 'Videos', about: 'Finished videos', type: 'folder', env: ['FLIKKA_VIDEOS', 'FLIKKA_DIR'], default: () => path.join(userDir('VIDEOS', 'Videos'), 'flikka')},
  screenshots: {group: 'Folders', label: 'Screenshots', about: 'Framed screenshots', type: 'folder', env: ['FLIKKA_SCREENSHOTS'], default: () => path.join(userDir('PICTURES', 'Pictures'), 'flikka')},
  projects: {group: 'Folders', label: 'Projects', about: 'Recordings, films and their edits', type: 'folder', env: ['FLIKKA_PROJECTS'], default: () => path.join(flikkaHome, 'projects')},
  voices: {group: 'Folders', label: 'Voices', about: 'Your own voices for narration', type: 'folder', env: ['FLIKKA_VOICES'], default: () => path.join(flikkaHome, 'voices')},
  styles: {group: 'Folders', label: 'Styles', about: 'Your own looks for films', type: 'folder', env: ['FLIKKA_STYLES'], default: () => path.join(flikkaHome, 'styles')},
  voice: {group: 'Voice', label: 'Default voice', about: 'The narrator when a film or a recording doesn\'t name one. Its language comes with it', type: 'voice', env: ['FLIKKA_DEFAULT_VOICE'], default: () => 'af_heart'},
  'whisper-model': {group: 'Voice', label: 'Transcription model', about: 'Hears the narration and your voice samples. Bigger is more accurate and slower', type: 'choice', choices: ['tiny', 'base', 'small', 'medium', 'large-v3'], env: ['FLIKKA_WHISPER_MODEL'], default: () => 'tiny'},
  browser: {group: 'Browser demos', label: 'Browser', about: 'What records browser demos: your default browser, one by name, or the path to one', type: 'browser', choices: ['auto', ...browserNames], env: ['FLIKKA_BROWSER_APP'], default: () => 'auto'},
  'browser-source': {group: 'Browser demos', label: 'Sign-ins from', about: 'A browser profile folder whose logins the demo browser starts with', type: 'path', env: ['FLIKKA_BROWSER_SOURCE'], default: () => null, shown: 'The browser\'s own profile'},
  'browser-profile': {group: 'Browser demos', label: 'Demo profile', about: 'Where the demo browser keeps its own copy of the profile', type: 'path', env: ['FLIKKA_BROWSER_PROFILE'], default: () => null, shown: '~/.flikka/browser-<name>'},
  'browser-port': {group: 'Browser demos', label: 'Browser port', about: 'Where Flikka talks to the demo browser (DevTools)', type: 'port', env: ['FLIKKA_BROWSER_PORT'], default: () => 9333},
  'screenshot-command': {group: 'Screenshots', label: 'Capture command', about: 'Your own tool for picking an area. %o is where it saves the PNG', type: 'command', env: ['FLIKKA_SCREENSHOT_CMD'], default: () => null, shown: 'Picked for your desktop'},
  'panel-port': {group: 'Panel', label: 'Panel port', about: 'Where the panel runs. Takes effect the next time it starts', type: 'port', env: ['FLIKKA_UI_PORT'], default: () => 9341},
};
const pathTypes = ['folder', 'path'];

// The settings file, or {} when there's none. `problem`: why it couldn't be read (the defaults apply meanwhile).
export function readSettings() {
  try { return {settings: JSON.parse(readFileSync(settingsFile, 'utf8'))}; }
  catch (error) { return {settings: {}, problem: error.code === 'ENOENT' ? null : `${settingsFile} can't be read: ${error.message}`}; }
}

// Each setting with where it came from: {value, from: 'env' | 'settings' | 'default', variable}.
export function settingSources() {
  const {settings} = readSettings();
  const read = (kind, value) => kind.type === 'port' ? Number(value) : pathTypes.includes(kind.type) ? expandHome(value) : String(value);
  return Object.fromEntries(Object.entries(settingKinds).map(([key, kind]) => {
    const variable = kind.env.find(name => process.env[name]);
    if (variable) return [key, {value: read(kind, process.env[variable]), from: 'env', variable}];
    if (settings[key] != null && settings[key] !== '') return [key, {value: read(kind, settings[key]), from: 'settings'}];
    return [key, {value: kind.default(), from: 'default'}];
  }));
}

// Read once per process, and again by loadSettings() after a change (the panel lives on). The folders are live
// bindings, so every module that imported them sees the new one.
let current = {};
export const setting = key => current[key].value;
export let videosDir, shotsDir, projectsDir, voicesDir, stylesDir;
export function loadSettings() {
  current = settingSources();
  [videosDir, shotsDir, projectsDir, voicesDir, stylesDir] = ['videos', 'screenshots', 'projects', 'voices', 'styles'].map(setting);
}
loadSettings();
// What flikka builds and can build again (renderer bundles, compositions, render scratch): never inside its own
// folder, which an npm or system install can't write to.
export const cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(process.env.HOME, '.cache'), 'flikka');
const execFileAsync = promisify(execFile);
// ffmpeg, uv and deep-filter come from tool(): installed ones first, otherwise downloaded on first use.
export const execute = async (command, args, options) => execFileAsync(await tool(command), args, options);
// One timeline of what every flikka process did, with times (cli, session, recorder, panel), to see where a
// slow or failed start waited: tail -f ~/.flikka/trace.log
export const traceFile = path.join(flikkaHome, 'trace.log');
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
export const binDir = path.join(flikkaHome, 'bin');
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
    const {url, zip, tar, sha256} = downloads[name];
    trace('tool', `downloading ${name} (first use): ${url}`);
    console.error(`flikka: downloading ${name}, once`);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-tool-'));
    try {
      const file = path.join(work, 'download');
      await execFileAsync('curl', ['-fsSL', '--retry', '2', '-o', file, url]);
      // Our own builds (flikka-voice) are pinned to the exact file that was tested.
      if (sha256) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        if (hash.digest('hex') !== sha256) throw new Error(`The ${name} download doesn't match its checksum, so it wasn't installed. Try again, or report it if it keeps happening`);
      }
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
// `extra`: more packages for this run only, like misaki[ja] for Kokoro's Japanese voices.
export const python = (args, options, extra = []) => run('uv', ['run', ...pythonSpec, ...extra.flatMap(item => ['--with', item]), 'python', '-I', ...args], options);

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
    // `progress`: how far along, 0…1, for steps that know (the frames being drawn).
    const update = (detail, progress) => { step.detail = detail; if (progress != null) step.progress = Math.max(0, Math.min(1, progress)); if (Date.now() - last > 250) { last = Date.now(); save(); } };
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
