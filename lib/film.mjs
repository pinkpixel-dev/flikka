// A film (flikka project render <id> of a film project): one storyboard file in, one finished launch video out.
// Narration, captions, music, scene timing and checks are all derived here, so the
// agent only writes what each scene shows and what the narrator says.
// One preparation step (prepareFilm) feeds four outputs: the export, a contact-sheet
// preview, frames at chosen times, and a live player in the browser.
import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {root, cacheDir, run, execute, probe, readJSON, writeJSON, python} from './common.mjs';
import {loadProject, cursorEvents, findProject} from './project.mjs';
import {assetServer, tick, progress} from './render.mjs';
import {workspace, stills, renderVideo, playerScript} from './compose.mjs';
import {checkFilm} from './check.mjs';
import {validate} from './schema.mjs';

export const schemaFile = path.join(root, 'lib/film.schema.json');
const themes = {
  dark: {background: 'radial-gradient(ellipse at 30% 20%, #1d2440 0%, #0d1020 70%)', text: '#f5f6fb', muted: '#a3a9bf', accent: '#7aa2ff', accentText: '#0b1020', panel: '#ffffff0d', card: '#ffffff0a'},
  // Keynote style: off-white, near-black type, grey for the second half of a headline.
  light: {background: '#f4f5f6', text: '#111214', muted: '#9a9ca3', accent: '#0f9494', accentText: '#ffffff', panel: '#ffffff', card: '#fbfcfc'},
};
// Old field names, so older films get a precise fix.
const renamed = {speed: 'voice.speed (a scene\'s "speed" is playback speed)', pronounce: 'voice.pronounce', musicVolume: 'music.volume',
  heading: '"title"', text: '"title"', src: '"image"', items: '"stats"', project: '"recording"'};
const minimum = {title: 3, image: 4, slide: 4, stats: 3, chart: 4.5, lines: 6, end: 6};
const lead = 0.45; // silence before the narrator starts in each scene
const tail = 0.8; // and after the narrator ends
const gap = 0.3; // between sentences

const fail = (index, message) => { throw new Error(`Scene ${index + 1}: ${message}`); };
const exists = file => fs.access(file).then(() => true, () => false);
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);

export function sentences(text = '') {
  return (text.match(/[^.!?]+[.!?]+["”')\]]*|[^.!?]+$/g) || []).map(item => item.trim()).filter(Boolean);
}

// Split a sentence into caption lines of at most 8 words, preferring to break after
// commas so lines read as phrases; lines are timed by their length.
export function captionLines(sentence, start, duration) {
  const lines = [];
  for (const clause of sentence.split(/(?<=[,;:])\s+/)) {
    const words = clause.split(/\s+/);
    const previous = lines.at(-1);
    if (previous && (words.length < 3 || previous.split(' ').length < 3) && previous.split(' ').length + words.length <= 8) { lines[lines.length - 1] = `${previous} ${clause}`; continue; }
    const count = Math.ceil(words.length / 8);
    const size = Math.ceil(words.length / count);
    for (let index = 0; index < words.length; index += size) lines.push(words.slice(index, index + size).join(' '));
  }
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  let time = start;
  return lines.map(line => { const length = duration * line.length / total; const item = {start: time, end: time + length, text: line}; time += length; return item; });
}

// The schema catches shape errors (typos, wrong types, renamed fields); this catches the rest.
async function check(film, directory) {
  const errors = validate(await readJSON(schemaFile), film, renamed);
  if (errors.length) throw new Error(`film.json does not match the schema (${schemaFile}):\n- ${errors.join('\n- ')}`);
  for (const [index, scene] of film.scenes.entries()) {
    for (const panel of scene.panels || []) for (const series of panel.series) {
      if (series.values.length !== panel.x.length) fail(index, `a series has ${series.values.length} values but the panel has ${panel.x.length} x labels`);
    }
    if (scene.counter && !Number.isFinite(Number(String(scene.counter.to).replace(/,/g, '')))) fail(index, 'counter "to" must be a number');
    for (const file of [scene.image, scene.background, scene.component, ...Object.values(scene.images || {})].filter(Boolean)) {
      if (!await exists(path.resolve(directory, file))) fail(index, `file not found: ${file}`);
    }
  }
}

async function prepareRecording(file, url, fps, cache) {
  const {directory, project} = await loadProject(file);
  const key = hash(file);
  const source = path.resolve(directory, project.source);
  const last = project.clips.at(-1);
  const still = path.join(cache, `last-${key}-${hash(JSON.stringify(project.clips))}.png`);
  if (!await exists(still)) await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, last.end - 0.1)), '-i', source, '-frames:v', '1', still]);
  const events = await cursorEvents(project, directory);
  const clicks = events.filter(event => event.type === 'click');
  // Clicks on the recording's own (cut) timeline, for the click sounds.
  const ticks = [];
  let frames = 0;
  for (const clip of project.clips) {
    for (const click of clicks) if (click.visible !== false && click.t >= clip.start && click.t < clip.end) ticks.push(frames / fps + click.t - clip.start);
    frames += Math.max(1, Math.round((clip.end - clip.start) * fps));
  }
  return {recording: {project, sourceUrl: url(source), events, clicks, webcams: [], lastFrameUrl: url(still)}, seconds: frames / fps, ticks: project.audio?.clicks === false ? [] : ticks};
}

