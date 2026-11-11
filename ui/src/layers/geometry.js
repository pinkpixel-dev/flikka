// Overlay layers in the panel: where a layer's box is at a moment, a box mid-drag on the player, and the change
// that saves it. Boxes are shares of the video (x, y, w, h) with rotation in degrees, like the project keeps them.
// A layer's own values are where its animation starts, so a drag moves those and lib/layers.mjs takes the
// keyframes along (x, y and rotation by the same amount, w and h by the same share).
import {layerAt} from '../../../render/keyframes.js';

export const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const sides = {n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1]};
const smallest = 12;
const round = value => Math.round(value * 1e4) / 1e4;

// The box at a moment of the video (held at its first or last look outside its time).
export const boxAt = (layer, time) => layerAt(layer, Math.max(0, Math.min(time, layer.to) - layer.from));

// The box mid-drag, in pixels of the stage (width × height). mode: move, rotate or a handle (n, se, …).
// start: the box when the drag began (shares), from and now: pointer positions in stage pixels.
export function dragBox(start, {mode, from, now, shift}, {width, height}) {
  const box = {x: start.x * width, y: start.y * height, w: start.w * width, h: start.h * height};
  const center = {x: box.x + box.w / 2, y: box.y + box.h / 2};
  const [dx, dy] = [now.x - from.x, now.y - from.y];
  if (mode === 'move') {
    let [x, y] = [box.x + dx, box.y + dy];
    // The box's edges and middle snap to the video's edges and middle.
    const snap = (position, size, total) => {
      for (const [offset, target] of [[0, 0], [size, total], [size / 2, total / 2], [0, total / 2], [size, total / 2]])
        if (Math.abs(position + offset - target) < 6) return target - offset;
      return position;
    };
    if (!shift) { x = snap(x, box.w, width); y = snap(y, box.h, height); }
    return {...start, x: round(x / width), y: round(y / height)};
  }
  if (mode === 'rotate') {
    const angle = point => Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;
    let rotation = (start.rotation || 0) + angle(now) - angle(from);
    rotation = shift ? Math.round(rotation / 15) * 15 : Math.round(rotation * 10) / 10;
    return {...start, rotation};
  }
  // Resize in the box's own turned frame: the far edge stays put, Shift on a corner keeps the shape.
  const [sx, sy] = sides[mode];
  const turn = (start.rotation || 0) * Math.PI / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const [lx, ly] = [dx * cos + dy * sin, -dx * sin + dy * cos];
  let w = sx ? Math.max(smallest, box.w + sx * lx) : box.w;
  let h = sy ? Math.max(smallest, box.h + sy * ly) : box.h;
  if (shift && sx && sy) { const scale = Math.max(w / box.w, h / box.h); [w, h] = [box.w * scale, box.h * scale]; }
  const [ox, oy] = [sx * (w - box.w) / 2, sy * (h - box.h) / 2];
  const middle = {x: center.x + ox * cos - oy * sin, y: center.y + ox * sin + oy * cos};
  return {...start, x: round((middle.x - w / 2) / width), y: round((middle.y - h / 2) / height), w: round(w / width), h: round(h / height)};
}

// What to save when the box at this moment went from `before` to `after`: the layer's own values moved the same
// way. null when nothing changed.
export function boxChange(layer, before, after) {
  const set = {};
  for (const key of ['x', 'y', 'rotation']) {
    const by = (after[key] || 0) - (before[key] || 0);
    if (Math.abs(by) > 1e-4) set[key] = round((layer[key] ?? 0) + by);
  }
  for (const key of ['w', 'h']) {
    if (Math.abs(after[key] - before[key]) > 1e-4) set[key] = round(Math.max(0.01, (layer[key] ?? 1) * after[key] / before[key]));
  }
  return Object.keys(set).length ? {set: {layer: layer.id, ...set}} : null;
}

// Auto-key: the same drag written as a keyframe at the playhead instead (the values the box has there now).
// time: video seconds, fps: what the moment rounds to. null when nothing changed or the playhead is off the layer.
export function keyChange(layer, time, fps, before, after) {
  const at = keyMoment(layer, time, fps);
  if (at === null) return null;
  const values = {};
  for (const key of ['x', 'y', 'w', 'h', 'rotation', 'opacity']) {
    if (key in after && Math.abs((after[key] ?? 0) - (before[key] ?? 0)) > 1e-4) values[key] = round(after[key]);
  }
  return Object.keys(values).length ? {keyframe: {layer: layer.id, at, ...values}} : null;
}

// Where the playhead is in a layer's own time (seconds after it appears, on a whole frame), or null off it.
export function keyMoment(layer, time, fps) {
  const at = Math.round((time - layer.from) * fps) / fps;
  return at < -0.0005 || at > layer.to - layer.from + 0.0005 ? null : +Math.max(0, at).toFixed(3);
}

// Moving a keyframe: off its old moment, the same values at the new one (one edit).
export function moveKey(layer, keyframe, at) {
  const {at: before, ...values} = keyframe;
  return Math.abs(at - before) < 0.0005 ? null : [{unkeyframe: {layer: layer.id, at: before}}, {keyframe: {layer: layer.id, at: +at.toFixed(3), ...values}}];
}

// Layers on the timeline, each on the first row where it fits (layers can overlap in time).
export function layerRows(layers) {
  const rows = [];
  for (const layer of [...layers].sort((a, b) => a.from - b.from)) {
    const row = rows.find(items => items.at(-1).to <= layer.from + 0.001);
    if (row) row.push(layer); else rows.push([layer]);
  }
  return rows;
}

// A layer on the timeline mid-drag: moved (both ends by `shift`, snapping either end to an edge) or trimmed
// (that end follows the pointer, already snapped). first and last: the recording part of the video.
export function layerSpan(layer, {mode, shift, now}, {edges, reach, frame, first, last}) {
  const length = layer.to - layer.from;
  if (mode === 'layer') {
    let by = frame(layer.from + shift) - layer.from, best = reach;
    for (const edge of edges) for (const end of [layer.from, layer.to]) {
      const off = Math.abs(end + shift - edge);
      if (off < best) { best = off; by = edge - end; }
    }
    const from = Math.max(first, Math.min(last - length, layer.from + by));
    return {from, to: from + length};
  }
  if (mode === 'layer-start') return {from: Math.max(first, Math.min(now, layer.to - 0.1)), to: layer.to};
  return {from: layer.from, to: Math.min(last, Math.max(now, layer.from + 0.1))};
}

// The change that saves a span, or null when it didn't move.
export function spanChange(layer, span) {
  const set = {};
  if (Math.abs(span.from - layer.from) > 0.0005) set.start = span.from;
  if (Math.abs(span.to - layer.to) > 0.0005) set.end = span.to;
  return Object.keys(set).length ? {set: {layer: layer.id, ...set}} : null;
}
