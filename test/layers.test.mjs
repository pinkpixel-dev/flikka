// Overlay layers: keyframe easing, the edit options, where layers land after cuts, and film scene layers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {editProject, undoProject, timelineProject} from '../lib/project.mjs';
import {layerAt, parseEasing, eased} from '../render/keyframes.js';
import {layerProblems, sceneLayers, layerArgs} from '../lib/layers.mjs';
import {boxChange, dragBox, layerRows, layerSpan, spanChange} from '../ui/src/layers/geometry.js';

const near = (actual, expected, within = 1e-3) => assert.ok(Math.abs(actual - expected) < within, `${actual} is not about ${expected}`);

async function scratchProject() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-layers-'));
  const file = path.join(folder, 'recording.project.json');
  await fs.writeFile(file, JSON.stringify({
    version: 1, source: 'recording.mp4', duration: 20, width: 1920, height: 1080, fps: 30, cursor: null, cursorBaked: true,
    clips: [{start: 0, end: 20}], markers: [], zooms: [],
    style: {background: '#111', padding: 64, radius: 20, shadow: true, cursorSize: 32, clickColor: '#fff'},
    captions: {enabled: true}, audio: {normalize: true, clicks: true}, export: {width: 1080, height: 1080, fps: 30}, webcam: null,
  }));
  return {folder, file};
}

test('easings follow the CSS curves', () => {
  assert.equal(parseEasing('linear'), null);
  assert.deepEqual(parseEasing('cubic-bezier(0.2, 0, 0, 1)'), [0.2, 0, 0, 1]);
  assert.equal(parseEasing('cubic-bezier(1.5, 0, 0, 1)'), undefined);
  assert.equal(parseEasing('bouncy'), undefined);
  // ease-in-out is symmetric: halfway in time is halfway in value.
  near(eased(parseEasing('ease-in-out'), 0.5), 0.5);
  assert.ok(eased(parseEasing('ease-in'), 0.25) < 0.25);
  assert.ok(eased(parseEasing('ease-out'), 0.25) > 0.25);
  near(eased(parseEasing('ease'), 1), 1);
});

test('keyframes move each value on its own, and hold after the last one', () => {
  const layer = {x: 0.1, y: 0.2, w: 0.3, h: 0.1, keyframes: [{at: 0, opacity: 0}, {at: 1, opacity: 1, ease: 'linear'}, {at: 2, x: 0.5, ease: 'linear'}]};
  assert.deepEqual(layerAt(layer, 0), {x: 0.1, y: 0.2, w: 0.3, h: 0.1, opacity: 0, rotation: 0});
  near(layerAt(layer, 0.5).opacity, 0.5);
  // x has no keyframe before 2 s, so it moves from its own value over the whole 2 s.
  near(layerAt(layer, 1).x, 0.3);
  assert.equal(layerAt(layer, 5).x, 0.5);
  assert.equal(layerAt(layer, 5).opacity, 1);
});