// Narration: every sentence becomes one cached audio file, so timings (and captions) are exact.
// "pronounce" ({"Memlake": "Mem-lake"}) changes only what the voice says; captions keep the real spelling.
async function narrate(lines, voice, speed, cache, pronounce = {}) {
  const spoken = line => Object.entries(pronounce).reduce((text, [word, sound]) => text.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), sound), line);
  const {findVoice, speakAs} = await import('./voice.mjs');
  const own = await findVoice(voice);
  let engine = own ? 'clone' : 'kokoro';
  const target = line => path.join(cache, `say-${hash(`${engine === 'clone' ? `clone|${own.text}|${process.env.FLIKKA_VOICE_LANG || 'english'}` : 'kokoro'}|${voice}|${speed}|${spoken(line)}`)}.wav`);
  const missing = [];
  for (const line of new Set(lines)) if (!await exists(target(line))) missing.push(line);
  if (missing.length) {
    const temporary = await fs.mkdtemp(path.join(cache, 'tts-'));
    try {
      const made = missing.map((line, index) => ({text: spoken(line), out: path.join(temporary, `line-${index}.wav`)}));
      await speakAs(own || voice, made, speed);
      for (const [index, line] of missing.entries()) {
        const sourceWav = made[index].out;
        if (await exists(sourceWav)) {
          const dest = target(line);
          try {
            await fs.rename(sourceWav, dest);
          } catch (err) {
            if (err.code === 'EXDEV') {
              await fs.copyFile(sourceWav, dest);
              await fs.rm(sourceWav, {force: true});
            } else throw err;
          }
        }
      }
    } finally { await fs.rm(temporary, {recursive: true, force: true}); }
  }
  const durations = new Map();
  for (const line of new Set(lines)) durations.set(line, Number((await probe(target(line))).format.duration));
  return {engine, file: target, durations};
}

// Generated music, so a film always has some without licensing questions (see lib/music.mjs).
async function generatedMusic() {
  return (await import('./music.mjs')).music(path.join(root, '.build'));
}

// Any song becomes the same quiet bed (-32 LUFS at volume 1, voice is -16), whatever its mastering.
export const musicLoudness = (volume = 1) => Math.max(-50, Math.min(-18, -32 + 20 * Math.log10(volume))).toFixed(1);

// Where a film's video goes: --out, its "output", or next to film.json (film.json → film.mp4). Side files (.srt, the
// report, the check) sit next to it; a film project's render also puts a copy in ~/Documents/flikka (publishFilm).
export async function filmOutput(file, output) {
  const film = await readJSON(file);
  return {output: path.resolve(path.dirname(file), output || film.output || path.basename(file).replace(/(\.film)?\.json$/, '.mp4'))};
}

