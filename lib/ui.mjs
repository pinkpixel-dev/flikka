// flikka app panel: the recording panel. Projects on the left, a new recording with camera and mic
// preview, and each project's page: its video, the steps that made it with their timings, and its id for an agent.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import os from 'node:os';
import {pipeline} from 'node:stream/promises';
import {root, run, build, projectsDir, shotsDir, voicesDir, cacheDir, readJSON, trace, settingSources, settingKinds, setting} from './common.mjs';
import {shotCommand} from './shot.mjs';
import {voiceCommand} from './voice.mjs';
import {layerArgs} from './layers.mjs';
import {renderQueue} from './queue.mjs';
import {renameProject, removeProject, storedProject, editProject, loadProject, timelineProject, undoProject, backgrounds, presets} from './project.mjs';

// A fixed address, so the browser remembers the camera and mic permission between runs.
const port = setting('panel-port');
const types = {'.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.wav': 'audio/wav', '.mov': 'video/quicktime', '.m4a': 'audio/mp4'};
const voiceName = name => /^[\w-]+$/.test(name || '') ? name : (() => { throw new Error('A voice name is letters, digits, - or _'); })();
// Which line a narration request is about, as CLI options: a recording's --line, or a film's --scene and
// --sentence (both count from 1).
const lineArgs = body => body.line ? ['--line', String(body.line).replace(/[^\w-]/g, '')]
  : body.scene ? ['--scene', String(Math.trunc(Number(body.scene))), ...(body.sentence ? ['--sentence', String(Math.trunc(Number(body.sentence)))] : [])] : [];
// Who reads a recording's line or a film's sentence: {voice, speed}.
async function readerOf(body) {
  const folder = await storedProject(body.id);
  if (body.scene) return (await import('./film.mjs')).sentenceClip(path.join(folder, 'film.json'), Number(body.scene), Number(body.sentence));
  const {project} = await loadProject(path.join(folder, 'recording.project.json'));
  const {narrationLines, lineVoice, lineSpeed} = await import('./narration.mjs');
  const line = narrationLines(project).find(item => item.id === body.line);
  if (!line) throw new Error('Pick a narration line');
  return {voice: lineVoice(project, line), speed: lineSpeed(project, line)};
}
// Where Say as's preview goes, one file per project.
const triedLine = id => path.join(os.tmpdir(), `flikka-say-as-${id}.wav`);
// Where "Try it" writes what a voice said, one file per voice.
const tried = name => path.join(os.tmpdir(), `flikka-voice-${voiceName(name)}.wav`);

