import fs from 'node:fs/promises';
import fsSync, {createReadStream} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {outputDir, cacheDir, run, probe, readJSON, writeJSON, stepLog} from './common.mjs';
import {loadProject, cursorEvents} from './project.mjs';
import {cleanVoice} from './clean.mjs';
import {workspace, headless, stills, renderVideo} from './compose.mjs';
import {createHash} from 'node:crypto';
import {demoFrames, playedClips, clipFrames} from '../render/timing.js';

const types = {html: 'text/html', js: 'application/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif', json: 'application/json', wav: 'audio/wav', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac'};

// routes: POST handlers ({"/save": async body => result}), for the live editor.
export async function assetServer(files, routes = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && routes[req.url]) {
      res.setHeader('Content-Type', 'application/json');
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4e6) throw new Error('too large'); }
        res.end(JSON.stringify(await routes[req.url](JSON.parse(body || '{}'), req)));
      } catch (error) { res.writeHead(400); res.end(JSON.stringify({error: error.message})); }
      return;
    }
    const file = files.get(req.url.split('?')[0]);
    if (!file) { res.writeHead(404); res.end(); return; }
    try {
      const {size} = await fs.stat(file);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', types[path.extname(file).slice(1).toLowerCase()] || 'video/mp4');
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || end < start) { res.writeHead(416); res.end(); return; }
      if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); }
      res.setHeader('Content-Length', end - start + 1);
      const stream = createReadStream(file, {start, end});
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, origin: `http://127.0.0.1:${server.address().port}`};
}

// A page as a PNG at exactly width × height, drawn by the renderer's headless Chrome (framed screenshots):
// no window, and no browser of the user's needed.
export async function capturePage(url, width, height) {
  const {screenshotPage} = await import('./browser.mjs');
  return headless(at => screenshotPage(at, url, width, height));
}

// The panel's button tap ('press' in ui/index.html): a 520→420 Hz triangle and a faint 1250→900 Hz sine, both fading out.
// A key press: a short, bright tap; each one a little louder or softer, like a real keyboard.
const keySound = level => `anoisesrc=d=0.035:c=pink:a=${level.toFixed(2)}:s=48000,highpass=f=1800,lowpass=f=7000,afade=t=out:d=0.035:curve=exp,volume=7dB,aformat=channel_layouts=stereo`;
export const tick = "aevalsrc=exprs='0.56*0.6366*asin(sin(611.9*(1-pow(0.8077,t/0.04))))*exp(-t*184)+0.175*sin(478.2*(1-pow(0.72,t/0.02)))*exp(-t*311)':d=0.06:s=48000,aformat=channel_layouts=stereo";

export function progress() {
  let last = -1;
  return ({progress}) => { const percent = Math.floor(progress * 10) * 10; if (percent !== last) { console.error(`Rendering ${percent}%`); last = percent; } };
}

// The sound: the recording's track, or with the mic or the system sound switched off (audio.mic / audio.system),
// the other one saved apart (audio.stems), or none (heard: null). on: the kinds left in.
export function heardTrack(project, directory) {
  const sound = project.audio || {};
  const recorded = ['mic', 'system'].filter(kind => kind in sound), on = recorded.filter(kind => sound[kind] !== false);
  return {on, heard: on.length === recorded.length ? path.resolve(directory, project.source) : on.length ? path.resolve(directory, sound.stems[on[0]]) : null};
}

// What the Demo composition draws from: the project, cursor, captions and camera parts. url(file) is the address
// the page loads a media file from (the render's own server, or the panel's).
export async function projectProps(project, directory, url) {
  const source = path.resolve(directory, project.source);
  const transcriptFile = project.transcript ? path.resolve(directory, project.transcript) : source.replace(/\.[^.]+$/, '.json');
  const transcript = await readJSON(transcriptFile).catch(error => { if (project.transcript) throw error; return {segments: []}; });
  const events = await cursorEvents(project, directory);
  let offset = 0;
  const webcams = (project.webcam?.enabled === false ? [] : project.webcam?.segments || []).map(segment => {
    const item = {start: offset, end: offset + segment.duration, sourceOffset: segment.sourceOffset || 0, url: url(path.resolve(directory, segment.source))};
    offset += segment.duration;
    return item;
  });
  // A still for every freeze, taken once from the recording (cached by recording and second).
  const holds = {};
  for (const clip of project.clips.filter(clip => clip.hold)) {
    const at = Math.max(0, Math.min(clip.start, project.duration - 0.05));
    const still = path.join(cacheDir, 'holds', `${createHash('sha256').update(`${source}|${(await fs.stat(source)).mtimeMs}|${at}`).digest('hex').slice(0, 16)}.png`);
    if (!await fs.access(still).then(() => true, () => false)) {
      await fs.mkdir(path.dirname(still), {recursive: true});
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', source, '-frames:v', '1', still]);
    }
    holds[clip.start.toFixed(3)] = url(still);
  }
  return {project, sourceUrl: url(source), events, clicks: events.filter(event => event.type === 'click'), transcript: transcript.segments || [], webcams, holds};
}

