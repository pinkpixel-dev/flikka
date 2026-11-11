// Overlay layers on recordings and films: text, images, videos and solid boxes on the finished video, each with
// a box (x, y, w, h as shares of the video), opacity, rotation and keyframes (render/keyframes.js draws them).
// A recording's layers start and end at recording moments, like narration lines, so cuts carry them along;
// a film's sit in a scene, in seconds from its start.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {probe} from './common.mjs';
import {animated, parseEasing} from '../render/keyframes.js';
import {segments, toOutput, seconds as parseSeconds} from '../render/timing.js';

export const layerTypes = ['text', 'image', 'video', 'solid'];
const images = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
const videos = ['.mp4', '.mov', '.m4v', '.webm'];
const finite = (value, minimum, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const string = (value, most) => typeof value === 'string' && value.length > 0 && value.length <= most;
// Each value's range. A box can sit partly outside the video, so it can slide in from the edge.
const ranges = {x: [-1, 2], y: [-1, 2], w: [0.01, 2], h: [0.01, 2], opacity: [0, 1], rotation: [-3600, 3600]};
const usage = 'Layers are {type text|image|video|solid, x, y, w, h (shares of the video), opacity 0–1, rotation (degrees), keyframes}';

// Problems with one layer, as sentences (none: it's fine). where: 'recording' (start and end in the recording,
// both needed) or 'scene' (start and end in seconds from the scene's start, both optional).
export function layerProblems(layer, {where = 'recording', duration} = {}) {
  if (!layer || typeof layer !== 'object') return [usage];
  const problems = [];
  if (!layerTypes.includes(layer.type)) problems.push(`type must be ${layerTypes.join(', ')}`);
  if ('id' in layer && !string(layer.id, 40)) problems.push('id is a short name');
  for (const [key, [lower, upper]] of Object.entries(ranges)) {
    const needed = ['x', 'y', 'w', 'h'].includes(key);
    if ((needed || key in layer) && !finite(layer[key], lower, upper)) problems.push(`${key} must be ${lower} to ${upper}`);
  }
  if (where === 'recording') {
    if (!finite(layer.start, 0, duration) || !finite(layer.end, layer.start + 0.1, duration + 0.05)) problems.push('start and end must be recording seconds, end after start');
  } else {
    if ('start' in layer && !finite(layer.start, 0, 3600)) problems.push('start is seconds from the scene\'s start');
    if ('end' in layer && !finite(layer.end, (layer.start || 0) + 0.1, 3600)) problems.push('end is seconds from the scene\'s start, after start');
  }
  if (layer.type === 'text' && !string(layer.text, 500)) problems.push('a text layer needs text (up to 500 characters)');
  if (['image', 'video'].includes(layer.type)) {
    const kinds = layer.type === 'image' ? images : videos;
    if (!string(layer.file, 1000) || !kinds.includes(path.extname(layer.file).toLowerCase())) problems.push(`an ${layer.type} layer needs a file (${kinds.join(' ')})`);
  }
  if ('fit' in layer && !['contain', 'cover'].includes(layer.fit)) problems.push('fit is contain or cover');
  if ('size' in layer && !finite(layer.size, 0.01, 0.5)) problems.push('size is the font size as a share of the video\'s height, 0.01–0.5');
  if ('weight' in layer && !(Number.isInteger(layer.weight) && layer.weight >= 100 && layer.weight <= 900)) problems.push('weight is 100–900');
  if ('align' in layer && !['left', 'center', 'right'].includes(layer.align)) problems.push('align is left, center or right');
  if ('radius' in layer && !finite(layer.radius, 0, 1000)) problems.push('radius is 0–1000 px');
  for (const key of ['color', 'background', 'font']) if (key in layer && !string(layer[key], 200)) problems.push(`${key} is CSS text`);
  if ('keyframes' in layer) {
    if (!Array.isArray(layer.keyframes)) problems.push('keyframes is a list');
    else for (const keyframe of layer.keyframes) {
      if (!finite(keyframe?.at, 0, 3600)) { problems.push('each keyframe has at: seconds after the layer appears'); continue; }
      const keys = Object.keys(keyframe).filter(key => key !== 'at' && key !== 'ease');
      if (!keys.length) problems.push(`the keyframe at ${keyframe.at} s sets nothing (${Object.keys(animated).join(', ')})`);
      for (const key of keys) if (!ranges[key] || !finite(keyframe[key], ...ranges[key])) problems.push(`the keyframe at ${keyframe.at} s: ${ranges[key] ? `${key} must be ${ranges[key].join(' to ')}` : `${key} can't be animated (${Object.keys(animated).join(', ')})`}`);
      if ('ease' in keyframe && parseEasing(keyframe.ease) === undefined) problems.push(`the keyframe at ${keyframe.at} s: ease is linear, ease, ease-in, ease-out, ease-in-out or cubic-bezier(x1,y1,x2,y2) with x1 and x2 in 0–1`);
    }
    if (Array.isArray(layer.keyframes) && new Set(layer.keyframes.map(keyframe => keyframe?.at)).size < layer.keyframes.length) problems.push('two keyframes share one moment');
  }
  return problems;
}

export function validateLayers(project) {
  const ids = new Set();
  for (const layer of project.layers || []) {
    const problems = layerProblems(layer, {duration: project.duration});
    if (!layer?.id) problems.push('a recording\'s layer needs an id');
    else if (ids.has(layer.id)) problems.push(`two layers are called ${layer.id}`);
    ids.add(layer?.id);
    if (problems.length) throw new Error(`Invalid layer${layer?.id ? ` ${layer.id}` : ''}: ${problems.join('; ')}`);
  }
}

// A recording's layers where they show in the finished video, in seconds. A start that was cut moves to where
// the video picks up again, an end that was cut to where it stopped; a layer that was cut whole is left out.
export function placeLayers(project) {
  const parts = segments(project);
  return (project.layers || []).flatMap(layer => {
    let from = toOutput(project, layer.start);
    if (from === null) from = parts.find(part => part.start > layer.start)?.from ?? null;
    let to = toOutput(project, layer.end);
    if (to === null) to = parts.filter(part => part.start < layer.end).at(-1)?.to ?? null;
    if (from === null || to === null || to - from < 0.04) return [];
    return [{...layer, from, to}];
  });
}

// What a composition draws: from and frames in frames, url for the file, seconds for a video (it loops).
// directory: where the layers' files are named from.
export async function layerProps(layers, directory, url, fps) {
  return Promise.all(layers.map(async layer => {
    const item = {...layer, from: Math.round(layer.from * fps), frames: Math.max(1, Math.round((layer.to - layer.from) * fps))};
    if (layer.file) {
      const file = path.resolve(directory, layer.file);
      if (!await fs.access(file).then(() => true, () => false)) throw new Error(`Layer ${layer.id || layer.type} file not found: ${file}`);
      item.url = url(file);
      if (layer.type === 'video') item.seconds = Number((await probe(file)).format.duration);
    }
    return item;
  }));
}

// A film scene's layers in its own frames: start defaults to 0 and end to the scene's end, cut to fit the scene.
export function sceneLayers(scene, sceneSeconds) {
  return (scene.layers || []).flatMap(layer => {
    const from = Math.min(layer.start || 0, sceneSeconds);
    const to = Math.min(layer.end ?? sceneSeconds, sceneSeconds);
    return to - from < 0.04 ? [] : [{...layer, from, to}];
  });
}

// The panel's layer edits as edit options, all in one call (one undo step). Times are seconds of the finished
// video (the call adds --output-time). changes: [{add: {type, from, to, x, y, w, h, text | color | file}},
// {set: {layer, start, end, x, y, …, text, order}}, {remove: id}, {keyframe: {layer, at, x, …, ease}},
// {unkeyframe: {layer, at}}]. file: a path the panel's server chose. A keyframe's at is seconds after the layer
// appears; ease '' takes its easing off. Moving a keyframe is an unkeyframe then a keyframe, in that order.
export function layerArgs(changes) {
  const args = [];
  const id = value => { if (!/^[\w-]{1,40}$/.test(String(value))) throw new Error('Pick a layer'); return String(value); };
  const time = value => { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error('Times are seconds in the video'); return number.toFixed(3); };
  // A keyframe's moment as it's stored (seconds, at most 3 decimals), so --unkeyframe finds it.
  const moment = value => { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error('A keyframe is at seconds after the layer appears'); return String(+number.toFixed(3)); };
  const number = (key, value) => { const given = Number(value); if (!Number.isFinite(given)) throw new Error(`${key} takes a number`); return +given.toFixed(4); };
  // Commas would split the option apart, except inside brackets (rgba(…)).
  const css = value => String(value ?? '').replace(/,(?![^(]*\))/g, ' ').trim();
  for (const change of Array.isArray(changes) ? changes : []) {
    if (change.add) {
      const {type, from, to, x, y, w, h} = change.add;
      if (!layerTypes.includes(type)) throw new Error(`A layer is ${layerTypes.join(', ')}`);
      const what = type === 'text' ? String(change.add.text || 'Text').replace(/\s+/g, ' ') : type === 'solid' ? css(change.add.color) : String(change.add.file || '');
      args.push('--layer', [type, time(from), time(to), ...[x, y, w, h].map(value => number('x, y, w and h', value)), what].join(',').replace(/,$/, ''));
    } else if (change.set) {
      const {layer, text, ...rest} = change.set;
      const pairs = [];
      for (const [key, value] of Object.entries(rest)) {
        if (key === 'start' || key === 'end') pairs.push(`${key}=${time(value)}`);
        else if (key === 'order') { if (!['front', 'back'].includes(value)) throw new Error('order is front or back'); pairs.push(`order=${value}`); }
        else if (numbers.has(key)) pairs.push(`${key}=${number(key, value)}`);
        else if (texts.has(key) && key !== 'font') pairs.push(`${key}=${css(value)}`);
        else throw new Error(`A layer can't set ${key} here`);
      }
      if (text !== undefined) { const said = String(text).trim(); if (!said) throw new Error('A text layer needs some words'); pairs.push(`text=${said}`); }
      if (pairs.length) args.push('--layer-set', `${id(layer)},${pairs.join(',')}`);
    } else if (change.remove) args.push('--unlayer', id(change.remove));
    else if (change.keyframe) {
      const {layer, at, ease, ...values} = change.keyframe;
      const pairs = Object.entries(values).map(([key, value]) => {
        if (!(key in animated)) throw new Error(`A keyframe sets ${Object.keys(animated).join(', ')} and ease, not ${key}`);
        return `${key}=${number(key, value)}`;
      });
      if (ease !== undefined) pairs.push(`ease=${String(ease).replace(/\s+/g, '')}`);
      if (!pairs.length) throw new Error('A keyframe needs a value to set');
      args.push('--keyframe', `${id(layer)},${moment(at)},${pairs.join(',')}`);
    } else if (change.unkeyframe) args.push('--unkeyframe', `${id(change.unkeyframe.layer)},${moment(change.unkeyframe.at)}`);
  }
  if (!args.length) throw new Error('Nothing to change');
  return args;
}

// "a,b(c,d),e" → ["a", "b(c,d)", "e"]: commas inside brackets (cubic-bezier) stay put.
function split(text) {
  const parts = []; let depth = 0; let current = '';
  for (const character of String(text)) {
    if (character === ',' && !depth) { parts.push(current); current = ''; continue; }
    if (character === '(') depth++;
    if (character === ')') depth = Math.max(0, depth - 1);
    current += character;
  }
  return [...parts, current];
}

// An image or video copied into the project's layers/ folder (named by its contents), so the project keeps
// working when the original moves. Returns the name the project stores.
async function keep(file, directory, type) {
  const source = path.resolve(file);
  const kinds = type === 'image' ? images : videos;
  if (!kinds.includes(path.extname(source).toLowerCase())) throw new Error(`An ${type} layer takes ${kinds.join(' ')} files`);
  const data = await fs.readFile(source).catch(() => { throw new Error(`Layer file not found: ${source}`); });
  const name = `layers/${createHash('sha256').update(data).digest('hex').slice(0, 16)}${path.extname(source).toLowerCase()}`;
  await fs.mkdir(path.join(directory, 'layers'), {recursive: true});
  await fs.writeFile(path.join(directory, name), data);
  return name;
}

const numbers = new Set([...Object.keys(ranges), 'size', 'weight', 'radius']);

// A new place, size or turn for an animated layer takes its keyframes along, so the animation keeps its shape:
// x, y and rotation keyframes move by the same amount, w and h ones grow or shrink by the same share.
function carryKeyframes(layer, key, value) {
  if (!['x', 'y', 'w', 'h', 'rotation'].includes(key) || !layer.keyframes?.some(keyframe => key in keyframe)) return;
  const before = layer[key] ?? animated[key];
  const [lower, upper] = ranges[key];
  const scaled = key === 'w' || key === 'h';
  for (const keyframe of layer.keyframes) {
    if (!(key in keyframe)) continue;
    const moved = scaled ? keyframe[key] * value / before : keyframe[key] + value - before;
    keyframe[key] = Math.round(Math.max(lower, Math.min(upper, moved)) * 1e4) / 1e4;
  }
}
const texts = new Set(['color', 'background', 'font', 'fit', 'align']);

// The layer edit options of `flikka project edit`. Returns the index of the option's last argument, or -1 when
// args[index] isn't one of them. range(text, usage): "start,end" in the call's times → recording seconds, and
// moment(text, {end}) one moment the same way.
export async function editLayers(project, args, index, {range, moment, directory}) {
  const option = args[index];
  const find = id => {
    const layer = (project.layers || []).find(item => item.id === id);
    if (!layer) throw new Error(`There is no layer ${id || '(none given)'}${project.layers?.length ? ` (layers: ${project.layers.map(item => item.id).join(', ')})` : ''}`);
    return layer;
  };
  if (option === '--layer') {
    // --layer type,start,end,x,y,w,h[,what]  or  type,all,x,y,w,h[,what] for the whole recording.
    // what: the text (commas are fine), the image or video file, or a solid's color.
    const text = String(args[index + 1] || '');
    const [type, ...rest] = text.split(',');
    const shape = 'Use --layer text|image|video|solid,start,end,x,y,w,h[,text, file or color] (all instead of start,end: the whole recording)';
    if (!layerTypes.includes(type)) throw new Error(shape);
    const whole = rest[0] === 'all';
    const [start, end] = whole ? [0, project.duration] : range(rest.slice(0, 2).join(','), shape);
    const box = rest.slice(whole ? 1 : 2, whole ? 5 : 6).map(Number);
    const what = rest.slice(whole ? 5 : 6).join(',').trim();
    if (box.length < 4 || box.some(value => !Number.isFinite(value))) throw new Error(shape);
    const used = new Set((project.layers || []).map(item => item.id));
    let number = 1; while (used.has(`l${number}`)) number++;
    const layer = {id: `l${number}`, type, start, end: Math.min(end, project.duration), x: box[0], y: box[1], w: box[2], h: box[3]};
    if (type === 'text') layer.text = what;
    else if (type === 'solid') { if (what) layer.color = what; }
    else if (!what) throw new Error(`An ${type} layer needs a file: --layer ${type},start,end,x,y,w,h,<file>`);
    else layer.file = await keep(what, directory, type);
    project.layers = [...(project.layers || []), layer];
    return index + 1;
  }
  if (option === '--layer-set') {
    // --layer-set id,key=value[,key=value…]: x y w h opacity rotation start end color background font size weight
    // align fit radius file, order=front|back, and text=… last (it takes the rest, commas and all).
    const text = String(args[index + 1] || '');
    const at = text.indexOf(',');
    const layer = find(at < 0 ? text : text.slice(0, at));
    let rest = at < 0 ? '' : text.slice(at + 1);
    const said = rest.search(/(^|,)text=/);
    if (said >= 0) { layer.text = rest.slice(rest.indexOf('text=', said) + 5); rest = rest.slice(0, said); }
    const pairs = rest ? split(rest) : [];
    if (!pairs.length && said < 0) throw new Error('--layer-set takes id,key=value[,key=value…]');
    for (const pair of pairs) {
      const [key, ...value] = pair.split('='); const given = value.join('=').trim();
      if (key === 'order') {
        if (!['front', 'back'].includes(given)) throw new Error('order is front or back');
        project.layers = given === 'front' ? [...project.layers.filter(item => item !== layer), layer] : [layer, ...project.layers.filter(item => item !== layer)];
      } else if (key === 'file') {
        if (!['image', 'video'].includes(layer.type)) throw new Error(`Layer ${layer.id} is a ${layer.type} layer: only image and video layers have a file`);
        layer.file = await keep(given, directory, layer.type);
      } else if (key === 'start' || key === 'end') {
        const time = moment(given, {end: key === 'end'});
        if (time === null) throw new Error(`${key} must be a moment (seconds or m:ss) in the recording part of the video`);
        layer[key] = key === 'end' ? Math.min(time, project.duration) : time;
      } else if (numbers.has(key)) {
        if (given === '' || !Number.isFinite(Number(given))) throw new Error(`${key} takes a number`);
        carryKeyframes(layer, key, Number(given));
        layer[key] = Number(given);
      } else if (texts.has(key)) { if (given) layer[key] = given; else delete layer[key]; }
      else throw new Error(`--layer-set can't set ${key || '(nothing)'}: use x y w h opacity rotation start end color background font size weight align fit radius file order text`);
    }
    return index + 1;
  }
  if (option === '--keyframe') {
    // --keyframe id,at,key=value[,key=value…][,ease=…]: at is seconds after the layer appears (in the finished
    // video). A keyframe already at that moment gets the new values on top of its own.
    const [id, atText, ...pairs] = split(args[index + 1] || '');
    const layer = find(id);
    const time = parseSeconds(atText);
    if (!Number.isFinite(time) || time < 0 || !pairs.length) throw new Error('--keyframe takes id,at,key=value[,…][,ease=…]: at is seconds after the layer appears');
    const keyframe = {...(layer.keyframes || []).find(item => item.at === time), at: time};
    for (const pair of pairs) {
      const [key, ...value] = pair.split('='); const given = value.join('=').trim();
      // ease= with nothing takes the keyframe's own easing off (it eases the default way, ease).
      if (key === 'ease') { if (given) keyframe.ease = given; else delete keyframe.ease; }
      else if (key in animated) {
        if (given === '' || !Number.isFinite(Number(given))) throw new Error(`${key} takes a number`);
        keyframe[key] = Number(given);
      } else throw new Error(`A keyframe sets ${Object.keys(animated).join(', ')} and ease, not ${key || '(nothing)'}`);
    }
    layer.keyframes = [...(layer.keyframes || []).filter(item => item.at !== time), keyframe].sort((a, b) => a.at - b.at);
    return index + 1;
  }
  if (option === '--unkeyframe') {
    // --unkeyframe id,at  or  id,all
    const [id, atText] = String(args[index + 1] || '').split(',');
    const layer = find(id);
    if (atText === 'all') delete layer.keyframes;
    else {
      const time = parseSeconds(atText);
      const left = (layer.keyframes || []).filter(item => item.at !== time);
      if (left.length === (layer.keyframes || []).length) throw new Error(`Layer ${id} has no keyframe at ${atText}${layer.keyframes?.length ? ` (keyframes at ${layer.keyframes.map(item => item.at).join(', ')})` : ''}`);
      if (left.length) layer.keyframes = left; else delete layer.keyframes;
    }
    return index + 1;
  }
  if (option === '--unlayer') {
    const layer = find(args[index + 1]);
    project.layers = project.layers.filter(item => item !== layer);
    if (!project.layers.length) delete project.layers;
    return index + 1;
  }
  if (option === '--layers') {
    if (args[index + 1] !== 'off') throw new Error('--layers takes off (removes every layer)');
    delete project.layers;
    return index + 1;
  }
  return -1;
}
