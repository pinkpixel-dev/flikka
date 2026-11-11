// A film scene's layers for the panel's layer tools (LayerStage, LayerList). Those work in the film's own seconds
// with an id on every layer, like a recording's timeline; a scene keeps start and end in seconds from its own start,
// and ids are optional. part: where the scene sits in the live film, {start, seconds}.
import {animated, carryKeyframes} from '../../../render/keyframes.js';

const round = (value, places = 3) => +Number(value).toFixed(places);
const numbers = new Set([...Object.keys(animated), 'size', 'weight', 'radius']);
const texts = new Set(['color', 'background', 'fit', 'align']);

// The scene's layers where they show (as lib/layers.mjs sceneLayers places them), named #1, #2… when they have no id.
export function sceneLayerView(scene, part) {
  return (scene.layers || []).flatMap((layer, index) => {
    const from = Math.min(layer.start || 0, part.seconds), to = Math.min(layer.end ?? part.seconds, part.seconds);
    return to - from < 0.04 ? [] : [{...layer, id: layer.id || `#${index + 1}`, from: part.start + from, to: part.start + to}];
  });
}

// The scene with the panel's changes made (the same ones lib/layers.mjs layerArgs takes, in the film's seconds), and
// what to call the layers now: every layer gets an id once one is edited, so `renamed` maps #1… to it, and `added`
// is the new layer's id.
export function applySceneLayers(scene, changes, part) {
  const layers = (scene.layers || []).map(layer => structuredClone(layer));
  const used = new Set(layers.map(layer => layer.id).filter(Boolean));
  const next = () => { let number = 1; while (used.has(`l${number}`)) number++; used.add(`l${number}`); return `l${number}`; };
  const renamed = {};
  layers.forEach((layer, index) => { if (!layer.id) { layer.id = next(); renamed[`#${index + 1}`] = layer.id; } });
  const find = id => {
    const layer = layers.find(item => item.id === (renamed[id] || id));
    if (!layer) throw new Error(`There is no layer ${id}`);
    return layer;
  };
  // Film seconds → seconds from the scene's start; the end is left off when it's the scene's end.
  const sceneTime = value => Math.max(0, round(value - part.start));
  let added = null;
  for (const change of changes) {
    if (change.add) {
      const {type, from, to, x, y, w, h, text, color, file} = change.add;
      const layer = {id: next(), type, ...(sceneTime(from) > 0 && {start: sceneTime(from)}), ...(sceneTime(to) < part.seconds - 0.001 && {end: sceneTime(to)}), x, y, w, h};
      if (type === 'text') layer.text = text || 'Text';
      else if (type === 'solid') { if (color) layer.color = color; }
      else layer.file = file;
      layers.push(layer); added = layer.id;
    } else if (change.set) {
      const {layer: id, text, ...values} = change.set;
      const layer = find(id);
      for (const [key, value] of Object.entries(values)) {
        if (key === 'start') { const start = sceneTime(value); if (start > 0) layer.start = start; else delete layer.start; }
        else if (key === 'end') { const end = sceneTime(value); if (end < part.seconds - 0.001) layer.end = end; else delete layer.end; }
        else if (key === 'order') { layers.splice(layers.indexOf(layer), 1); value === 'front' ? layers.push(layer) : layers.unshift(layer); }
        else if (numbers.has(key)) { carryKeyframes(layer, key, Number(value)); layer[key] = round(value, 4); }
        else if (texts.has(key)) { if (value) layer[key] = value; else delete layer[key]; }
      }
      if (text !== undefined) layer.text = String(text).trim();
    } else if (change.remove) layers.splice(layers.indexOf(find(change.remove)), 1);
    else if (change.keyframe) {
      const {layer: id, at, ease, ...values} = change.keyframe;
      const layer = find(id), moment = round(at);
      const keyframe = {at: moment, ...(layer.keyframes || []).find(item => item.at === moment), ...values};
      if (ease !== undefined) { if (ease) keyframe.ease = ease; else delete keyframe.ease; }
      layer.keyframes = [...(layer.keyframes || []).filter(item => item.at !== moment), keyframe].sort((a, b) => a.at - b.at);
    } else if (change.unkeyframe) {
      const layer = find(change.unkeyframe.layer), moment = round(change.unkeyframe.at);
      layer.keyframes = (layer.keyframes || []).filter(item => item.at !== moment);
      if (!layer.keyframes.length) delete layer.keyframes;
    }
  }
  const changed = {...scene};
  if (layers.length) changed.layers = layers; else delete changed.layers;
  return {scene: changed, renamed, added};
}
