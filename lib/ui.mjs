// flikka app panel: the recording panel. Projects on the left, a new recording with camera and mic
// preview, and each project's page: its video, the steps that made it with their timings, and its id for an agent.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import os from 'node:os';
import {pipeline} from 'node:stream/promises';
import {root, run, build, projectsDir, cacheDir, readJSON, trace} from './common.mjs';
import {shotsDir, shotCommand} from './shot.mjs';
import {voicesDir, voiceCommand} from './voice.mjs';
import {renameProject, removeProject, storedProject, editProject, loadProject, timelineProject, undoProject} from './project.mjs';

// A fixed address, so the browser remembers the camera and mic permission between runs.
const port = Number(process.env.FLIKKA_UI_PORT || 9341);
const types = {'.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.wav': 'audio/wav', '.mov': 'video/quicktime', '.m4a': 'audio/mp4'};
const voiceName = name => /^[\w-]+$/.test(name || '') ? name : (() => { throw new Error('A voice name is letters, digits, - or _'); })();
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
    edited: project && (await fs.stat(path.join(folder, 'recording.project.json'))).mtimeMs, switches: project && switches(project), speed: project && {whole: project.speed || 1, parts: project.clips.some(clip => clip.speed)}, camera: project?.webcam && {round: project.webcam.round !== false, size: project.webcam.size, position: project.webcam.position}, steps: steps || [], prompt: `Use /flikka to edit project ${id}: `};
}

// The parts of the recording that can be left out of the video, each on or off. The mic and system sound
// only apart when both were saved apart too.
function switches({audio = {}, webcam, zooms = [], cursor, cursorBaked, cursorEnabled}) {
  const apart = !('mic' in audio && 'system' in audio) || audio.stems;
  return {...(apart && 'mic' in audio && {mic: audio.mic}), ...(apart && 'system' in audio && {system: audio.system}), ...(webcam && {webcam: webcam.enabled !== false}),
    clicks: audio.clicks !== false, zooms: zooms.length > 0, ...(cursor && !cursorBaked && {cursor: cursorEnabled !== false})};
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
async function writePreview(id) {
  const folder = await storedProject(id);
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
  const {width, height} = project.export;
  await space.write({kind: 'demo', props, config: {width, height, fps: 30, durationInFrames: Math.max(1, demoFrames(project, 30))}});
  return {width, height};
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
            : url.searchParams.get('kind') === 'try' ? tried(name) : path.join(voicesDir, `${voiceName(name)}.wav`);
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
      if (url.pathname === '/voice-add') {
        const name = voiceName(url.searchParams.get('name'));
        if (Number(req.headers['content-length'] || 0) > 200e6) throw new Error('That file is too big (200 MB at most)');
        const upload = path.join(os.tmpdir(), `flikka-voice-upload-${randomBytes(6).toString('hex')}`);
        try {
          await pipeline(req, createWriteStream(upload));
          res.end(JSON.stringify(await cli(['voice', 'add', name, '--from', upload])));
        } finally { await fs.rm(upload, {force: true}); }
        return;
      }
      let data = '';
      for await (const chunk of req) { data += chunk; if (data.length > 16384) throw new Error('Request too large'); }
      const body = JSON.parse(data || '{}');
      if (body.id !== undefined && !/^[\w-]+$/.test(body.id)) throw new Error('Invalid project ID');
      let result;
      // Quick ones run here; a new node process for each took a moment (the page asks for shots every 3 s).
      if (!['/projects', '/project', '/project-timeline', '/shots', '/voices'].includes(url.pathname)) trace('ui', url.pathname.slice(1) + (body.id ? ' ' + body.id : ''));
      if (url.pathname === '/sources') result = await listSources();
      else if (url.pathname === '/projects') result = await projects();
      else if (url.pathname === '/project') result = await summary(body.id) || (() => { throw new Error('No such project'); })();
      // What the finished video holds, in its own seconds, for the timeline under the player.
      else if (url.pathname === '/project-timeline') result = await timelineProject(path.join(await storedProject(body.id), 'recording.project.json'));
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
      } else if (url.pathname === '/render') result = await cli(['project', 'render', body.id]);
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
        result = await editProject(path.join(await storedProject(body.id), 'recording.project.json'), [option, body.on ? 'on' : 'off']);
      } else if (url.pathname === '/project-camera') {
        const settings = Object.entries(body.camera || {}).map(([key, value]) => `${key}=${typeof value === 'boolean' ? (value ? 'on' : 'off') : value}`).join(',');
        result = await editProject(path.join(await storedProject(body.id), 'recording.project.json'), ['--camera', settings]);
      } else if (url.pathname === '/project-speed') result = await editProject(path.join(await storedProject(body.id), 'recording.project.json'), ['--speed', String(Number(body.speed))]);
      // Edits made on the timeline, in the video's own seconds: cut a range, add a zoom, move or remove one.
      else if (url.pathname === '/project-timeline-edit') {
        const time = value => { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error('Times are seconds in the video'); return number.toFixed(3); };
        const args = ['--output-time'];
        if (body.cut) args.push('--cut', `${time(body.cut[0])},${time(body.cut[1])}`);
        if (body.unzoom !== undefined) args.push('--unzoom', time(body.unzoom));
        if (body.zoom) {
          const {from, to, x, y, scale} = body.zoom;
          args.push('--zoom', [time(from), time(to), Number(x), Number(y), Number(scale || 1.5)].join(','));
        }
        if (args.length === 1) throw new Error('Nothing to change');
        result = await editProject(path.join(await storedProject(body.id), 'recording.project.json'), args);
      } else if (url.pathname === '/project-undo') result = await undoProject(path.join(await storedProject(body.id), 'recording.project.json'));
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
      // A failed flikka command ends its stderr with {"error": …}: show that, not the whole command line.
      let message = error.message;
      try { message = JSON.parse(error.stderr.trim().split('\n').at(-1)).error || message; } catch {}
      res.writeHead(400); res.end(JSON.stringify({error: message}));
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