// Everything a render, preview, frames or live view needs: validated film, prepared recordings and images,
// narration, the timeline, and the composition written (in `folder`, or a fresh one in the cache).
export async function prepareFilm(file, {output, folder} = {}) {
  file = path.resolve(file);
  const directory = path.dirname(file);
  const film = await readJSON(file);
  await check(film, directory);
  const fps = film.fps || 60;
  // Square unless the film says otherwise: big on a phone and on a computer (X, LinkedIn).
  const [width, height] = [film.width || 1080, film.height || 1080];
  const cache = path.join(directory, '.flikka-cache');
  await fs.mkdir(cache, {recursive: true});
  const space = await workspace(folder);
  const recordings = new Map();
  const recording = async name => {
    const key = await findProject(name, directory);
    if (!recordings.has(key)) recordings.set(key, await prepareRecording(key, space.url, fps, cache));
    return recordings.get(key);
  };
  const asset = name => space.url(path.resolve(directory, name));

  // Narration for every sentence of every scene, in one batch.
  const said = film.scenes.map(scene => sentences(scene.say));
  const voice = await narrate(said.flat(), film.voice?.name || 'af_heart', film.voice?.speed || 1, cache, film.voice?.pronounce);

  // Timeline: each scene lasts as long as its content or its narration, whichever is longer.
  const scenes = []; const narration = []; const captions = []; const ticks = []; const customs = new Map(); const holds = [];
  let from = 0;
  for (const [index, scene] of film.scenes.entries()) {
    const item = {...scene};
    let content = minimum[scene.type] || 0;
    if (scene.type === 'slide') content += (scene.bullets?.length || 0) * 0.8;
    if (scene.image) item.url = asset(scene.image);
    if (scene.background) {
      item.backgroundUrl = asset(scene.background); item.backgroundVideo = /\.(mp4|mov|m4v|webm)$/i.test(scene.background);
      // Background footage loops: the composition lays it end to end, so it needs the file's length.
      if (item.backgroundVideo) item.backgroundSeconds = Number((await probe(path.resolve(directory, scene.background))).format.duration);
    }
    const sounds = [];
    // "speed": 1.5 plays a recording 1.5x faster (zooms, cursor and click sounds follow).
    const rate = scene.speed || 1;
    let recorded = 0;  // seconds of moving recording this scene shows
    if (scene.type === 'recording') {
      const prepared = await recording(scene.recording).catch(error => fail(index, error.message));
      item.recording = prepared.recording; content = recorded = prepared.seconds / rate; sounds.push(...prepared.ticks.map(at => at / rate));
    }
    if (scene.type === 'custom') {
      // A component from the film's folder; its recordings and images arrive as props by name.
      customs.set(scene.component, path.resolve(directory, scene.component));
      item.imageUrls = Object.fromEntries(Object.entries(scene.images || {}).map(([name, file]) => [name, asset(file)]));
      item.recordingsReady = {};
      for (const [name, value] of Object.entries(scene.recordings || {})) {
        const prepared = await recording(value).catch(error => fail(index, error.message));
        item.recordingsReady[name] = prepared.recording; recorded = Math.max(recorded, prepared.seconds / rate); content = Math.max(content, recorded); sounds.push(...prepared.ticks.map(at => at / rate));
      }
    }
    if (scene.type === 'compare') {
      for (const side of ['before', 'after']) {
        const prepared = await recording(scene[side].recording).catch(error => fail(index, error.message));
        item[side] = {...scene[side], recording: prepared.recording}; recorded = Math.max(recorded, prepared.seconds / rate); content = Math.max(content, recorded);
        if (side === 'after') sounds.push(...prepared.ticks.map(at => at / rate));
      }
    }
    const lines = said[index];
    const spoken = lines.reduce((sum, line) => sum + voice.durations.get(line), 0) + gap * Math.max(0, lines.length - 1);
    const seconds = Math.max(scene.duration || 0, content, spoken ? lead + spoken + tail : 0);
    const frames = Math.round(seconds * fps);
    const start = from / fps;
    // A recording that ends early holds its last frame: under a zoom or a moving frame it reads as a screenshot.
    if (recorded && seconds - recorded > 1) holds.push({kind: 'frozen', time: +(start + recorded).toFixed(2), scene: index,
      message: `the recording ends at ${recorded.toFixed(1)} s and its last frame holds still for ${(seconds - recorded).toFixed(1)} s: record longer, play it slower (speed), or shorten the scene`});
    let time = start + lead;
    for (const line of lines) {
      const length = voice.durations.get(line);
      narration.push({file: voice.file(line), start: time, end: time + length, scene: index, text: line});
      captions.push(...captionLines(line, time, length));
      time += length + gap;
    }
    if (film.clicks) for (const at of sounds) if (at < seconds) ticks.push(start + at);
    scenes.push({...item, from, frames});
    from += frames;
  }
  const music = film.music === false ? null : typeof film.music === 'string' ? path.resolve(directory, film.music)
    : film.music?.file ? path.resolve(directory, film.music.file) : await generatedMusic();
  if (music && !await exists(music)) throw new Error(`music file not found: ${music}`);
  // A style (built-in, ~/.flikka/styles) sets the look; "theme" fine-tunes on top.
  const style = film.style ? await (await import('./style.mjs')).loadStyle(film.style, directory) : {};
  const theme = {...themes[film.theme?.base || 'dark'], ...style, ...film.theme};
  const inputProps = {film: {width, height, fps, frames: from, theme, scenes, captions: film.captions === false ? null : captions}};
  const customList = [...customs].map(([name, file]) => ({name, file}));
  // The composition: written now, and again by the live view once it adds the narration and music.
  const write = () => space.write({kind: 'film', props: inputProps, config: {width, height, fps, durationInFrames: from}, customs: customList, fontUrl: theme.fontUrl});
  await write();
  return {file, film, directory, cache, fps, width, height, space, write, scenes, narration, captions, ticks, voice, music, inputProps, holds,
    customs: customList, duration: from / fps, output: (await filmOutput(file, output)).output,
    close: () => folder ? null : space.remove()};
}