test('layer problems read like fixes', () => {
  assert.deepEqual(layerProblems({type: 'text', text: 'Hi', x: 0, y: 0, w: 0.5, h: 0.1}, {where: 'scene'}), []);
  assert.match(layerProblems({type: 'image', file: 'a.txt', x: 0, y: 0, w: 0.5, h: 0.1}, {where: 'scene'}).join(), /needs a file/);
  assert.match(layerProblems({type: 'solid', x: 0, y: 0, w: 0.5, h: 0.1, keyframes: [{at: 1, scale: 2}]}, {where: 'scene'}).join(), /can't be animated/);
  assert.match(layerProblems({type: 'solid', x: 0, y: 0, w: 0.5, h: 0.1, keyframes: [{at: 1, x: 1, ease: 'wobbly'}]}, {where: 'scene'}).join(), /ease is/);
  assert.match(layerProblems({type: 'solid', x: 0, y: 0, w: 0.5, h: 0.1, start: 3, end: 2}, {duration: 20}).join(), /start and end/);
});

test('a film scene\'s layers default to the whole scene and stop at its end', () => {
  const placed = sceneLayers({layers: [{type: 'solid', x: 0, y: 0, w: 1, h: 1}, {type: 'solid', start: 2, end: 9, x: 0, y: 0, w: 1, h: 1}, {type: 'solid', start: 6, x: 0, y: 0, w: 1, h: 1}]}, 5);
  assert.deepEqual(placed.map(layer => [layer.from, layer.to]), [[0, 5], [2, 5]]);
});

test('layer edits: add, set, keyframe, follow cuts, undo', async () => {
  const {folder, file} = await scratchProject();
  try {
    const picture = path.join(folder, 'logo.png');
    await fs.writeFile(picture, 'not really a png');
    await editProject(file, ['--layer', 'text,2,8,0.1,0.8,0.8,0.1,Hello, world', '--layer', `image,all,0.85,0.05,0.1,0.1,${picture}`, '--layer', 'solid,1,3,0,0,1,1,#000000aa']);
    let project = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(project.layers.map(layer => layer.id), ['l1', 'l2', 'l3']);
    assert.equal(project.layers[0].text, 'Hello, world');
    // The image was copied into the project, named by its contents.
    assert.match(project.layers[1].file, /^layers\/[0-9a-f]{16}\.png$/);
    assert.equal(await fs.readFile(path.join(folder, project.layers[1].file), 'utf8'), 'not really a png');

    await editProject(file, ['--layer-set', 'l1,size=0.06,align=left,order=front,text=Hi, there', '--keyframe', 'l1,0,opacity=0', '--keyframe', 'l1,0.5,opacity=1,ease=cubic-bezier(0.2,0,0,1)']);
    project = JSON.parse(await fs.readFile(file, 'utf8'));
    const text = project.layers.at(-1);
    assert.deepEqual([text.id, text.text, text.size, text.align], ['l1', 'Hi, there', 0.06, 'left']);
    assert.deepEqual(text.keyframes, [{at: 0, opacity: 0}, {at: 0.5, opacity: 1, ease: 'cubic-bezier(0.2,0,0,1)'}]);
    await assert.rejects(editProject(file, ['--keyframe', 'l1,1,scale=2']), /sets x, y, w, h, opacity, rotation/);
    await assert.rejects(editProject(file, ['--keyframe', 'l1,1,x=0.5,ease=bouncy']), /ease is/);
    await assert.rejects(editProject(file, ['--layer-set', 'l9,x=0']), /There is no layer l9/);

    // Cutting 1–4 s: the text's start (2 s) was cut, so it shows from where the video picks up (1 s);
    // the solid (1–3 s) was cut whole.
    await editProject(file, ['--cut', '1,4']);
    const timeline = await timelineProject(file);
    assert.deepEqual(timeline.layers.map(layer => [layer.id, layer.from, layer.to]), [['l2', 0, 17], ['l1', 1, 5]]);

    await editProject(file, ['--unkeyframe', 'l1,0', '--unlayer', 'l3']);
    project = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(project.layers.map(layer => layer.id), ['l2', 'l1']);
    assert.equal(project.layers[1].keyframes.length, 1);
    await editProject(file, ['--layers', 'off']);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).layers, undefined);
    assert.equal((await undoProject(file)).duration, 17);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).layers.length, 2);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('output-time layers land on recording moments', async () => {
  const {folder, file} = await scratchProject();
  try {
    await editProject(file, ['--cut', '0,5']);
    // Video 0:02–0:04 is recording 7–9.
    await editProject(file, ['--output-time', '--layer', 'solid,0:02,0:04,0,0,0.2,0.2', '--layer-set', 'l1,end=0:06']);
    const project = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual([project.layers[0].start, project.layers[0].end], [7, 11]);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('moving an animated layer takes its keyframes along', async () => {
  const {folder, file} = await scratchProject();
  try {
    await editProject(file, ['--layer', 'solid,1,5,0.1,0.1,0.2,0.2', '--keyframe', 'l1,1,x=0.5,w=0.4,opacity=0.5']);
    await editProject(file, ['--layer-set', 'l1,x=0.2,w=0.1,opacity=1']);
    const [layer] = JSON.parse(await fs.readFile(file, 'utf8')).layers;
    // x moved by 0.1 and w halved, so the keyframe did too; opacity isn't a place, so its keyframe stays.
    assert.deepEqual([layer.x, layer.w, layer.keyframes[0].x, layer.keyframes[0].w, layer.keyframes[0].opacity], [0.2, 0.1, 0.6, 0.2, 0.5]);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('the panel\'s layer changes become edit options', () => {
  assert.deepEqual(layerArgs([{add: {type: 'text', from: 1, to: 4, x: 0.1, y: 0.4, w: 0.8, h: 0.16, text: 'Hi,\n there'}}]), ['--layer', 'text,1.000,4.000,0.1,0.4,0.8,0.16,Hi, there']);
  assert.deepEqual(layerArgs([{add: {type: 'solid', from: 0, to: 2, x: 0, y: 0, w: 1, h: 1, color: 'rgba(0,0,0,.5)'}}]), ['--layer', 'solid,0.000,2.000,0,0,1,1,rgba(0,0,0,.5)']);
  assert.deepEqual(layerArgs([{set: {layer: 'l2', start: 2, x: 0.25, background: '', text: 'a, b'}}, {remove: 'l1'}]),
    ['--layer-set', 'l2,start=2.000,x=0.25,background=,text=a, b', '--unlayer', 'l1']);
  assert.throws(() => layerArgs([{set: {layer: 'l1', font: 'Inter'}}]), /can't set font/);
  assert.throws(() => layerArgs([{set: {layer: '../x', x: 1}}]), /Pick a layer/);
  assert.throws(() => layerArgs([]), /Nothing to change/);
});

test('the player box: move snaps, resize keeps the far edge, changes move the layer\'s own values', () => {
  const stage = {width: 1000, height: 500};
  const start = {x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 0, opacity: 1};
  // Dragged 398 px right: its middle lands 2 px from the video's middle, so it snaps there.
  assert.equal(dragBox(start, {mode: 'move', from: {x: 0, y: 0}, now: {x: 298, y: 0}}, stage).x, 0.4);
  const wider = dragBox(start, {mode: 'e', from: {x: 0, y: 0}, now: {x: 100, y: 50}}, stage);
  assert.deepEqual([wider.x, wider.y, wider.w, wider.h], [0.1, 0.1, 0.3, 0.2]);
  const turned = dragBox(start, {mode: 'rotate', from: {x: 200, y: 0}, now: {x: 300, y: 100}, shift: true}, stage);
  assert.equal(turned.rotation, 90);
  // At this moment keyframes put the box at x 0.3 with w 0.4: moving it 0.1 and halving it moves the layer's own x
  // by 0.1 and halves its own w.
  const layer = {id: 'l1', x: 0.1, w: 0.2};
  assert.deepEqual(boxChange(layer, {x: 0.3, y: 0, w: 0.4, h: 0.2}, {x: 0.4, y: 0, w: 0.2, h: 0.2}), {set: {layer: 'l1', x: 0.2, w: 0.1}});
  assert.equal(boxChange(layer, start, start), null);
});

test('the layers lane: rows for overlaps, moves and trims', () => {
  const rows = layerRows([{id: 'a', from: 0, to: 5}, {id: 'b', from: 2, to: 4}, {id: 'c', from: 5, to: 6}]);
  assert.deepEqual(rows.map(row => row.map(layer => layer.id)), [['a', 'c'], ['b']]);
  const options = {edges: [10], reach: 0.2, frame: value => Math.round(value * 30) / 30, first: 0, last: 20};
  // Moved 4.9 s: its end comes within reach of 10 s and snaps there.
  assert.deepEqual(layerSpan({from: 2, to: 5}, {mode: 'layer', shift: 4.9}, options), {from: 7, to: 10});
  assert.deepEqual(layerSpan({from: 2, to: 5}, {mode: 'layer-start', now: 4.95}, options), {from: 4.9, to: 5});
  assert.deepEqual(spanChange({id: 'l1', from: 2, to: 5}, {from: 2, to: 6}), {set: {layer: 'l1', end: 6}});
});