async function hasBinary(name) {
  for (const folder of (process.env.PATH || '').split(':').filter(Boolean)) {
    try {
      await fs.access(path.join(folder, name), fs.constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

export async function openURL(url) {
  if (await hasBinary('xdg-open')) return run('xdg-open', [url]).catch(() => {});
  if (await hasBinary('gio')) return run('gio', ['open', url]).catch(() => {});
}

async function revealFile(file) {
  const folder = (await fs.stat(file).catch(() => null))?.isDirectory() ? file : path.dirname(file);
  if (await hasBinary('gio')) return run('gio', ['open', folder]).catch(() => {});
  if (await hasBinary('xdg-open')) return run('xdg-open', [folder]).catch(() => {});
}

async function copyFileToClipboard(file) {
  const uri = `file://${file}\r\n`;
  if (await hasBinary('wl-copy')) {
    const {spawn} = await import('node:child_process');
    return new Promise(resolve => {
      const child = spawn('wl-copy', ['--type', 'text/uri-list'], {stdio: ['pipe', 'ignore', 'ignore']});
      child.on('error', () => resolve());
      child.on('close', () => resolve());
      child.stdin.end(uri);
    });
  }
  if (await hasBinary('xclip')) {
    const {spawn} = await import('node:child_process');
    const child = spawn('xclip', ['-selection', 'clipboard', '-target', 'text/uri-list'], {stdio: ['pipe', 'ignore', 'ignore']});
    child.stdin.end(uri);
    child.unref();
  }
}

// What the panel shows for one project: state, times, the edit in numbers, the finished video, the steps.
async function summary(id) {
  const folder = path.join(projectsDir, id);
  const [config, session, project, render, steps] = await Promise.all(['config.json', 'session.json', 'recording.project.json', 'recording.render.json', 'steps.json']
    .map(name => readJSON(path.join(folder, name)).catch(() => null)));
  if (!config && !project) return null;
  // A film: its finished video and its render's steps; nothing to switch.
  const film = await readJSON(path.join(folder, 'film.render.json')).catch(() => null);
  if (await fs.access(path.join(folder, 'film.json')).then(() => true, () => false)) {
    const final = film && await fs.access(film.output).then(() => film, () => null);
    return {id, name: config?.name || id, film: path.join(folder, 'film.json'), created: config?.created || (await fs.stat(folder)).birthtimeMs,
      edited: (await fs.stat(path.join(folder, 'film.json'))).mtimeMs,
      state: (steps || []).some(step => !step.ended) ? 'rendering' : final ? 'ready' : 'saved', duration: null, final, folder, steps: steps || [], prompt: `Use /flikka to edit project ${id} (a film): `};
  }
  const created = project?.created || (await fs.stat(folder)).birthtimeMs;
  const final = render && await fs.access(render.output).then(() => true, () => false) ? render : null;
  const kept = project ? project.clips.reduce((total, clip) => total + clip.end - clip.start, 0) : null;
  // A step without an end is running; "rendering" covers a render an agent started too.
  const running = (steps || []).some(step => !step.ended);
  const state = session && session.state !== 'saved' ? session.state : running ? 'rendering' : final ? 'ready' : project ? 'saved' : 'unknown';
  return {id, name: project?.name || config?.name || id, created, state, error: session?.error, startedAt: session?.startedAt, elapsed: session?.elapsed,
    duration: project?.duration ?? null, kept, zooms: project?.zooms.length ?? null, clips: project?.clips.length ?? null,
    size: project && `${project.width}×${project.height}`, fps: project?.fps, final, folder, recording: project && path.join(folder, project.source),
    edited: project && (await fs.stat(path.join(folder, 'recording.project.json'))).mtimeMs, switches: project && switches(project), speed: project && {whole: project.speed || 1, parts: project.clips.some(clip => clip.speed)}, camera: project?.webcam && {round: project.webcam.round !== false, size: project.webcam.size, position: project.webcam.position}, look: project && look(project), steps: steps || [], prompt: `Use /flikka to edit project ${id}: `};
}

// How the video frames the recording: the wallpaper (by name, or custom CSS), the shape, padding, corners, shadow.
// The wallpapers come along so the panel draws its swatches from the same CSS the renderer uses.
function look({style, export: output}) {
  const shape = Object.entries(presets).find(([, [width, height]]) => width === output.width && height === output.height)?.[0] || null;
  return {background: Object.entries(backgrounds).find(([, css]) => css === style.background)?.[0] || 'custom', css: style.background, backgrounds,
    shape, width: output.width, height: output.height, padding: style.padding, radius: style.radius, shadow: style.shadow !== false,
    most: Math.floor(Math.min(output.width, output.height) / 3)};
}

// The parts of the recording that can be left out of the video, each on or off. The mic and system sound
// only apart when both were saved apart too.
// Zooms are a mode, not on or off: all (clicks and typing), clicks, typing or off.
function switches({audio = {}, webcam, zooms = [], autoZoom, cursor, cursorBaked, cursorEnabled}) {
  const apart = !('mic' in audio && 'system' in audio) || audio.stems;
  return {...(apart && 'mic' in audio && {mic: audio.mic}), ...(apart && 'system' in audio && {system: audio.system}), ...(webcam && {webcam: webcam.enabled !== false}),
    clicks: audio.clicks !== false, zooms: autoZoom || (zooms.length > 0 ? 'all' : 'off'), ...(cursor && !cursorBaked && {cursor: cursorEnabled !== false})};
}

// Screens, windows and devices for the new-recording form: one request at a time, the last list again during a
// recording, and a time limit (one request once hung for 10 minutes).
let sourcesList, sourcesAsking;
async function listSources() {
  if ((await projects()).some(item => ['starting', 'recording', 'paused'].includes(item.state))) {
    if (sourcesList) return sourcesList;
    throw new Error('Screens can be listed when the recording ends');
  }
  sourcesAsking ||= import('./screen.mjs').then(({getSources}) => getSources()).finally(() => { sourcesAsking = null; });
  return (sourcesList = await sourcesAsking);
}

async function projects() {
  const ids = (await fs.readdir(projectsDir).catch(() => [])).filter(name => /^[\w-]+$/.test(name));
  return (await Promise.all(ids.map(id => summary(id).catch(() => null)))).filter(Boolean).sort((first, second) => second.created - first.created);
}

// A small picture of the recording for the list, made once.
async function thumbnail(id) {
  const folder = path.join(projectsDir, id), file = path.join(folder, 'thumb.jpg');
  if (await fs.access(file).then(() => true, () => false)) return file;
  const project = await readJSON(path.join(folder, 'recording.project.json')).catch(() => null);
  const film = !project && await readJSON(path.join(folder, 'film.render.json'));
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.min(project ? 1 : 3, (project || film).duration / 2)), '-i', project ? path.join(folder, project.source) : film.output,
    '-frames:v', '1', '-vf', 'scale=480:-2', file]);
  return file;
}

// The live preview: a project's edit as a composition (lib/compose.mjs) in the cache, played by a HyperFrames
// player in the page. 30 fps, with the sound the render keeps (unmixed: no click ticks or cleanup).
const previewFolder = id => path.join(cacheDir, 'preview', id);
// One build at a time per project: each one empties and refills the same folder, so two at once (an edit and
// a reload) would trip over each other. A build waits for the one before it, failed or not.
const previewing = new Map();
function writePreview(id) {
  const build = (previewing.get(id) || Promise.resolve()).catch(() => {}).then(() => buildPreview(id));
  previewing.set(id, build);
  build.finally(() => { if (previewing.get(id) === build) previewing.delete(id); }).catch(() => {});
  return build;
}
async function buildPreview(id) {
  const folder = await storedProject(id);
  // A film: its scenes as one composition, and where each one sits.
  const film = path.join(folder, 'film.json');
  if (await fs.access(film).then(() => true, () => false)) return (await import('./film.mjs')).filmPreview(film, previewFolder(id));
  const {directory, project} = await loadProject(path.join(folder, 'recording.project.json'));
  const [{projectProps, heardTrack}, {workspace}, {demoFrames}] = await Promise.all([import('./render.mjs'), import('./compose.mjs'), import('../render/timing.js')]);
  const space = await workspace(previewFolder(id));
  const {heard} = heardTrack(project, directory);
  const props = {...await projectProps(project, directory, space.url), sound: heard && space.url(heard)};
  if (project.music) {
    const song = project.music.file ? path.resolve(directory, project.music.file) : await (await import('./music.mjs')).music(cacheDir);
    const {probe} = await import('./common.mjs');
    props.music = {url: space.url(song), seconds: Number((await probe(song)).format.duration), volume: project.music.volume};
  }
  // Narration: the lines already spoken, each as its own sound where it lands, with their captions in place of the
  // mic's (as a render does). Lines not spoken yet stay silent; the render speaks them. Fades and the dip under the
  // voice are the render's, and gain is capped at 1 here.
  let narration = null;
  const {narrationLines, narrationClips, clipLengths, placeLines, narrationCaptions} = await import('./narration.mjs');
  if (narrationLines(project).length) {
    const clips = await narrationClips(project);
    const placed = placeLines(project, clipLengths(clips));
    const trims = new Map(narrationLines(project).map(line => [line.id, line]));
    props.narration = placed.filter(item => !item.muted && clips.has(item.id) && item.from !== null && item.length > 0).map(item => {
      const line = trims.get(item.id);
      return {url: space.url(clips.get(item.id).file), from: item.from, trimStart: line.trimStart || 0, length: item.length, volume: Math.min(1, 10 ** ((line.gain || 0) / 20))};
    });
    if (project.captions?.enabled !== false) props.captions = await narrationCaptions(placed);
    narration = {spoken: clips.size, total: placed.length};
  }
  const {width, height} = project.export;
  await space.write({kind: 'demo', props, config: {width, height, fps: 30, durationInFrames: Math.max(1, demoFrames(project, 30))}});
  return {width, height, narration};
}

// The page itself: ui/src (React) bundled with esbuild into the cache, once per version of its files, so a
// reload after an update gets the new panel. app.js, app.css and the font files it points to.
let panelBuilt = null;
async function panelBundle() {
  const digest = createHash('sha256').update(await fs.readFile(path.join(root, 'package.json')));
  const files = (await fs.readdir(path.join(root, 'ui/src'), {recursive: true})).sort();
  for (const name of files) {
    const file = path.join(root, 'ui/src', name);
    if ((await fs.stat(file)).isFile()) digest.update(name).update(await fs.readFile(file));
  }
  // lib/ files the page imports too.
  for (const name of ['lib/marks.mjs', 'lib/say.mjs', 'render/keyframes.js']) digest.update(name).update(await fs.readFile(path.join(root, name)));
  const key = digest.digest('hex').slice(0, 16);
  if (panelBuilt?.key === key) return panelBuilt.folder;
  const folder = path.join(cacheDir, 'panel', key);
  if (!await fs.access(path.join(folder, 'app.js')).then(() => true, () => false)) {
    const {build} = await import('esbuild');
    await build({entryPoints: {app: path.join(root, 'ui/src/main.jsx')}, bundle: true, minify: true, format: 'iife', jsx: 'automatic',
      loader: {'.woff2': 'file', '.woff': 'file'}, assetNames: '[name]-[hash]', define: {'process.env.NODE_ENV': '"production"'},
      nodePaths: [path.join(root, 'node_modules')], outdir: folder, logLevel: 'silent'});
  }
  // Only the current version stays.
  for (const name of await fs.readdir(path.join(cacheDir, 'panel'))) if (name !== key) await fs.rm(path.join(cacheDir, 'panel', name), {recursive: true, force: true});
  panelBuilt = {key, folder};
  return folder;
}

// A failed flikka command ends its stderr with {"error": …}: that, not the whole command line.
function failureMessage(error) {
  try { return JSON.parse(error.stderr.trim().split('\n').at(-1)).error || error.message; } catch { return error.message; }
}

function serveFile(req, res, file, size) {
  const [, from, to] = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '') || [];
  const start = Number(from || 0), end = to ? Number(to) : size - 1;
  res.writeHead(req.headers.range ? 206 : 200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1, ...(req.headers.range && {'Content-Range': `bytes ${start}-${end}/${size}`})});
  createReadStream(file, {start, end}).pipe(res);
}