const summary = (prepared) => prepared.scenes.map(scene => ({type: scene.type, start: +(scene.from / prepared.fps).toFixed(2), seconds: +(scene.frames / prepared.fps).toFixed(2)}));

// Layout probe: one still per scene, once everything in it has appeared, measured in the browser.
async function probeLayout(prepared, folder) {
  const {fps, scenes, width, height} = prepared;
  const words = {'off-frame': 'runs off the frame', clipped: 'is cut off', overlap: 'overlaps other text', 'caption-zone': 'sits where the captions appear', contrast: 'is hard to read: too little contrast with what is behind it'};
  const frames = scenes.map(scene => scene.from + Math.max(0, scene.frames - Math.round(fps * 0.4)));
  const found = await stills(prepared.space, {width, height}, frames.map((frame, index) => ({time: frame / fps, output: path.join(folder, `scene-${String(index).padStart(3, '0')}.png`)})), {layout: true});
  return found.flatMap((issues, index) => issues.map(issue => ({kind: `layout-${issue.kind}`, time: +(frames[index] / fps).toFixed(2), scene: index, message: `"${issue.text}" ${words[issue.kind] || issue.kind}`})));
}

// Frames at chosen times, labelled with their timecode and scene, tiled into one image.
async function renderFrames(prepared, times, output) {
  const {fps, width, height} = prepared;
  const last = prepared.inputProps.film.frames - 1;
  const folder = await fs.mkdtemp(path.join(prepared.cache, 'frames-'));
  try {
    // The film itself stamps each frame with its timecode and scene number.
    await stills(prepared.space, {width, height}, times.map((time, index) => ({time: Math.min(last, Math.max(0, Math.round(time * fps))) / fps,
      output: path.join(folder, `frame-${String(index).padStart(3, '0')}.png`)})), {query: '?stamp'});
    const columns = Math.min(4, times.length);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', path.join(folder, 'frame-%03d.png'),
      '-vf', `scale=640:-2,pad=iw+6:ih+6:3:3:black,tile=${columns}x${Math.ceil(times.length / columns)}`, '-frames:v', '1', output]);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
  return output;
}