// Frames of a recording's edit at chosen times of the finished video (seconds), stamped with that time and the
// recording's own second, tiled into one picture. Every 1/12 of the video when no times are given.
export async function renderProjectFrames(file, {from, to, at, every, output} = {}) {
  const {directory, project} = await loadProject(file);
  const {width, height, fps} = project.export;
  const frames = demoFrames(project);
  const duration = frames / fps;
  let times = at;
  if (!times) {
    const [start, end] = [from ?? 0, Math.min(to ?? duration, duration)];
    const step = every || Math.max(0.25, (end - start) / 12);
    times = [];
    for (let time = start; time < end - 1e-6 && times.length < 48; time += step) times.push(+time.toFixed(3));
  }
  if (!times.length || times.some(time => !Number.isFinite(time))) throw new Error('Give times as seconds or m:ss (--at 3,1:20 or --from 0 --to 30 --every 2)');
  output = path.resolve(output || file.replace(/\.project\.json$/, '.frames.png'));
  const space = await workspace();
  const folder = await fs.mkdtemp(path.join(cacheDir, 'frames-'));
  try {
    const props = await projectProps(project, directory, space.url);
    const config = {width, height, fps, durationInFrames: frames};
    await space.write({kind: 'demo', props, config});
    await stills(space, config, times.map((time, index) => ({time: Math.min(frames - 1, Math.max(0, Math.round(time * fps))) / fps,
      output: path.join(folder, `frame-${String(index).padStart(3, '0')}.png`)})), {query: '?stamp'});
    const columns = Math.min(4, times.length);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', path.join(folder, 'frame-%03d.png'),
      '-vf', `scale=640:-2,pad=iw+6:ih+6:3:3:black,tile=${columns}x${Math.ceil(times.length / columns)}`, '-frames:v', '1', output]);
  } finally { await space.remove(); await fs.rm(folder, {recursive: true, force: true}); }
  return {frames: output, times, duration: +duration.toFixed(2)};
}