export async function serveUI({open = true, project = null, shots = false} = {}) {
  const token = randomBytes(24).toString('hex');
  const started = Date.now();
  const origin = `http://127.0.0.1:${port}`;
  const page = /^[\w-]+$/.test(project || '') ? `${origin}/#project/${project}` : shots ? `${origin}/#shots` : origin;
  const cli = async args => JSON.parse(await run(process.execPath, [path.join(root, 'lib/cli.mjs'), ...args]));
  const queue = renderQueue(id => cli(['project', 'render', id]).catch(error => { throw new Error(failureMessage(error)); }));
  // Narration lines are spoken one job at a time too (Kokoro and your own voices both want the GPU), in the order
  // asked. A job's request waits until its lines are spoken.
  let speaking = Promise.resolve();
  const queued = task => {
    const job = speaking.catch(() => {}).then(task);
    speaking = job;
    return job;
  };
  // Timeline and narration edits are worked out from the timeline the panel last read. If the project changed since
  // (an agent's edit), they could land in the wrong place, so they're refused and the panel reads it again.
  const fresh = async body => {
    if (body.edited === undefined) return;
    const {mtimeMs} = await fs.stat(path.join(await storedProject(body.id), 'recording.project.json'));
    if (mtimeMs !== Number(body.edited)) throw Object.assign(new Error('Your agent changed this project a moment ago. The timeline shows the newest version now, so try that again.'), {status: 409});
  };
  // The edit, and the file's new stamp for the panel's next one.
  const stamped = async (id, args) => {
    const file = path.join(await storedProject(id), 'recording.project.json');
    const result = await editProject(file, args);
    return {...result, edited: (await fs.stat(file)).mtimeMs};
  };
  const speak = args => queued(() => cli(['project', 'speak', ...args]).catch(error => { throw new Error(failureMessage(error)); }));
  // A project's render, for the panel: the step it's on and how far along (from steps.json, so a render an agent
  // started shows too), waiting in the queue with how many are ahead, or the last queued render's failure.
  const withQueue = project => {
    if (!project) return project;
    const entry = queue.status(project.id);
    const steps = project.steps.filter(step => step.phase === 'render' && !step.ended);
    const step = steps.find(item => item.progress != null) || steps.at(-1);
    if (step) return {...project, render: {state: 'rendering', step: step.name, detail: step.detail, progress: step.progress ?? null}};
    // Started, but its first step isn't written yet.
    if (entry?.state === 'rendering') return {...project, state: 'rendering', render: {state: 'rendering', step: 'Starting', progress: null}};
    if (entry?.state === 'queued') return {...project, state: 'queued', render: {state: 'queued', ahead: entry.ahead}};
    if (entry?.state === 'failed') return {...project, render: {state: 'failed', error: entry.error}};
    return project;
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== new URL(origin).host) { res.writeHead(403); res.end(); return; }
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/alive') { res.end(JSON.stringify({pid: process.pid, started})); return; }
    if (req.method === 'GET' && url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      try { await panelBundle(); } catch (error) { res.writeHead(500); res.end(`The panel could not be built: ${error.message}`); return; }
      const html = await fs.readFile(path.join(root, 'ui/index.html'), 'utf8');
      res.end(html.replace('__TOKEN__', token)); return;
    }
    // The page's script, styles and fonts (no secrets in them).
    const asset = url.pathname.match(/^\/app\/([\w.-]+\.(js|css|woff2|woff))$/);
    if (req.method === 'GET' && asset && panelBuilt) {
      const file = path.join(panelBuilt.folder, asset[1]), stat = await fs.stat(file).catch(() => null);
      if (!stat) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', {js: 'application/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff'}[asset[2]]);
      res.setHeader('Content-Length', stat.size);
      return createReadStream(file).pipe(res);
    }
    // A live preview's composition: /preview/<token>/<id>/<file>. The token sits in the path, so the page's
    // own relative addresses (flikka.js, media/…) carry it too.
    const previewPath = url.pathname.match(/^\/preview\/([\w]+)\/([\w-]+)\/(.+)$/);
    if (req.method === 'GET' && previewPath && previewPath[1] === token) {
      const base = previewFolder(previewPath[2]);
      const file = path.resolve(base, decodeURIComponent(previewPath[3]));
      const stat = file.startsWith(base + path.sep) ? await fs.stat(file).catch(() => null) : null;
      if (stat?.isFile()) {
        const kind = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript'}[path.extname(file)];
        if (kind) { res.setHeader('Content-Type', kind); return createReadStream(file).pipe(res); }
        return serveFile(req, res, file, stat.size);
      }
      res.writeHead(404); res.end(); return;
    }
    // Pictures and videos for <img>/<video>, which can't send a header: the token comes in the address.
    if (req.method === 'GET' && url.searchParams.get('token') === token) {
      try {
        // A screenshot by file name, a voice's sample (or what it said in Try it).
        const name = url.searchParams.get('name') || '';
        if (url.pathname === '/shot' || url.pathname === '/voice') {
          const file = url.pathname === '/shot' ? path.join(shotsDir, path.basename(name))
            : url.searchParams.get('kind') === 'try' ? tried(name) : path.join(voicesDir, voiceName(name), 'reference.wav');
          const stat = /\.(png|wav)$/.test(file) ? await fs.stat(file).catch(() => null) : null;
          if (stat) return serveFile(req, res, file, stat.size);
        }
        if (url.pathname === '/preview.js') { res.setHeader('Content-Type', 'application/javascript'); return createReadStream((await import('./compose.mjs')).playerScript).pipe(res); }
        // By project id: /thumb, /media?kind=final (the rendered video) or kind=raw (the recording), or file=<name> (a camera part).
        const id = url.searchParams.get('id') || '';
        const part = url.searchParams.get('file');
        if (/^[\w-]+$/.test(id) && url.pathname === '/media' && part) {
          const file = path.join(projectsDir, id, path.basename(part)), stat = /\.(mp4|mov|m4a)$/.test(file) ? await fs.stat(file).catch(() => null) : null;
          if (stat) return serveFile(req, res, file, stat.size);
        }
        // Say as's preview, as /narration-try last made it.
        if (/^[\w-]+$/.test(id) && url.pathname === '/narration-try') {
          const stat = await fs.stat(triedLine(id)).catch(() => null);
          if (stat) return serveFile(req, res, triedLine(id), stat.size);
        }
        // A narration line's spoken clip, to play it on its own.
        const line = url.searchParams.get('line') || '';
        if (/^[\w-]+$/.test(id) && url.pathname === '/narration-clip') {
          const scene = Number(url.searchParams.get('scene')), sentence = Number(url.searchParams.get('sentence'));
          const clip = scene && sentence ? await (await import('./film.mjs')).sentenceClip(path.join(await storedProject(id), 'film.json'), scene, sentence).catch(() => null)
            : /^[\w-]+$/.test(line) ? (await (await import('./narration.mjs')).narrationClips((await loadProject(path.join(await storedProject(id), 'recording.project.json'))).project)).get(line) : null;
          const stat = clip && await fs.stat(clip.file).catch(() => null);
          if (stat) return serveFile(req, res, clip.file, stat.size);
        }
        const project = /^[\w-]+$/.test(id) && url.pathname === '/media' ? await summary(id) : null;
        const file = !/^[\w-]+$/.test(id) ? '' : url.pathname === '/thumb' ? await thumbnail(id)
          : project ? (url.searchParams.get('kind') === 'final' ? project.final?.output : project.recording) : '';
        const stat = file && /\.(mp4|jpg)$/.test(file) ? await fs.stat(file).catch(() => null) : null;
        if (stat) return serveFile(req, res, file, stat.size);
      } catch {}
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}` || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403); res.end(JSON.stringify({error: 'Unauthorized'})); return;
    }
    try {
      // A new voice: the body is the audio itself (recorded in the page, or a file such as a WhatsApp voice note).
      // consent=1: the person ticked that it's their voice or they may use it.
      if (url.pathname === '/voice-add') {
        const name = String(url.searchParams.get('name') || '').trim();
        if (!name || name.length > 40) throw new Error('Give the voice a name, up to 40 characters');
        if (url.searchParams.get('consent') !== '1') throw new Error('Confirm the voice is yours, or that you have permission to use it');
        if (Number(req.headers['content-length'] || 0) > 200e6) throw new Error('That file is too big (200 MB at most)');
        const upload = path.join(os.tmpdir(), `flikka-voice-upload-${randomBytes(6).toString('hex')}`);
        try {
          await pipeline(req, createWriteStream(upload));
          res.end(JSON.stringify(await cli(['voice', 'add', name, '--from', upload, '--consent'])));
        } finally { await fs.rm(upload, {force: true}); }
        return;
      }
      // A new image or video layer: the body is the file itself, copied into the project (lib/layers.mjs keep()).
      // The rest comes in the address: type, name (for its extension), from and to (video seconds), edited.
      if (url.pathname === '/project-layer-file') {
        const query = Object.fromEntries(url.searchParams);
        if (!/^[\w-]+$/.test(query.id || '')) throw new Error('Invalid project ID');
        await fresh(query);
        const extension = path.extname(String(query.name || '')).toLowerCase();
        if (!/^\.\w{2,5}$/.test(extension)) throw new Error('Pick an image or video file');
        if (Number(req.headers['content-length'] || 0) > 500e6) throw new Error('That file is too big (500 MB at most)');
        const upload = path.join(os.tmpdir(), `flikka-layer-upload-${randomBytes(6).toString('hex')}${extension}`);
        try {
          await pipeline(req, createWriteStream(upload));
          // The page sends a box shaped like the picture when it could read its size.
          const box = query.w ? {x: query.x, y: query.y, w: query.w, h: query.h} : {x: 0.35, y: 0.3, w: 0.3, h: 0.4};
          res.end(JSON.stringify(await stamped(query.id, ['--output-time', ...layerArgs([{add: {type: query.type, from: query.from, to: query.to, ...box, file: upload}}])])));
        } finally { await fs.rm(upload, {force: true}); }
        return;
      }
      // A whole film can be long; everything else is a few fields.
      let data = '';
      const most = url.pathname === '/film-save' ? 1e6 : 16384;
      for await (const chunk of req) { data += chunk; if (data.length > most) throw new Error('Request too large'); }
      const body = JSON.parse(data || '{}');
      if (body.id !== undefined && !/^[\w-]+$/.test(body.id)) throw new Error('Invalid project ID');
      let result;
      // Quick ones run here; a new node process for each took a moment (the page asks for shots every 3 s).
      if (!['/projects', '/project', '/project-timeline', '/shots', '/voices', '/film', '/film-schema', '/renders', '/settings'].includes(url.pathname)) trace('ui', url.pathname.slice(1) + (body.id ? ' ' + body.id : ''));
      if (url.pathname === '/sources') result = await listSources();
      else if (url.pathname === '/projects') result = (await projects()).map(withQueue);
      else if (url.pathname === '/project') result = withQueue(await summary(body.id)) || (() => { throw new Error('No such project'); })();
      // What the finished video holds, in its own seconds, for the timeline under the player.
      // `edited` is the file's stamp when it was read: the panel sends it back with its edits (see fresh()).
      else if (url.pathname === '/project-timeline') {
        const file = path.join(await storedProject(body.id), 'recording.project.json');
        const {mtimeMs: edited} = await fs.stat(file);
        result = {...await timelineProject(file), edited};
      }
      else if (url.pathname === '/start') {
        const args = ['record'];
        if (body.window) args.push('--window', String(body.window));
        else args.push('--display', String(body.display ?? 0));
        if (body.region) args.push('--region', String(body.region));
        if (body.microphone) args.push('--mic', String(body.microphone)); else args.push('--no-mic');
        if (body.systemAudio) args.push('--system-audio');
        if (body.autoZoom === false) args.push('--no-zoom');
        if (body.hideCursor || body.noCursor) args.push('--no-cursor');
        if (body.camera) args.push('--camera', String(body.camera));
        args.push('--fps', String(body.fps || 30), '--name', String(body.name || 'demo'));
        result = await cli(args);
      } else if (url.pathname === '/render') {
        // Queued: it starts when the render before it ends. The page follows it through /project and /renders.
        if (!body.id) throw new Error('Project ID is required');
        await storedProject(body.id);
        const waiting = ['queued', 'rendering'].includes(queue.status(body.id)?.state);
        if (!waiting && (await summary(body.id))?.steps.some(step => step.phase === 'render' && !step.ended)) throw new Error('This project is already rendering (your agent or the CLI started it)');
        result = queue.add(body.id);
      } else if (url.pathname === '/renders') {
        result = await Promise.all(queue.list().map(async item => {
          const project = withQueue(await summary(item.id).catch(() => null));
          return {...item, name: project?.name || item.id, ...(item.state === 'rendering' && project?.render && {render: project.render})};
        }));
      } else if (url.pathname === '/render-cancel') result = queue.cancel(body.id);
      else if (url.pathname === '/renders-clear') { queue.clear(); result = {ok: true}; }
      else if (['/stop', '/pause', '/resume', '/status'].includes(url.pathname)) {
        if (!body.id) throw new Error('Project ID is required');
        result = await cli(['record', url.pathname.slice(1), body.id]);
      } else if (url.pathname === '/project-preview') {
        // The live preview's composition, written again for the project as it is now.
        result = {...await writePreview(body.id), src: `/preview/${token}/${body.id}/preview.html`};
      } else if (url.pathname === '/copy-video') {
        // The rendered video as a file on the clipboard: paste it into a chat, a mail or file manager.
        const file = (await summary(body.id || ''))?.final?.output;
        if (!file) throw new Error('Render the video first');
        await copyFileToClipboard(file); result = {copied: file};
      } else if (url.pathname === '/project-rename') result = await renameProject(body.id, String(body.name || ''));
      else if (url.pathname === '/project-switch') {
        const option = {mic: '--mic', system: '--system-audio', webcam: '--webcam', clicks: '--clicks', zooms: '--zooms', cursor: '--cursor'}[body.kind];
        if (!option) throw new Error('Switch mic, system, webcam, clicks, zooms or cursor');
        // Zooms also take a mode: clicks or typing only.
        const value = body.kind === 'zooms' && ['clicks', 'typing'].includes(body.mode) ? body.mode : body.on ? 'on' : 'off';
        result = await editProject(path.join(await storedProject(body.id), 'recording.project.json'), [option, value]);
      } else if (url.pathname === '/project-camera') {
        const settings = Object.entries(body.camera || {}).map(([key, value]) => `${key}=${typeof value === 'boolean' ? (value ? 'on' : 'off') : value}`).join(',');
        result = await editProject(path.join(await storedProject(body.id), 'recording.project.json'), ['--camera', settings]);
      } else if (url.pathname === '/project-look') {
        // The frame: any of background (a wallpaper name), shape (a preset), padding, radius (px) and shadow.
        const args = [];
        if (body.background !== undefined) { if (!backgrounds[body.background]) throw new Error('Pick one of the wallpapers'); args.push('--background', body.background); }
        if (body.shape !== undefined) args.push('--preset', String(body.shape));
        for (const key of ['padding', 'radius']) if (body[key] !== undefined) args.push('--' + key, String(Number(body[key])));
        if (body.shadow !== undefined) args.push('--shadow', body.shadow ? 'on' : 'off');
        if (!args.length) throw new Error('Nothing to change');
        result = await editProject(path.join(await storedProject(body.id), 'recording.project.json'), args);
      } else if (url.pathname === '/project-speed') result = await editProject(path.join(await storedProject(body.id), 'recording.project.json'), ['--speed', String(Number(body.speed))]);
      // Edits made on the timeline, in the video's own seconds: cut a range, add a zoom, move or remove one.
      else if (url.pathname === '/project-timeline-edit') {
        await fresh(body);
        const time = value => { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error('Times are seconds in the video'); return number.toFixed(3); };
        const args = ['--output-time'];
        if (body.cut) args.push('--cut', `${time(body.cut[0])},${time(body.cut[1])}`);
        if (body.unzoom !== undefined) args.push('--unzoom', time(body.unzoom));
        if (body.zoom) {
          const {from, to, x, y, scale} = body.zoom;
          args.push('--zoom', [time(from), time(to), Number(x), Number(y), Number(scale || 1.5)].join(','));
        }
        if (args.length === 1) throw new Error('Nothing to change');
        result = await stamped(body.id, args);
      } else if (url.pathname === '/project-narration') {
        // Narration edits from the line list, several in one call (one undo step): add (at the playhead, in video
        // seconds, or after the line before), reword, set a line's voice, speed or mute, remove, split, merge, and
        // the narrator's voice.
        await fresh(body);
        const args = ['--output-time'];
        const id = value => { if (!/^[\w-]{1,40}$/.test(String(value))) throw new Error('Pick a narration line'); return String(value); };
        const text = value => { const said = String(value ?? '').replace(/\s+/g, ' ').trim(); if (!said) throw new Error('A line needs some words'); return said; };
        for (const change of Array.isArray(body.changes) ? body.changes : []) {
          if (change.add) args.push('--say', `${change.add.at == null ? 'next' : Math.max(0, Number(change.add.at)).toFixed(3)},${text(change.add.text)}`);
          else if (change.reword) args.push('--reword', `${id(change.reword.line)},${text(change.reword.text)}`);
          else if (change.set) {
            // at and until are video seconds (at: null follows the line before, until: null drops it); trims are seconds.
            const {line, voice, speed, muted, at, until, trimStart, trimEnd} = change.set;
            const moment = (value, none) => value === null ? none : Math.max(0, Number(value)).toFixed(3);
            const trim = value => Math.max(0, Number(value) || 0).toFixed(3);
            const settings = [voice !== undefined && `voice=${String(voice || '').replace(/,/g, '')}`, speed !== undefined && `speed=${speed ? Number(speed) : ''}`, muted !== undefined && `mute=${muted ? 'on' : 'off'}`,
              at !== undefined && `at=${moment(at, 'next')}`, until !== undefined && `until=${moment(until, 'none')}`,
              trimStart !== undefined && `trim-start=${trim(trimStart)}`, trimEnd !== undefined && `trim-end=${trim(trimEnd)}`].filter(Boolean);
            if (settings.length) args.push('--line', `${id(line)},${settings.join(',')}`);
          } else if (change.remove) args.push('--unsay', id(change.remove));
          else if (change.split) args.push('--split', `${id(change.split.line)},${Math.round(Number(change.split.at))}`);
          else if (change.merge) args.push('--merge', id(change.merge));
          else if (change.narrator) args.push('--narrator', String(change.narrator).replace(/,/g, ''));
          else if (change.pronounce) args.push('--pronounce', `${String(change.pronounce.word || '').trim()}=${String(change.pronounce.say || '').trim()}`);
        }
        if (args.length === 1) throw new Error('Nothing to change');
        result = await stamped(body.id, args);
      } else if (url.pathname === '/project-layers') {
        // Layer edits from the timeline, the player and the Layers tab, several in one call (one undo step).
        await fresh(body);
        result = await stamped(body.id, ['--output-time', ...layerArgs(body.changes)]);
      } else if (url.pathname === '/narration-speak') {
        // Speak the lines (a film's sentences) not spoken yet, or one (again: anew). Answers when it's done.
        await storedProject(body.id);
        result = await speak([body.id, ...lineArgs(body), ...((body.line || body.sentence) && body.again ? ['--again'] : [])]);
      } else if (url.pathname === '/narration-fit') {
        // Fit: speed up a line that runs past its until (or every one), spoken again in the speak queue.
        await storedProject(body.id);
        result = await queued(() => cli(['project', 'fit', body.id, ...(body.line ? ['--line', String(body.line).replace(/[^\w-]/g, '')] : [])])
          .catch(error => { throw new Error(failureMessage(error)); }));
      } else if (url.pathname === '/narration-check') {
        // Would a listener hear the right words? Whisper hears the spoken lines (or one), in the speak queue.
        await storedProject(body.id);
        const isFilm = await fs.access(path.join(await storedProject(body.id), 'film.json')).then(() => true, () => false);
        result = await queued(() => cli(['project', 'check', body.id, ...(isFilm ? ['--lines'] : []), ...lineArgs(body)])
          .catch(error => { throw new Error(failureMessage(error)); }));
      } else if (url.pathname === '/narration-try') {
        // Say as's preview: the line's (or a film sentence's) words as they'd be with the change, in its voice and
        // speed (waits its turn with the lines being spoken). The page plays it from /narration-try.
        const said = String(body.text || '').replace(/\s+/g, ' ').trim();
        if (!said || said.length > 1000) throw new Error('Nothing to say');
        const {voice, speed} = await readerOf(body);
        const {speakAs} = await import('./voice.mjs');
        await queued(() => speakAs(voice, [{text: said, out: triedLine(body.id)}], speed));
        result = {ok: true};
      } else if (url.pathname === '/film-lines') {
        // A film's sentences, scene by scene: who reads each, spoken yet, and what the words check heard.
        result = await (await import('./film.mjs')).filmLines(path.join(await storedProject(body.id), 'film.json'));
      } else if (url.pathname === '/project-undo') {
        const folder = await storedProject(body.id), film = path.join(folder, 'film.json');
        result = await fs.access(film).then(() => true, () => false) ? await (await import('./film.mjs')).undoFilm(film) : await undoProject(path.join(folder, 'recording.project.json'));
      }
      // A film's storyboard: read it, its schema (for the scene form), and save it whole.
      else if (url.pathname === '/film') result = {film: await readJSON(path.join(await storedProject(body.id), 'film.json'))};
      else if (url.pathname === '/film-schema') result = await readJSON((await import('./film.mjs')).schemaFile);
      else if (url.pathname === '/film-save') {
        if (!body.film || !Array.isArray(body.film.scenes)) throw new Error('Send the whole film');
        result = await (await import('./film.mjs')).saveFilm(path.join(await storedProject(body.id), 'film.json'), body.film);
      }
      // Settings: where files go (the same file `flikka app config` writes).
      else if (url.pathname === '/settings') result = (await import('./settings.mjs')).allSettings();
      else if (url.pathname === '/settings-set') result = await (await import('./settings.mjs')).setSetting(String(body.key || ''), body.value ?? null);
      else if (url.pathname === '/cuda-status') result = await (await import('./cuda.mjs')).cudaStatus();
      else if (url.pathname === '/cuda-install') { const cuda = await import('./cuda.mjs'); await cuda.installCuda(); result = await cuda.cudaStatus(); }
      else if (url.pathname === '/settings-reveal') {
        const folder = settingKinds[body.key]?.type === 'folder' && settingSources()[body.key].value;
        if (!folder) throw new Error('No such folder');
        await fs.mkdir(folder, {recursive: true}); await revealFile(folder); result = {ok: true};
      }
      else if (url.pathname === '/project-remove') result = await removeProject(body.id);
      else if (url.pathname === '/shots') result = await shotCommand(['list']);
      else if (url.pathname === '/shot-copy' || url.pathname === '/shot-remove') result = await shotCommand([url.pathname.slice(6), path.basename(String(body.name || ''))]);
      else if (url.pathname === '/shot-reveal') { await revealFile(path.join(shotsDir, path.basename(String(body.name || '')))); result = {ok: true}; }
      else if (url.pathname === '/voices') result = await voiceCommand(['list']);
      else if (url.pathname === '/voice-remove') result = await voiceCommand(['remove', voiceName(body.name)]);
      else if (url.pathname === '/voice-say') {
        const text = String(body.text || '').trim().slice(0, 600);
        result = await cli(['voice', 'say', voiceName(body.name), '--out', tried(body.name), ...(text ? [text] : [])]);
      } else if (url.pathname === '/reveal') {
        // A project's finished video, or its folder (the recording selected).
        const project = await summary(body.id || '');
        const file = body.kind === 'final' ? project?.final?.output : project?.recording || project?.folder;
        if (!file) throw new Error('Nothing to show yet');
        await revealFile(file); result = {ok: true};
      } else throw new Error('Unknown request');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error.status || 400); res.end(JSON.stringify({error: failureMessage(error), ...(error.status === 409 && {stale: true})}));
    }
  });
  const listen = () => new Promise(resolve => server.once('error', error => resolve(error)).listen(port, '127.0.0.1', () => resolve(null)));
  let listening = await listen();
  // Already running from older code (it stays up for days, and a new switch never showed): replace it.
  if (listening?.code === 'EADDRINUSE') {
    const running = await fetch(`${origin}/alive`).then(response => response.json()).catch(() => null);
    const files = (await fs.readdir(path.join(root, 'lib'))).filter(name => name.endsWith('.mjs'));
    const changed = Math.max(...await Promise.all(files.map(async name => (await fs.stat(path.join(root, 'lib', name))).mtimeMs)));
    if (running?.pid && running.started < changed) {
      process.kill(running.pid);
      for (let tries = 0; tries < 20 && listening?.code === 'EADDRINUSE'; tries++) { await new Promise(resolve => setTimeout(resolve, 150)); listening = await listen(); }
    }
  }
  // Already running (opened from the menu earlier): show that one.
  if (listening?.code === 'EADDRINUSE') {
    console.log(JSON.stringify({url: origin, existing: true}));
    if (open) await openURL(page);
    return null;
  }
  if (listening) throw listening;
  console.log(JSON.stringify({url: origin, pid: process.pid}));
  if (open) await openURL(page);
  const close = () => { server.closeAllConnections(); server.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  return server;
}