// Which times to show: a whole scene, a range, or a list, one frame every `every` seconds.
export function frameTimes(prepared, {scene, from, to, at, every}) {
  if (at) return at;
  let [start, end] = [from ?? 0, to ?? prepared.duration];
  if (scene !== undefined) {
    const item = prepared.scenes[scene - 1];
    if (!item) throw new Error(`There is no scene ${scene} (the film has ${prepared.scenes.length})`);
    [start, end] = [item.from / prepared.fps, (item.from + item.frames) / prepared.fps];
  }
  const step = every || Math.max(0.25, (end - start) / 12);
  const times = [];
  for (let time = start; time < end - 1e-6 && times.length < 48; time += step) times.push(+time.toFixed(3));
  return times;
}

export async function renderFilm(file, options = {}) {
  const started = performance.now();
  // Seconds spent in each stage, reported so slow steps are visible.
  const timings = {};
  let lap = started;
  const mark = stage => { const now = performance.now(); timings[stage] = +((now - lap) / 1000).toFixed(1); lap = now; };
  const prepared = await prepareFilm(file, {output: options.output});
  const {fps, scenes, narration, captions, ticks, duration, output, music, voice} = prepared;
  mark('prepare + narration');
  try {
    if (options.frames) {
      const target = options.frames.output || output.replace(/\.mp4$/, '.frames.png');
      await renderFrames(prepared, frameTimes(prepared, options.frames), target);
      mark('frames');
      return {frames: target, times: frameTimes(prepared, options.frames), duration, scenes: summary(prepared), timings};
    }

    const sheet = await fs.mkdtemp(path.join(prepared.cache, 'probe-'));
    try {
      const layout = [...prepared.holds, ...await probeLayout(prepared, sheet)];
      mark('layout check');
      if (options.preview) {
        const preview = output.replace(/\.mp4$/, '.preview.png');
        const columns = Math.min(3, scenes.length);
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', path.join(sheet, 'scene-%03d.png'),
          '-vf', `scale=640:-2,pad=iw+8:ih+8:4:4:black,tile=${columns}x${Math.ceil(scenes.length / columns)}`, '-frames:v', '1', preview]);
        return {preview, duration, scenes: summary(prepared), narration: voice.engine, issues: layout, timings};
      }

      await fs.mkdir(path.join(cacheDir, 'render'), {recursive: true});
      const scratch = await fs.mkdtemp(path.join(cacheDir, 'render', 'film-'));
      try {
        const video = path.join(scratch, 'video.mp4');
        const shown = progress();
        await renderVideo(prepared.space, video, {fps, progress: done => shown({progress: done})});
        mark('video render');
        const final = path.join(scratch, 'final.mp4');
        await mixAudio({prepared, video, scratch, final});
        mark('audio mix');

        // Checks before calling it done.
        const metadata = await probe(final);
        if (metadata.streams.filter(stream => stream.codec_type === 'video').length !== 1 || metadata.streams.filter(stream => stream.codec_type === 'audio').length !== 1) throw new Error('Film must have exactly one video and one audio track');
        if (Math.abs(Number(metadata.format.duration) - duration) > 0.15) throw new Error('Film duration check failed');
        const {stderr} = await execute('ffmpeg', ['-hide_banner', '-i', final, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], {maxBuffer: 16 * 1024 * 1024});
        const loudness = Number(stderr.match(/mean_volume: (-?[\d.]+)/)?.[1]);
        if (narration.length && !(loudness > -35)) throw new Error(`Narration is too quiet (mean ${loudness} dB)`);
        await fs.mkdir(path.dirname(output), {recursive: true});
        await fs.copyFile(final, output);
        const srt = output.replace(/\.mp4$/, '.srt');
        const time = seconds => new Date(seconds * 1000).toISOString().slice(11, 23).replace('.', ',');
        await fs.writeFile(srt, captions.map((caption, index) => `${index + 1}\n${time(caption.start)} --> ${time(caption.end)}\n${caption.text}\n`).join('\n'));
        const report = {output, captions: srt, duration, width: prepared.width, height: prepared.height, fps, narration: voice.engine, music: music ? path.basename(music) : null, meanVolume: loudness,
          scenes: summary(prepared), lines: narration.map(({file, ...line}) => line), captionLines: captions, layout};
        await writeJSON(`${output}.report.json`, report);
        // Check what a viewer would notice; every issue comes with a time and a frame to look at.
        if (options.check !== false) {
          const {issues, folder} = await checkFilm(report);
          Object.assign(report, {issues, checkFolder: folder});
          mark('inspection');
        }
        report.timings = timings;
        report.elapsedSeconds = +((performance.now() - started) / 1000).toFixed(1);
        await writeJSON(`${output}.report.json`, report);
        return report;
      } finally { await fs.rm(scratch, {recursive: true, force: true}); }
    } finally { await fs.rm(sheet, {recursive: true, force: true}); }
  } finally { await prepared.close(); }
}

