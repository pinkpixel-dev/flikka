// Overlay layers: keyframe easing, the edit options, where layers land after cuts, and film scene layers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {editProject, undoProject, timelineProject} from '../lib/project.mjs';
import {layerAt, parseEasing, eased} from '../render/keyframes.js';
import {layerProblems, sceneLayers} from '../lib/layers.mjs';

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