export async function renderProject(file, options = {}) {
  const started = performance.now();
  const {directory, project} = await loadProject(file);
  // The finished video goes to the user's folder; older projects (no id) render next to themselves.
  const output = path.resolve(options.output || (project.id ? path.join(outputDir, `${project.name || 'recording'}-${project.id}.mp4`) : file.replace(/\.project\.json$/, '.edited.mp4')));
  const source = path.resolve(directory, project.source);
  if (output === source || output === path.resolve(file)) throw new Error('Render output must not overwrite the source or project');
  await fs.mkdir(path.dirname(output), {recursive: true});
  await fs.mkdir(path.join(cacheDir, 'render'), {recursive: true});
  const scratch = await fs.mkdtemp(path.join(cacheDir, 'render', 'job-'));
  const space = await workspace();
  // Steps with timings for the panel (projects only, and not for a single preview frame).
  const step = stepLog(project.id && options.frame === undefined ? directory : null, 'render');
  try {
    const {inputProps, composition} = await step('Prepare the edit', async update => {
      const inputProps = await projectProps(project, directory, space.url);
      const {width, height, fps} = project.export;
      const composition = {width, height, fps, durationInFrames: demoFrames(project)};
      await space.write({kind: 'demo', props: inputProps, config: composition});
      update(`${composition.durationInFrames} frames, ${width}×${height}, ${project.zooms.length} zooms, ${project.clips.length} clips`);
      return {inputProps, composition};
    });
    if (options.frame !== undefined) {
      const frame = Number(options.frame);
      if (!Number.isInteger(frame) || frame < 0 || frame >= composition.durationInFrames) throw new Error('Preview frame is outside the composition');
      await stills(space, composition, [{time: frame / composition.fps, output}]);
      return {output, frame, elapsedSeconds: (performance.now() - started) / 1000};
    }
    const video = path.join(scratch, 'video.mp4');
    const shown = progress();
    const {heard, on} = heardTrack(project, directory);
    const hasAudio = Boolean(heard) && (await probe(heard)).streams.some(stream => stream.codec_type === 'audio');
    // The mic's background noise is removed before the loudness step lifts it (audio.denoise, on unless the
    // system sound is heard: the speech model would remove music too). Made once, kept in the project.
    // It runs while the frames are drawn: one after the other it doubled the render time.
    let voice = heard || source, cleaning = Promise.resolve();
    if (hasAudio && (project.audio?.denoise ?? !on.includes('system'))) {
      voice = path.join(directory, path.basename(heard).replace(/\.[^.]+$/, '.clean.wav'));
      const fresh = await fs.stat(voice).then(clean => clean.mtimeMs > fsSync.statSync(heard).mtimeMs, () => false);
      cleaning = step('Clean the voice: background noise', () => fresh ? 'done before, reused' : cleanVoice(heard, voice).then(() => 'DeepFilterNet'));
      cleaning.catch(() => {});
    }
    await step('Render the frames', update => renderVideo(space, video, {fps: composition.fps, crf: project.export.crf,
      progress: done => { shown({progress: done}); update(`${Math.round(done * composition.durationInFrames)} / ${composition.durationInFrames} frames`); }}).then(() => `${composition.durationInFrames} frames`));
    await cleaning;
    // Lifting a track with nobody talking to speech loudness turns a key press or a bump into a thump: only normalize
    // when at least 2 seconds sound like speech (a cleaned silent mic sits near -75 dB, its bursts last under a second).
    const seconds = hasAudio && project.audio?.normalize ? (await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', voice, '-af', 'asetnsamples=48000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-']))
      .match(/RMS_level=\S+/g)?.map(item => Number(item.split('=')[1])) || [] : [];
    const normalize = project.audio?.normalize && seconds.filter(level => level > -35).length >= 2;
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', voice];
    const fps = project.export.fps;
    const duration = composition.durationInFrames / fps;
    const filters = [];
    const labels = [];
    if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    if (project.intro) {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${Math.round(project.intro.duration * fps) / fps}[intro]`); labels.push('[intro]');
    }
    // What plays, as render/parts.jsx draws it (playedClips): each part at its speed (atempo keeps the voice's pitch),
    // a freeze in silence, a speed ramp as its short slices.
    const played = playedClips(project);
    played.forEach((clip, index) => {
      const length = clipFrames(clip, fps) / fps;
      filters.push(clip.hold ? `anullsrc=r=48000:cl=stereo,atrim=duration=${length}[clip${index}]`
        : `[${hasAudio ? '1:a:0' : '2:a:0'}]atrim=start=${hasAudio ? clip.start : 0}:duration=${length * clip.speed},asetpts=PTS-STARTPTS${clip.speed !== 1 ? `,atempo=${clip.speed}` : ''},aresample=48000,apad,atrim=duration=${length}[clip${index}]`);
      labels.push(`[clip${index}]`);
    });
    if (project.outro) {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${Math.round(project.outro.duration * fps) / fps}[outro]`); labels.push('[outro]');
    }
    filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1${normalize ? ',loudnorm=I=-16:TP=-1.5:LRA=11' : ''}[voice]`);
    // A soft tick on every click (and a tap on every typed key, with audio.keys) that survives the cuts,
    // placed on the output timeline. Keys sped up past 2x stay silent: a buzz, not typing.
    const ticks = [];
    const keys = [];
    const keyEvents = project.audio?.keys ? inputProps.events.filter(event => event.type === 'key') : [];
    let start = project.intro ? Math.round(project.intro.duration * fps) / fps : 0;
    for (const clip of played) {
      const at = event => start + (event.t - clip.start) / clip.speed;
      const inside = event => !clip.hold && event.visible !== false && event.t >= clip.start && event.t < clip.end;
      if (project.audio?.clicks !== false) ticks.push(...inputProps.clicks.filter(inside).map(at));
      if (clip.speed <= 2) keys.push(...keyEvents.filter(inside).map(at));
      start += clipFrames(clip, fps) / fps;
    }
    const sounds = [...ticks.map(time => ({time, source: tick})), ...keys.map((time, index) => ({time, source: keySound(0.8 + 0.2 * Math.sin(index * 2.7))}))];
    if (sounds.length) {
      sounds.forEach(({time, source}, index) => filters.push(`${source},adelay=${Math.round(time * 1000)}:all=1[click${index}]`));
      filters.push(`[voice]${sounds.map((_, index) => `[click${index}]`).join('')}amix=inputs=${sounds.length + 1}:duration=first:normalize=0[audio]`);
    } else filters.push('[voice]anull[audio]');
    const final = path.join(scratch, 'final.mp4');
    args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[audio]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-t', String(duration), '-movflags', '+faststart', final);
    await step('Audio: cut to the edit, loudness, click sounds', () => run('ffmpeg', args).then(() => `${ticks.length} click sound${ticks.length === 1 ? '' : 's'}${keys.length ? `, ${keys.length} key sounds` : ''}${normalize ? ', normalized' : project.audio?.normalize ? ', too quiet to normalize (no speech)' : ''}`));
    await step('Check and save', async () => {
      const metadata = await probe(final);
      if (metadata.streams.filter(stream => stream.codec_type === 'audio').length !== 1 || metadata.streams.filter(stream => stream.codec_type === 'video').length !== 1) throw new Error('Export track verification failed');
      if (Math.abs(Number(metadata.format.duration) - duration) > 0.15) throw new Error('Export duration verification failed');
      await fs.copyFile(final, output);
      return `1 video + 1 audio track, ${duration.toFixed(1)} s → ${path.basename(output)}`;
    });
    const result = {output, duration, width: composition.width, height: composition.height, frames: composition.durationInFrames, elapsedSeconds: (performance.now() - started) / 1000};
    // A render to --out is a test: the project's finished video (what the panel shows) stays the same.
    if (!options.output) await writeJSON(file.replace(/\.project\.json$/, '.render.json'), result);
    return result;
  } finally {
    await space.remove();
    await fs.rm(scratch, {recursive: true, force: true});
  }
}