// Audio in small steps with fixed-length inputs (one big graph with a looped input and a
// sidechain deadlocked): narration + clicks, music bed, duck and mix, then two-pass loudness.
async function mixAudio({prepared, video, scratch, final}) {
  const {narration, ticks, duration, music, film} = prepared;
  const pad = `apad,atrim=0:${duration}`;
  const spoken = path.join(scratch, 'spoken.wav');
  const voiceArgs = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo,atrim=0:${duration}`];
  const voiceFilters = [];
  const parts = ['[0:a]'];
  narration.forEach((item, index) => {
    voiceArgs.push('-i', item.file);
    voiceFilters.push(`[${index + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(item.start * 1000)}:all=1[n${index}]`);
    parts.push(`[n${index}]`);
  });
  if (ticks.length) {
    voiceFilters.push(`${tick},volume=0.6,asplit=${ticks.length}${ticks.map((_, index) => `[t${index}]`).join('')}`);
    ticks.forEach((time, index) => { voiceFilters.push(`[t${index}]adelay=${Math.round(time * 1000)}:all=1[c${index}]`); parts.push(`[c${index}]`); });
  }
  // Narration at -16 LUFS keeps it ~16 dB above the music bed (-32 LUFS), whatever the voice engine outputs.
  voiceFilters.push(`${parts.join('')}amix=inputs=${parts.length}:normalize=0:duration=first,loudnorm=I=-16:TP=-2:LRA=11,${pad}[out]`);
  await run('ffmpeg', [...voiceArgs, '-filter_complex', voiceFilters.join(';'), '-map', '[out]', spoken]);

  const mixed = path.join(scratch, 'mixed.wav');
  const inputs = ['-hide_banner', '-loglevel', 'error', '-y', '-i', spoken];
  let graph = '[0:a]anull[audio]';
  if (music) {
    const bed = path.join(scratch, 'music.wav');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', music, '-t', String(duration),
      '-af', `aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=${musicLoudness(film.music?.volume)}:TP=-8:LRA=7,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, duration - 2.5)}:d=2.5`, bed]);
    inputs.push('-i', bed);
    graph = '[0:a]asplit=2[spoken][key];[1:a][key]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=450[ducked];[spoken][ducked]amix=inputs=2:normalize=0:duration=first[audio]';
  }
  await run('ffmpeg', [...inputs, '-filter_complex', graph, '-map', '[audio]', mixed]);
  // Two-pass loudness: measure the mix, then apply one linear gain. (Dynamic loudnorm lifts
  // quiet stretches, which brought the music back up between sentences.)
  const target = 'I=-14:TP=-1.5:LRA=20';
  const {stderr: measured} = await execute('ffmpeg', ['-hide_banner', '-i', mixed, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], {maxBuffer: 16 * 1024 * 1024});
  const level = JSON.parse(measured.match(/\{[^{}]*"target_offset"[^{}]*\}/)[0]);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', mixed, '-map', '0:v:0', '-map', '1:a:0',
    // A silent film (no voice, no music) measures -inf: keep the silence as it is.
    ...(Number.isFinite(Number(level.input_i)) ? ['-af', `loudnorm=${target}:measured_I=${level.input_i}:measured_TP=${level.input_tp}:measured_LRA=${level.input_lra}:measured_thresh=${level.input_thresh}:offset=${level.target_offset}:linear=true`] : []),
    '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-t', String(duration), '-movflags', '+faststart', final]);
}

// flikka project live: play the film in the browser right away (no export), with narration
// and music, and reload when film.json or a recording changes. For humans to watch and comment.
export async function serveLive(file, {open = true} = {}) {
  file = path.resolve(file);
  const files = new Map();
  // Edits come from the page with this token (so other web pages can't write the film).
  const token = (await import('node:crypto')).randomBytes(18).toString('hex');
  const schema = await readJSON(schemaFile);
  const routes = {
    '/save': async ({film}, req) => {
      if (req.headers.authorization !== `Bearer ${token}`) throw new Error('not allowed');
      const errors = validate(schema, film, renamed);
      if (errors.length) return {errors};
      await fs.writeFile(file, JSON.stringify(film, null, 2) + '\n');
      return {saved: true};
    },
  };
  const {server, origin} = await assetServer(files, routes);
  const liveDirectory = path.join(cacheDir, 'live', hash(file));
  const pageDirectory = path.join(liveDirectory, 'page');
  await fs.mkdir(pageDirectory, {recursive: true});
  // The page script: the scene list and editor around a HyperFrames player. The film itself is its own
  // composition (with this film's custom scenes), played from /film/.
  const {build} = await import('esbuild');
  await build({entryPoints: [path.join(root, 'render/player.jsx')], bundle: true, minify: true, format: 'iife', jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"production"'}, nodePaths: [path.join(root, 'node_modules')], outfile: path.join(pageDirectory, 'player.js'), logLevel: 'silent'});
  await fs.writeFile(path.join(pageDirectory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>flikka live</title>
<style>html,body{margin:0;background:#0b0d12;color:#cfd3dc;font:14px system-ui,sans-serif}#app{margin:0}#status{margin:10px 0;color:#8a90a0}</style>
<script src="/player/hyperframes-player.js"></script></head>
<body><div id="app"></div><script>window.FLIKKA_LIVE = ${JSON.stringify({token: '__TOKEN__'})}</script><script src="/player/player.js"></script></body></html>`.replace('__TOKEN__', token));
  files.set('/', path.join(pageDirectory, 'index.html'));
  files.set('/player/player.js', path.join(pageDirectory, 'player.js'));
  files.set('/player/hyperframes-player.js', playerScript);
  files.set('/schema.json', schemaFile);
  files.set('/film.json', file);
  let version = 0; let props = null; let error = null; let src = null;
  const refresh = async () => {
    try {
      const prepared = await prepareFilm(file, {folder: path.join(liveDirectory, 'film')});
      // Narration and music as plain audio in the player (the export mixes them properly).
      prepared.inputProps.film.audio = {
        narration: prepared.narration.map(line => ({url: prepared.space.url(line.file), from: Math.round(line.start * prepared.fps)})),
        music: prepared.music ? prepared.space.url(prepared.music) : null,
        musicSeconds: prepared.music ? Number((await probe(prepared.music)).format.duration) : null,
      };
      await prepared.write();
      for (const key of [...files.keys()]) if (key.startsWith('/film/')) files.delete(key);
      for (const [key, value] of await prepared.space.files('/film')) files.set(key, value);
      props = prepared.inputProps; error = null; src = `/film/preview.html?v=${version + 1}`;
    } catch (failure) { error = failure.message; }
    version++;
    await fs.writeFile(path.join(pageDirectory, 'state.json'), JSON.stringify({version, props, error, src}));
    files.set('/state.json', path.join(pageDirectory, 'state.json'));
    console.error(error ? `film has errors:\n${error}` : `film ready (version ${version})`);
  };
  await refresh();
  let timer;
  watch(path.dirname(path.resolve(file)), {recursive: true}, (event, name) => {
    // Film, recordings' projects, custom scene code and assets; not flikka's own outputs.
    if (!name || name.split('/')[0].startsWith('.') || /\.check\//.test(name) || /\.(mp4|srt)$/.test(name) && !/project|cursor/.test(name) || /\.(preview|frames)\.png$/.test(name)) return;
    clearTimeout(timer); timer = setTimeout(refresh, 300);
  });
  console.log(JSON.stringify({url: origin, film: path.resolve(file)}));
  if (open) await (await import('./ui.mjs')).openURL(origin);
  return server;
}
