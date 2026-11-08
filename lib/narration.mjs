// Narration over a recording: lines of Kokoro speech pinned to moments of the recording (project.narration).
// A line's `at` and `until` are recording seconds, so cuts, speed changes and freezes made later move it along
// with what it talks about. render/timing.js turns them into seconds of the finished video.
// Placing, checking and editing lines is plain JavaScript here; making the audio loads lib/film.mjs (Kokoro and the
// caption line breaker) only when it's needed, because film.mjs imports project.mjs, which imports this file.
import fs from 'node:fs/promises';
import path from 'node:path';
import {cacheDir, run, probe, setting} from './common.mjs';
import {voiceLanguage} from './kokoro.mjs';
import {segments, toOutput, toSource, seconds, clock} from '../render/timing.js';

export const lineGap = 0.3; // between a line and one that follows it (at: null)
const narrationCache = path.join(cacheDir, 'narration');
const lineFields = ['id', 'text', 'at', 'until', 'voice', 'speed', 'trimStart', 'trimEnd', 'fadeIn', 'fadeOut', 'gain', 'muted'];
const settingFields = ['voice', 'speed', 'duck', 'pronounce', 'lines'];
const finite = (value, minimum, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

export const narrationLines = project => project.narration?.lines || [];
export const lineVoice = (project, line) => line.voice || project.narration?.voice || setting('voice');
export const lineSpeed = (project, line) => line.speed ?? project.narration?.speed ?? 1;

export function validateNarration(project) {
  const narration = project.narration;
  if (narration === undefined) return;
  const fail = message => { throw new Error(`Invalid narration: ${message}`); };
  if (!narration || typeof narration !== 'object' || !Array.isArray(narration.lines)) fail('it needs "lines", a list');
  for (const key of Object.keys(narration)) if (!settingFields.includes(key)) fail(`unknown field "${key}"; allowed: ${settingFields.join(', ')}`);
  const voice = (value, where) => { if (value !== undefined && !voiceLanguage(value)) fail(`${where} "${value}" is not a Kokoro voice (flikka voice list)`); };
  const speed = (value, where) => { if (value !== undefined && !finite(value, 0.7, 1.5)) fail(`${where} must be 0.7–1.5`); };
  voice(narration.voice, 'voice');
  speed(narration.speed, 'speed');
  if ('duck' in narration && typeof narration.duck !== 'boolean') fail('duck is true or false');
  if ('pronounce' in narration && (typeof narration.pronounce !== 'object' || !narration.pronounce || Object.values(narration.pronounce).some(sound => typeof sound !== 'string' || !sound.trim()))) fail('pronounce maps words to how they sound, e.g. {"Memlake": "Mem-lake"}');
  const ids = new Set();
  for (const line of narration.lines) {
    if (!line || typeof line !== 'object') fail('every line is an object');
    const name = `line ${line.id ?? '?'}`;
    for (const key of Object.keys(line)) if (!lineFields.includes(key)) fail(`${name}: unknown field "${key}"; allowed: ${lineFields.join(', ')}`);
    if (typeof line.id !== 'string' || !/^[\w-]{1,40}$/.test(line.id)) fail('every line needs an id (letters, digits, _ or -)');
    if (ids.has(line.id)) fail(`two lines have the id "${line.id}"`);
    ids.add(line.id);
    if (typeof line.text !== 'string' || !line.text.trim() || line.text.length > 1000) fail(`${name}: text must be 1–1000 characters`);
    if (line.at !== null && line.at !== undefined && !finite(line.at, 0, project.duration)) fail(`${name}: at must be a moment of the recording (0–${project.duration} s), or null to follow the line before`);
    if (line.until !== undefined && !finite(line.until, (line.at ?? 0) + 0.1, project.duration + 0.05)) fail(`${name}: until must be after at, within the recording`);
    voice(line.voice, `${name}: voice`);
    speed(line.speed, `${name}: speed`);
    for (const key of ['trimStart', 'trimEnd', 'fadeIn', 'fadeOut']) if (key in line && !finite(line[key], 0, 30)) fail(`${name}: ${key} must be 0–30 seconds`);
    if ('gain' in line && !finite(line.gain, -30, 12)) fail(`${name}: gain must be −30 to 12 dB`);
    if ('muted' in line && typeof line.muted !== 'boolean') fail(`${name}: muted is true or false`);
  }
}

// A recording moment in the finished video. A moment that was cut lands where the video picks up again after it
// (or at the end of the recording part, when nothing after it was kept).
function outputMoment(project, time, parts) {
  const at = toOutput(project, time);
  if (at !== null) return {at, snapped: false};
  const next = parts.find(part => part.start > time);
  return {at: next ? next.from : (parts.at(-1)?.to ?? 0), snapped: true};
}

// Where every line plays, in seconds of the finished video. lengths: line id → its audio's length (lines not made
// yet have none, so they and any line following them get no end). Lines keep their place in the list; a line with
// at: null starts lineGap after the one before ends (the first starts with the recording).
export function placeLines(project, lengths = new Map()) {
  const parts = segments(project);
  const begin = parts[0]?.from ?? 0;
  const end = parts.at(-1)?.to ?? 0;
  let previous = null;
  return narrationLines(project).map(line => {
    const raw = lengths.get(line.id);
    const length = raw === undefined ? null : Math.max(0, raw - (line.trimStart || 0) - (line.trimEnd || 0));
    let from = null, snapped = false;
    if (line.at === null || line.at === undefined) from = !previous ? begin : previous.to === null ? null : previous.to + lineGap;
    else ({at: from, snapped} = outputMoment(project, line.at, parts));
    const to = from === null || length === null ? null : from + length;
    const placed = {id: line.id, text: line.text, from, to, length, voice: lineVoice(project, line), speed: lineSpeed(project, line), ...(line.muted && {muted: true}), ...(snapped && {snapped: true})};
    if (line.until !== undefined && from !== null) {
      placed.room = Math.max(0, outputMoment(project, line.until, parts).at - from);
      if (length !== null && length > placed.room + 0.05) placed.overrun = length - placed.room;
    }
    if (previous?.to != null && from !== null && from < previous.to - 0.01) placed.overlaps = previous.id;
    if (to !== null && to > end + 0.01) placed.runsPast = to - end;
    previous = placed;
    return placed;
  });
}

// Placed lines, rounded, for the timeline and the render report.
export const describeLines = placed => placed.map(({length, ...line}) => Object.fromEntries(Object.entries({...line, made: length !== null})
  .map(([key, value]) => [key, typeof value === 'number' ? +value.toFixed(2) : value])));

// The lines grouped by the voice and speed they're spoken with, as narrate() takes them.
function byVoice(project) {
  const groups = new Map();
  for (const line of narrationLines(project)) {
    const key = `${lineVoice(project, line)}|${lineSpeed(project, line)}`;
    if (!groups.has(key)) groups.set(key, {voice: lineVoice(project, line), speed: lineSpeed(project, line), lines: []});
    groups.get(key).lines.push(line);
  }
  return [...groups.values()];
}

// Every line's audio: id → {file, length}. make: speak the lines that aren't cached yet; otherwise only the ones
// already made (for the timeline and single preview frames, which shouldn't wait on Kokoro).
export async function narrationClips(project, {make = false} = {}) {
  const {narrate, narrationClip} = await import('./film.mjs');
  await fs.mkdir(narrationCache, {recursive: true});
  const pronounce = project.narration?.pronounce || {};
  const clips = new Map();
  for (const {voice, speed, lines} of byVoice(project)) {
    if (make) await narrate(lines.map(line => line.text), voice, speed, narrationCache, pronounce);
    for (const line of lines) {
      const file = narrationClip(line.text, voice, speed, narrationCache, pronounce);
      const length = await probe(file).then(info => Number(info.format.duration), () => null);
      if (length !== null) clips.set(line.id, {file, length});
    }
  }
  return clips;
}

export const clipLengths = clips => new Map([...clips].map(([id, clip]) => [id, clip.length]));

// Captions for the placed lines, in seconds of the finished video. A line's sentences share its time by their
// length, then each is broken into caption lines the way films break them.
export async function narrationCaptions(placed) {
  const {sentences, captionLines} = await import('./film.mjs');
  return placed.filter(line => !line.muted && line.from !== null && line.to !== null).flatMap(line => {
    const parts = sentences(line.text);
    const total = parts.reduce((sum, part) => sum + part.length, 0) || 1;
    let time = line.from;
    return parts.flatMap(part => {
      const duration = (line.to - line.from) * part.length / total;
      const lines = captionLines(part, time, duration, voiceLanguage(line.voice) || 'a');
      time += duration;
      return lines;
    });
  });
}

// One WAV as long as the video with every line placed, trimmed, faded and at its gain, at narration loudness
// (-16 LUFS, the same as films). Muted lines keep their place but stay silent.
export async function narrationTrack(project, clips, placed, duration, output) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo,atrim=0:${duration}`];
  const filters = [];
  const labels = ['[0:a]'];
  const lines = new Map(narrationLines(project).map(line => [line.id, line]));
  for (const item of placed) {
    const clip = clips.get(item.id);
    if (item.muted || !clip || item.from === null || item.from >= duration || !(item.length > 0)) continue;
    const line = lines.get(item.id);
    const input = labels.length;
    args.push('-i', clip.file);
    const chain = [`atrim=start=${line.trimStart || 0}:end=${Math.max(line.trimStart || 0, clip.length - (line.trimEnd || 0))}`, 'asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=channel_layouts=stereo'];
    if (line.fadeIn) chain.push(`afade=t=in:d=${Math.min(line.fadeIn, item.length)}`);
    if (line.fadeOut) chain.push(`afade=t=out:st=${Math.max(0, item.length - line.fadeOut)}:d=${Math.min(line.fadeOut, item.length)}`);
    if (line.gain) chain.push(`volume=${line.gain}dB`);
    chain.push(`adelay=${Math.round(item.from * 1000)}:all=1`);
    filters.push(`[${input}:a]${chain.join(',')}[line${input}]`);
    labels.push(`[line${input}]`);
  }
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first,loudnorm=I=-16:TP=-2:LRA=11,apad,atrim=0:${duration}[out]`);
  await run('ffmpeg', [...args, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', output]);
  return labels.length - 1;
}

// project edit options for narration. Returns the index of the option's last argument, or -1 when the option
// isn't one of these. Times are recording seconds, or seconds of the video before this call with --output-time.
export const narrationOptions = ['--say', '--reword', '--line', '--unsay', '--narrator', '--duck', '--pronounce'];
export function editNarration(project, args, index, {outputTime, before}) {
  const option = args[index];
  if (!narrationOptions.includes(option)) return -1;
  const value = String(args[++index] ?? '');
  const moment = (text, usage, end = false) => {
    let time = seconds(text);
    if (!Number.isFinite(time)) throw new Error(usage);
    if (outputTime) {
      const source = toSource(before, time, {end});
      if (source === null) throw new Error(`${clock(time)} is not in the recording part of the video`);
      time = source;
    }
    if (!finite(time, 0, project.duration + 0.05)) throw new Error(`${clock(time)} is not within the recording`);
    return +Math.min(time, project.duration).toFixed(3);
  };
  const narration = project.narration = {...project.narration, lines: [...narrationLines(project)]};
  const find = id => {
    const line = narration.lines.find(item => item.id === id);
    if (!line) throw new Error(`There is no narration line "${id}" (flikka project timeline lists them)`);
    return line;
  };
  if (option === '--say') {
    // --say at,"text": a new line at that moment; --say next,"text": right after the line before it.
    const [atText, ...words] = value.split(',');
    const text = words.join(',').trim();
    if (!atText || !text) throw new Error('--say takes at,"text" (a moment in seconds or m:ss, or next to follow the line before)');
    const at = atText.trim() === 'next' ? null : moment(atText, '--say takes at,"text" (a moment in seconds or m:ss, or next)');
    const used = narration.lines.map(line => Number(/^n(\d+)$/.exec(line.id)?.[1] || 0));
    const line = {id: `n${Math.max(0, ...used) + 1}`, text, at};
    // Anchored lines go in time order; a following line goes on the end.
    const after = at === null ? narration.lines.length : narration.lines.findIndex(item => item.at != null && item.at > at);
    narration.lines.splice(after < 0 ? narration.lines.length : after, 0, line);
  } else if (option === '--reword') {
    const [id, ...words] = value.split(',');
    const text = words.join(',').trim();
    if (!text) throw new Error('--reword takes id,"new text"');
    find(id.trim()).text = text;
  } else if (option === '--line') {
    // --line id,key=value,...: at, until (moments, or none), voice, speed, trim-start, trim-end, fade-in, fade-out
    // (seconds), gain (dB), mute (on or off). A key with no value (voice=, speed=) goes back to the default.
    const [id, ...settings] = value.split(',');
    const line = find(id.trim());
    const keys = {'trim-start': 'trimStart', 'trim-end': 'trimEnd', 'fade-in': 'fadeIn', 'fade-out': 'fadeOut', gain: 'gain'};
    if (!settings.length) throw new Error('--line takes id,key=value (at, until, voice, speed, trim-start, trim-end, fade-in, fade-out, gain, mute)');
    for (const pair of settings) {
      const [key, item = ''] = pair.split('=').map(part => part.trim());
      if (key === 'at') line.at = item === 'next' || item === '' ? null : moment(item, '--line at= takes a moment (seconds or m:ss) or next');
      else if (key === 'until') { if (item === '' || item === 'none') delete line.until; else line.until = moment(item, '--line until= takes a moment (seconds or m:ss) or none', true); }
      else if (key === 'voice') { if (item) line.voice = item; else delete line.voice; }
      else if (key === 'speed') { if (item) line.speed = Number(item); else delete line.speed; }
      else if (key === 'mute') { if (!['on', 'off'].includes(item)) throw new Error('--line mute= takes on or off'); if (item === 'on') line.muted = true; else delete line.muted; }
      else if (keys[key]) { if (item === '' || Number(item) === 0) delete line[keys[key]]; else line[keys[key]] = Number(item); }
      else throw new Error(`--line has no "${key}"; it takes at, until, voice, speed, trim-start, trim-end, fade-in, fade-out, gain, mute`);
    }
  } else if (option === '--unsay') {
    if (value === 'all') narration.lines = [];
    else { find(value); narration.lines = narration.lines.filter(line => line.id !== value); }
  } else if (option === '--narrator') {
    // --narrator voice[,speed]: who reads every line that doesn't pick its own. default: the voice in Settings.
    const [voice, speed] = value.split(',').map(part => part.trim());
    if (!voice) throw new Error('--narrator takes a Kokoro voice (flikka voice list), optionally with a speed: af_heart,1.1');
    if (voice === 'default') delete narration.voice; else narration.voice = voice;
    if (speed !== undefined) narration.speed = Number(speed);
  } else if (option === '--duck') {
    // Turn the recording's own sound down while a line plays (on by default).
    if (!['on', 'off'].includes(value)) throw new Error('--duck takes on or off');
    narration.duck = value === 'on';
  } else if (option === '--pronounce') {
    // --pronounce "Memlake=Mem-lake": how the voice says a word (captions keep the spelling). word= forgets one, off all.
    if (value === 'off') delete narration.pronounce;
    else {
      const [word, sound = ''] = value.split('=').map(part => part.trim());
      if (!word) throw new Error('--pronounce takes "word=how it sounds", "word=" to forget one, or off');
      const pronounce = {...narration.pronounce};
      if (sound) pronounce[word] = sound; else delete pronounce[word];
      if (Object.keys(pronounce).length) narration.pronounce = pronounce; else delete narration.pronounce;
    }
  }
  // Nothing left to say and nothing set: no narration at all.
  if (!narration.lines.length && Object.keys(narration).length === 1) delete project.narration;
  return index;
}
