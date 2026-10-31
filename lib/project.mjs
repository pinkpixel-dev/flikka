import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {probe, readJSON, writeJSON, run, execute, projectsDir, outputDir, root} from './common.mjs';
import {toSource, toOutput, segments, seconds, clock, demoFrames} from '../render/timing.js';

const finite = (value, minimum, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
// square (1:1) is the default: X, LinkedIn and Instagram show it big on a phone and on a computer, and a desktop
// recording fits whole, so it still looks like a desktop. vertical (9:16) is for Shorts, Reels and TikTok, portrait
// (4:5) fills a phone's feed, landscape (16:9) is for YouTube.
export const presets = {square: [1080, 1080], vertical: [1080, 1920], portrait: [1080, 1350], landscape: [1920, 1080]};
// Wallpapers behind the recording (any CSS background works too: edit --background '<css>').
export const backgrounds = {
  aurora: 'radial-gradient(60% 80% at 15% 20%, #6d4aff 0%, transparent 60%), radial-gradient(55% 70% at 85% 85%, #13c2b4 0%, transparent 60%), radial-gradient(50% 60% at 80% 10%, #ff5fa2 0%, transparent 55%), #0f1226',
  sunset: 'radial-gradient(70% 90% at 10% 100%, #ff7a3d 0%, transparent 60%), radial-gradient(60% 80% at 90% 0%, #a43dff 0%, transparent 60%), linear-gradient(135deg, #ff4f7b, #4b1d8f)',
  ocean: 'radial-gradient(60% 80% at 20% 0%, #3ac7ff 0%, transparent 60%), radial-gradient(60% 80% at 100% 100%, #2b4cff 0%, transparent 60%), linear-gradient(160deg, #0a2a5c, #06142e)',
  meadow: 'radial-gradient(60% 80% at 0% 0%, #b6f36a 0%, transparent 60%), radial-gradient(60% 80% at 100% 100%, #1fa37a 0%, transparent 60%), linear-gradient(135deg, #2f8f5b, #0f3d3a)',
  graphite: 'radial-gradient(80% 80% at 50% 0%, #3a3f4b 0%, transparent 70%), linear-gradient(180deg, #1c1f26, #0d0f13)',
  midnight: '#141829',
};
// Videos are square: watched on a phone or a computer, recorded on a desktop (render/parts.jsx fits it whole).
// Another shape is one edit away (--preset); in a tall one a wide screen shows in a window that follows the action.
export const exportSize = () => ({width: presets.square[0], height: presets.square[1]});
export const defaultStyle = () => ({background: backgrounds.aurora, padding: 64, radius: 20, shadow: true, cursorSize: 32, clickColor: '#8b9dff'});

export function validate(project) {
  if (project.version !== 1 || typeof project.source !== 'string') throw new Error('Expected a version 1 project with a source video');
  if (!finite(project.duration, 0.01, 86400)) throw new Error('Project duration must be 0.01–86400 seconds');
  if (![project.width, project.height].every(value => Number.isInteger(value) && value >= 2 && value <= 16384)) throw new Error('Invalid source dimensions');
  if (!Array.isArray(project.clips) || !project.clips.length) throw new Error('At least one clip is required');
  for (const clip of project.clips) {
    // A freeze: one moment (start = end) held for `hold` seconds.
    if ('hold' in clip ? !finite(clip.start, 0, project.duration + 0.05) || clip.end !== clip.start || !finite(clip.hold, 0.1, 10)
      : !finite(clip.start, 0, project.duration) || !finite(clip.end, clip.start + 0.001, project.duration + 0.05)) throw new Error('Clip times must be within the source duration and end after start (a freeze: start = end, hold 0.1–10 s)');
  }
  if ('ramp' in project && !finite(project.ramp, 0.2, 2)) throw new Error('Speed ramp must be 0.2–2 seconds');
  // Playback speed: the whole video (speed) or one kept part (a clip's speed, which wins).
  for (const item of [project, ...project.clips]) if ('speed' in item && !finite(item.speed, 0.5, 4)) throw new Error('Speed must be 0.5–4 (1 = as recorded)');
  for (const zoom of project.zooms || []) {
    if (!finite(zoom.start, 0, project.duration) || !finite(zoom.end, zoom.start + 0.01, project.duration + 0.05) || !finite(zoom.x, 0, 1) || !finite(zoom.y, 0, 1) || !finite(zoom.scale, 1, 5)) throw new Error('Invalid zoom: use source times, normalized x/y and scale 1–5');
  }
  const output = project.export;
  if (!output || ![24, 30, 60].includes(output.fps) || ![output.width, output.height].every(value => Number.isInteger(value) && value >= 240 && value <= 7680 && value % 2 === 0)) throw new Error('Export requires even dimensions (240–7680) and fps 24, 30 or 60');
  const style = project.style;
  if (!style || !finite(style.padding, 0, Math.min(output.width, output.height) / 3) || !finite(style.radius, 0, 200) || !finite(style.cursorSize, 0, 200)) throw new Error('Invalid project style');
  const sound = project.audio || {};
  if ('mic' in sound && 'system' in sound && sound.mic !== sound.system && !sound.stems) throw new Error('This recording has the mic and the system sound in one track: they can only be on or off together');
  for (const title of ['intro', 'outro']) {
    if (project[title] && (typeof project[title].text !== 'string' || !finite(project[title].duration, 0.1, 60))) throw new Error(`Invalid ${title}`);
  }
  return project;
}

// A project by id (what stop prints), by path (project JSON or recording mp4), or by --name (newest wins).
export async function findProject(ref, directory = process.cwd()) {
  const exists = file => fs.access(file).then(() => true, () => false);
  const stored = path.join(projectsDir, String(ref), 'recording.project.json');
  if (/^[\w-]+$/.test(ref) && await exists(stored)) return stored;
  const absolute = path.resolve(directory, ref);
  const candidate = absolute.endsWith('.json') ? absolute : absolute.replace(/(\.edited)?\.mp4$/, '.project.json');
  if (await exists(candidate)) return candidate;
  // Older recordings sat side by side as <name>-<id>.project.json.
  const folder = path.dirname(absolute);
  const named = (await fs.readdir(folder).catch(() => [])).filter(name => name.startsWith(`${path.basename(ref)}-`) && name.endsWith('.project.json')).sort();
  if (named.length) return path.join(folder, named.at(-1));
  const found = [];
  for (const id of await fs.readdir(projectsDir).catch(() => [])) {
    const project = await readJSON(path.join(projectsDir, id, 'recording.project.json')).catch(() => null);
    if (project?.name === ref) found.push([project.created || 0, path.join(projectsDir, id, 'recording.project.json')]);
  }
  if (!found.length) throw new Error(`Recording not found: ${ref} (use the project id, the --name you recorded with, or a .project.json path)`);
  return found.sort((first, second) => first[0] - second[0]).at(-1)[1];
}

// A stored project's folder, refusing one that is still recording (its worker writes there).
export async function storedProject(id) {
  const folder = path.join(projectsDir, String(id));
  if (!/^[\w-]+$/.test(id) || !await fs.access(folder).then(() => true, () => false)) throw new Error(`No project ${id}`);
  const session = await readJSON(path.join(folder, 'session.json')).catch(() => null);
  if (['starting', 'recording', 'paused', 'finalizing'].includes(session?.state)) throw new Error(`Project ${id} is still recording: stop it first`);
  return folder;
}

// The finished video's report: a recording's render or a film's.
async function finished(folder) {
  for (const name of ['recording.render.json', 'film.render.json']) {
    const report = await readJSON(path.join(folder, name)).catch(() => null);
    if (report) return [path.join(folder, name), report];
  }
  return [];
}

// A project is a video: a recording (recording.project.json) or a film of scenes (film.json).
// By id, by name (newest wins) or by path; a film.json anywhere still works (films made before films were projects).
export async function openProject(ref) {
  ref = String(ref || '');
  if (!ref) throw new Error('Give a project id (flikka project list)');
  const exists = file => fs.access(file).then(() => true, () => false);
  const film = file => ({kind: 'film', file, folder: path.dirname(file), id: path.dirname(file).startsWith(projectsDir + path.sep) ? path.basename(path.dirname(file)) : null});
  if (/\.json$/.test(ref) && !ref.endsWith('.project.json') && await exists(path.resolve(ref))) return film(path.resolve(ref));
  if (/^[\w-]+$/.test(ref) && await exists(path.join(projectsDir, ref, 'film.json'))) return film(path.join(projectsDir, ref, 'film.json'));
  const named = (await listProjects()).filter(item => item.kind === 'film' && item.name === ref);
  if (named.length) return film(named[0].file);
  const file = await findProject(ref);
  return {kind: 'recording', file, folder: path.dirname(file), id: path.dirname(file).startsWith(projectsDir + path.sep) ? path.basename(path.dirname(file)) : null};
}

export async function describeProject(id) {
  const folder = path.join(projectsDir, id);
  const [config, project, report] = await Promise.all([readJSON(path.join(folder, 'config.json')).catch(() => null),
    readJSON(path.join(folder, 'recording.project.json')).catch(() => null), finished(folder).then(([, report]) => report)]);
  const kind = await fs.access(path.join(folder, 'film.json')).then(() => 'film', () => project ? 'recording' : null);
  if (!kind) return null;
  const video = report && await fs.access(report.output).then(() => report.output, () => null);
  return {id, kind, name: project?.name || config?.name || id, created: new Date(config?.created || project?.created || (await fs.stat(folder)).birthtimeMs).toISOString(),
    file: path.join(folder, kind === 'film' ? 'film.json' : 'recording.project.json'), ...(project && {seconds: +project.duration.toFixed(1)}), video};
}

export async function listProjects() {
  const ids = (await fs.readdir(projectsDir).catch(() => [])).filter(name => /^[\w-]+$/.test(name));
  return (await Promise.all(ids.map(id => describeProject(id).catch(() => null)))).filter(Boolean).sort((first, second) => second.created.localeCompare(first.created));
}

// A new film: a project whose film.json the agent writes. --with puts recordings in as its first scenes.
export async function newFilm(name, recordings = []) {
  name = String(name || '').trim();
  if (!name || name.length > 80 || /[/\\:]/.test(name)) throw new Error('Usage: flikka project new <name> [--with <recording id>,<id>…]');
  const scenes = [{type: 'title', title: name}];
  for (const ref of recordings) scenes.push({type: 'recording', recording: (await openProject(ref)).id || ref});
  const id = randomUUID().slice(0, 8), folder = path.join(projectsDir, id);
  await writeJSON(path.join(folder, 'config.json'), {id, name, created: Date.now()});
  await writeJSON(path.join(folder, 'film.json'), {$schema: path.join(root, 'lib/film.schema.json'), scenes});
  return {id, film: path.join(folder, 'film.json'), next: 'Write the scenes in film.json (flikka project schema), then: flikka project preview ' + id};
}

// A film project's finished video goes where recordings' do: ~/Documents/flikka/<name>-<id>.mp4 (a clone, no extra space).
export async function publishFilm(id, report) {
  const {name} = await describeProject(id);
  const output = path.join(outputDir, `${name}-${id}.mp4`);
  await fs.mkdir(outputDir, {recursive: true});
  await fs.rm(output, {force: true});
  await fs.copyFile(report.output, output, fs.constants.COPYFILE_FICLONE);
  await writeJSON(path.join(projectsDir, id, 'film.render.json'), {...report, output, film: report.output});
  return {...report, output};
}

// Renames the project and its finished video (<name>-<id>.mp4), so both keep matching.
export async function renameProject(id, name) {
  name = String(name || '').trim();
  if (!name || name.length > 80 || /[/\\:]/.test(name)) throw new Error('Give a name of up to 80 characters, without / \\ or :');
  const folder = await storedProject(id);
  for (const file of ['recording.project.json', 'config.json']) {
    const data = await readJSON(path.join(folder, file)).catch(() => null);
    if (data) await writeJSON(path.join(folder, file), {...data, name});
  }
  const [reportFile, report] = await finished(folder);
  if (report && path.basename(report.output).endsWith(`-${id}.mp4`) && await fs.access(report.output).then(() => true, () => false)) {
    const output = path.join(path.dirname(report.output), `${name}-${id}.mp4`);
    await fs.rename(report.output, output);
    await writeJSON(reportFile, {...report, output});
  }
  return {id, name};
}

// Moves the project folder and its finished video to the Trash (recoverable), never a hard delete.
export async function removeProject(id) {
  const folder = await storedProject(id);
  const [, report] = await finished(folder);
  const files = [folder];
  if (report && await fs.access(report.output).then(() => true, () => false)) files.push(report.output);
  const hasBinary = async name => {
    for (const p of (process.env.PATH || '').split(':').filter(Boolean)) {
      if (await fs.access(path.join(p, name), fs.constants.X_OK).then(() => true, () => false)) return true;
    }
    return false;
  };
  if (await hasBinary('gio')) await run('gio', ['trash', ...files]).catch(() => Promise.all(files.map(f => fs.rm(f, {recursive: true, force: true}))));
  else if (await hasBinary('trash')) await run('trash', files).catch(() => Promise.all(files.map(f => fs.rm(f, {recursive: true, force: true}))));
  else await Promise.all(files.map(f => fs.rm(f, {recursive: true, force: true})));
  return {removed: id, trashed: files};
}

export async function loadProject(file) {
  const absolute = path.resolve(file);
  return {file: absolute, directory: path.dirname(absolute), project: validate(await readJSON(absolute))};
}

export async function createProject(source, destination) {
  source = path.resolve(source);
  const metadata = await probe(source);
  const video = metadata.streams.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Source has no video');
  destination = path.resolve(destination || source.replace(/\.[^.]+$/, '.project.json'));
  const base = source.replace(/\.[^.]+$/, '');
  const exists = async file => fs.access(file).then(() => true, () => false);
  const duration = Number(metadata.format.duration);
  const [numerator, denominator] = video.r_frame_rate.split('/').map(Number);
  const fps = [24, 30, 60].find(value => Math.abs(value - numerator / denominator) < 1) || 30;
  const project = {
    version: 1, source: path.relative(path.dirname(destination), source), duration, width: video.width, height: video.height, fps,
    clips: [{start: 0, end: duration}], zooms: [], markers: [],
    cursor: await exists(`${base}.cursor.jsonl`) ? path.relative(path.dirname(destination), `${base}.cursor.jsonl`) : null,
    cursorBaked: true, transcript: await exists(`${base}.json`) ? path.relative(path.dirname(destination), `${base}.json`) : null,
    style: defaultStyle(),
    audio: {normalize: true, clicks: true}, captions: {enabled: true}, export: {...exportSize(video.width, video.height), fps}, webcam: null,
  };
  await fs.access(destination).then(() => { throw new Error(`Project already exists: ${destination}`); }, () => {});
  await writeJSON(destination, validate(project));
  return {project: destination};
}

export function removeInterval(clips, start, end) {
  return clips.flatMap(clip => {
    if (end <= clip.start || start >= clip.end) return [clip];
    return [{...clip, start: clip.start, end: Math.min(start, clip.end)}, {...clip, start: Math.max(end, clip.start), end: clip.end}].filter(item => item.end - item.start >= 0.04);
  });
}

// Intervals ffmpeg reports as <kind>_start/<kind>_end (silencedetect, freezedetect).
async function detect(source, filter, kind, duration) {
  const {stderr} = await execute('ffmpeg', ['-hide_banner', '-i', source, ...filter, '-f', 'null', '-'], {maxBuffer: 16 * 1024 * 1024});
  const intervals = [];
  for (const [, edge, time] of stderr.matchAll(new RegExp(`${kind}_(start|end): ([\\d.]+)`, 'g'))) {
    if (edge === 'start') intervals.push([Number(time), duration]); else if (intervals.length) intervals.at(-1)[1] = Number(time);
  }
  return intervals;
}

export function intersect(first, second) {
  return first.flatMap(([a, b]) => second.map(([c, d]) => [Math.max(a, c), Math.min(b, d)])).filter(([start, end]) => end > start);
}

export async function cursorEvents(project, directory) {
  if (!project.cursor) return [];
  return (await fs.readFile(path.resolve(directory, project.cursor), 'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(event => finite(event.t, 0, project.duration + 1) && Number.isFinite(event.x) && Number.isFinite(event.y)).sort((first, second) => first.t - second.t);
}

// What an edit changed, in a few numbers an agent can compare (duration in the finished video).
const summarize = project => ({duration: +(demoFrames(project) / project.export.fps).toFixed(2), clips: project.clips.length,
  zooms: (project.zooms || []).length, speed: project.speed || 1, size: `${project.export.width}×${project.export.height}`});
const historyFolder = file => path.join(path.dirname(path.resolve(file)), 'history');

// --dry-run: say what would change, save nothing. --output-time: the call's times are in the finished video
// (as it was before this call: what the viewer saw), so "1:20" needs no converting. Every saved edit keeps the
// project as it was in history/, for flikka project undo.
export async function editProject(file, args, {dryRun = false} = {}) {
  const {directory, project} = await loadProject(file);
  const given = [...args];
  args = [...args];
  const flag = name => { const at = args.indexOf(name); if (at >= 0) args.splice(at, 1); return at >= 0; };
  const outputTime = flag('--output-time');
  dryRun = flag('--dry-run') || dryRun;
  const before = structuredClone(project);
  // start,end in the call's times → source seconds.
  const range = (text, usage) => {
    let [start, end] = String(text || '').split(',').map(seconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(usage);
    if (outputTime) {
      const [from, to] = [toSource(before, start), toSource(before, end, {end: true})];
      if (from === null || to === null) throw new Error(`${clock(from === null ? start : end)} is not in the recording part of the video (it is in the intro or outro, or after the end)`);
      [start, end] = [from, to];
    }
    return [start, end];
  };
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--auto-zoom') {
      const events = [...(await cursorEvents(project, directory)).filter(event => event.type === 'click' && event.visible !== false), ...(project.markers || []).filter(marker => Number.isFinite(marker.x))].sort((first, second) => first.t - second.t);
      const zooms = [];
      // A gentle zoom (≤ 1.3x, a recorded pixel ≤ 1.5 video pixels): 1.7x felt like being shoved into the screen.
      const [width, height] = [project.export.width, project.export.height].map(side => side - 2 * project.style.padding);
      const scale = Math.min(1.3, 1.5 / Math.min(2, width / project.width, height / project.height));
      if (scale >= 1.15) for (const event of events) {
        const start = Math.max(0, event.t - 0.35);
        const last = zooms.at(-1);
        if (last && start - last.start < 0.6) continue;
        // Actions under ~2.5 s apart chain: the zoom stays in and pans (no in-out-in jumps); further apart it lets go,
        // so a recording with regular clicks isn't zoomed in from start to end.
        if (last && start < last.end + 0.6) last.end = Math.max(last.start + 0.05, start);
        const x = Math.max(0, Math.min(1, event.x));
        const y = Math.max(0, Math.min(1, event.y));
        zooms.push({start, end: Math.min(project.duration, event.t + 1.6), x, y, scale});
      }
      project.zooms = zooms;
    } else if (option === '--cut-silence' || option === '--cut-idle') {
      const source = path.resolve(directory, project.source);
      let gaps = await detect(source, ['-vn', '-af', 'silencedetect=noise=-40dB:d=0.6'], 'silence', project.duration);
      // Idle = the picture is still and nobody talks: agent think-time, waiting for pages.
      if (option === '--cut-idle') {
        gaps = intersect(gaps, await detect(source, ['-an', '-vf', 'scale=640:-2,freezedetect=n=0.001:d=1'], 'freeze', project.duration));
        // Small changes (typing, the cursor drawn later) don't register as motion: keep time around any activity.
        const activity = [...await cursorEvents(project, directory), ...(project.markers || [])].map(event => event.t);
        gaps = gaps.flatMap(([start, end]) => activity.reduce((pieces, t) => removeInterval(pieces, t - 0.6, t + 1), [{start, end}]).map(piece => [piece.start, piece.end]));
      }
      // Idle cuts keep 1.2 s after the picture settles (the viewer must see the result of an
      // action) and only remove a second or more (shorter cuts read as glitches).
      const [after, before, least] = option === '--cut-idle' ? [1.2, 0.4, 1] : [0.3, 0.3, 0];
      for (const [start, end] of gaps) if (end - start - after - before > least) project.clips = removeInterval(project.clips, start + after, end - before);
    } else if (option === '--reset') {
      project.clips = [{start: 0, end: project.duration}];
      project.zooms = [];
    } else if (option === '--preset') {
      const preset = presets[args[++index]];
      if (!preset) throw new Error(`Preset must be ${Object.keys(presets).join(', ')}`);
      [project.export.width, project.export.height] = preset;
    } else if (option === '--background') {
      const value = args[++index];
      if (!value) throw new Error(`Background must be one of ${Object.keys(backgrounds).join(', ')} or a CSS background`);
      project.style.background = backgrounds[value] || value;
    } else if (option === '--transcript') project.transcript = path.relative(directory, path.resolve(args[++index]));
    else if (option === '--cut') {
      const [start, end] = range(args[++index], 'Cut takes start,end (seconds or m:ss; in the recording, or in the video with --output-time)');
      if (!finite(start, 0, project.duration) || !finite(end, start + 0.001, project.duration + 0.05)) throw new Error('Cut must be start,end within the recording');
      project.clips = removeInterval(project.clips, start, end);
    } else if (['--mic', '--system-audio', '--webcam'].includes(option)) {
      // What the recording had can be left out of the video and put back: on | off.
      const value = args[++index];
      if (!['on', 'off'].includes(value)) throw new Error(`${option} takes on or off`);
      const kind = {'--mic': 'mic', '--system-audio': 'system'}[option];
      if (kind ? !(kind in (project.audio || {})) : !project.webcam) throw new Error(`This recording has no ${{mic: 'microphone', system: 'system sound'}[kind] || 'webcam'}`);
      if (kind) project.audio[kind] = value === 'on'; else project.webcam.enabled = value === 'on';
    } else if (option === '--camera') {
      // The camera bubble's look: round (a circle) or a rounded rectangle, size (share of the width), corner.
      if (!project.webcam) throw new Error('This recording has no webcam');
      for (const pair of (args[++index] || '').split(',')) {
        const [key, value] = pair.split('=');
        if (key === 'round' && ['on', 'off'].includes(value)) project.webcam.round = value === 'on';
        else if (key === 'size' && finite(Number(value), 0.1, 0.45)) project.webcam.size = Number(value);
        else if (key === 'position' && ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(value)) project.webcam.position = value;
        else throw new Error('--camera takes round=on|off, size=0.1–0.45, position=bottom-right|bottom-left|top-right|top-left (comma separated)');
      }
    } else if (option === '--speed') {
      // --speed 1.5: the whole video; --speed 2,10,25: source seconds 10–25 only (that part's clips are split there).
      const [first, ...times] = (args[++index] || '').split(',');
      const speed = Number(first);
      if (!finite(speed, 0.5, 4) || ![0, 2].includes(times.length)) throw new Error('--speed takes 0.5–4, optionally with a range: --speed 2,start,end');
      if (!times.length) { project.speed = speed; for (const clip of project.clips) delete clip.speed; }
      else {
        const [start, end] = range(times.join(','), '--speed range must be start,end (seconds or m:ss)');
        if (!finite(start, 0, project.duration) || !finite(end, start + 0.04, project.duration + 0.05)) throw new Error('--speed range must be within the recording');
        project.clips = project.clips.flatMap(clip => clip.hold ? [clip] : [[clip.start, Math.min(start, clip.end)], [Math.max(start, clip.start), Math.min(end, clip.end)], [Math.max(end, clip.start), clip.end]]
          .map(([from, to], part) => ({...clip, start: from, end: to, ...(part === 1 && {speed})})).filter(item => item.end - item.start >= 0.04));
      }
    } else if (option === '--trim') {
      // Keep only start–end: everything before and after is cut (freezes in there too).
      const [start, end] = range(args[++index], '--trim takes start,end (seconds or m:ss)');
      if (!finite(start, 0, project.duration) || !finite(end, start + 0.04, project.duration + 0.05)) throw new Error('--trim must be within the recording');
      project.clips = removeInterval(removeInterval(project.clips, -1, start), end, project.duration + 1).filter(clip => !clip.hold || (clip.start >= start && clip.start <= end));
      if (!project.clips.length) throw new Error('--trim would leave nothing of the video');
    } else if (option === '--freeze') {
      // --freeze at,seconds: hold the picture at that moment (a still, the cursor where it was, no sound).
      const [atText, holdText] = String(args[++index] || '').split(',');
      let at = seconds(atText);
      const hold = Number(holdText);
      if (!Number.isFinite(at) || !finite(hold, 0.1, 10)) throw new Error('--freeze takes at,seconds: a moment (seconds or m:ss) and how long to hold it (0.1–10)');
      if (outputTime) {
        const source = toSource(before, at);
        if (source === null) throw new Error(`${clock(at)} is not in the recording part of the video`);
        at = source;
      }
      const target = project.clips.findIndex(clip => !clip.hold && at >= clip.start && at < clip.end);
      if (target < 0) throw new Error(`${clock(at)} of the recording was cut: pick a moment that is still in the video (flikka project timeline)`);
      const clip = project.clips[target];
      const pieces = [{...clip, end: at}, {start: at, end: at, hold}, {...clip, start: at}].filter(item => item.hold || item.end - item.start >= 0.04);
      project.clips.splice(target, 1, ...pieces);
    } else if (option === '--ramp') {
      // Ease between speeds over this many seconds instead of jumping (off: jump).
      const value = args[++index];
      if (value === 'off') delete project.ramp;
      else if (finite(Number(value), 0.2, 2)) project.ramp = Number(value);
      else throw new Error('--ramp takes 0.2–2 (seconds) or off');
    } else if (option === '--keys') {
      const value = args[++index];
      if (!['on', 'off'].includes(value)) throw new Error('--keys takes on or off');
      project.audio = {...project.audio, keys: value === 'on'};
    } else if (option === '--cursor') {
      const value = args[++index];
      if (!['on', 'off'].includes(value)) throw new Error('--cursor takes on or off');
      project.cursorEnabled = value === 'on';
    } else if (option === '--clicks' || option === '--zooms') {
      const value = args[++index];
      if (!['on', 'off'].includes(value)) throw new Error(`${option} takes on or off`);
      if (option === '--clicks') project.audio = {...project.audio, clicks: value === 'on'};
      else if (value === 'off') project.zooms = [];
      else args.splice(index + 1, 0, '--auto-zoom');  // on = the automatic zooms again
    } else throw new Error(`Unknown edit option: ${option}`);
  }
  validate(project);
  const changed = Object.keys({...before, ...project}).filter(key => JSON.stringify(before[key]) !== JSON.stringify(project[key]));
  if (dryRun) return {dryRun: true, changes: changed, before: summarize(before), after: summarize(project)};
  if (changed.length) {
    // The project as it was, newest last, at most 50.
    const folder = historyFolder(file);
    await writeJSON(path.join(folder, `${Date.now()}.json`), {time: new Date().toISOString(), file: path.resolve(file), edit: given, project: before});
    const saved = (await fs.readdir(folder)).filter(name => name.endsWith('.json')).sort();
    for (const name of saved.slice(0, -50)) await fs.rm(path.join(folder, name), {force: true});
  }
  await writeJSON(path.resolve(file), project);
  return {project: path.resolve(file), changes: changed, ...summarize(project)};
}

// Everything that happens in the finished video, in its own seconds: the kept parts and the cuts between them,
// zooms, clicks, markers and the words spoken. What an agent reads before editing by --output-time.
export async function timelineProject(file) {
  const {directory, project} = await loadProject(file);
  const fps = project.export.fps;
  const parts = segments(project);
  const at = time => { const value = toOutput(project, time); return value === null ? null : +value.toFixed(2); };
  const duration = demoFrames(project) / fps;
  const cuts = [];
  let previous = 0;
  for (const part of [...parts, {start: project.duration}]) {
    if (part.start - previous > 0.04) cuts.push({source: [+previous.toFixed(2), +part.start.toFixed(2)], at: +(part.from ?? duration - (project.outro?.duration || 0)).toFixed(2)});
    previous = Math.max(previous, part.end ?? previous);
  }
  // A zoom shows wherever it overlaps a kept part (a cut can split it in two).
  const zooms = (project.zooms || []).flatMap(zoom => parts.flatMap(part => {
    const [start, end] = [Math.max(zoom.start, part.start), Math.min(zoom.end, part.end)];
    const place = time => +(part.from + (time - part.start) / part.speed).toFixed(2);
    return end > start ? [{from: place(start), to: place(end), x: zoom.x, y: zoom.y, scale: zoom.scale}] : [];
  }));
  const kept = time => at(time) !== null;
  const clicks = (await cursorEvents(project, directory)).filter(event => event.type === 'click' && event.visible !== false && kept(event.t))
    .map(event => ({at: at(event.t), x: +event.x.toFixed(3), y: +event.y.toFixed(3)}));
  const markers = (project.markers || []).filter(marker => kept(marker.t)).map(marker => ({at: at(marker.t), label: marker.label}));
  // Speech: the words still in the video, grouped back into the transcript's sentences.
  const source = path.resolve(directory, project.source);
  const transcript = await readJSON(project.transcript ? path.resolve(directory, project.transcript) : source.replace(/\.[^.]+$/, '.json')).catch(() => ({segments: []}));
  const speech = (transcript.segments || []).flatMap(segment => {
    const words = (segment.words?.length ? segment.words : [{start: segment.start, end: segment.end, word: segment.text}]).filter(word => kept((word.start + word.end) / 2));
    return words.length ? [{from: at(words[0].start) ?? at((words[0].start + words[0].end) / 2), to: at(words.at(-1).end) ?? at((words.at(-1).start + words.at(-1).end) / 2),
      text: words.map(word => word.word).join('').trim(), ...(words.length < (segment.words?.length || 1) && {partlyCut: true})}] : [];
  });
  return {
    kind: 'recording', duration: +duration.toFixed(2), fps, size: `${project.export.width}×${project.export.height}`,
    ...(project.intro && {intro: {from: 0, to: +(Math.round(project.intro.duration * fps) / fps).toFixed(2), text: project.intro.text}}),
    // A ramp's slices read as one part, with the speeds it eases between; a freeze shows the moment it holds.
    parts: parts.reduce((list, part) => {
      const last = list.at(-1);
      if (part.ramp && last?.ramp) { last.to = +part.to.toFixed(2); last.source[1] = +part.end.toFixed(2); last.speed[1] = +part.speed.toFixed(2); return list; }
      list.push({from: +part.from.toFixed(2), to: +part.to.toFixed(2), source: [+part.start.toFixed(2), +part.end.toFixed(2)],
        ...(part.ramp ? {ramp: true, speed: [+part.speed.toFixed(2), +part.speed.toFixed(2)]} : part.hold ? {freeze: part.hold} : {speed: part.speed})});
      return list;
    }, []),
    cuts, zooms, clicks, markers, speech,
    ...(project.outro && {outro: {from: +(duration - Math.round(project.outro.duration * fps) / fps).toFixed(2), to: +duration.toFixed(2), text: project.outro.text}}),
    note: 'Times are seconds in the finished video. Edit with them directly: flikka project edit <id> --output-time --cut 1:20,1:25',
  };
}

// Put the project back as it was before its last saved edit.
export async function undoProject(file) {
  const folder = historyFolder(file);
  const saved = (await fs.readdir(folder).catch(() => [])).filter(name => name.endsWith('.json')).sort();
  for (const name of saved.reverse()) {
    const entry = await readJSON(path.join(folder, name)).catch(() => null);
    if (entry?.file !== path.resolve(file)) continue;
    await writeJSON(path.resolve(file), validate(entry.project));
    await fs.rm(path.join(folder, name), {force: true});
    return {project: path.resolve(file), undone: entry.edit, editedAt: entry.time, ...summarize(entry.project)};
  }
  throw new Error('Nothing to undo: no saved edits for this project');
}
