// Agent tools on a real project file: output-time edits, dry runs, the timeline, and undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {editProject, undoProject, timelineProject} from '../lib/project.mjs';

async function scratchProject() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-test-'));
  const file = path.join(folder, 'recording.project.json');
  await fs.writeFile(file, JSON.stringify({
    version: 1, source: 'recording.mp4', duration: 20, width: 1920, height: 1080, fps: 30, cursor: null, cursorBaked: true,
    clips: [{start: 0, end: 20}], markers: [], zooms: [{start: 4, end: 7, x: 0.5, y: 0.5, scale: 1.5}],
    style: {background: '#111', padding: 64, radius: 20, shadow: true, cursorSize: 32, clickColor: '#fff'},
    captions: {enabled: true}, audio: {normalize: true, clicks: true}, export: {width: 1080, height: 1080, fps: 30}, webcam: null,
  }));
  return {folder, file};
}

test('output-time edits, dry runs, timeline and undo work together', async () => {
  const {folder, file} = await scratchProject();
  try {
    await editProject(file, ['--cut', '5,8', '--speed', '2,12,16']);
    let timeline = await timelineProject(file);
    assert.equal(timeline.duration, 15);
    // A zoom cut short by the cut ends exactly where the kept part ends (it once came out as null).
    assert.deepEqual(timeline.zooms.map(zoom => [zoom.from, zoom.to]), [[4, 5]]);

    // Video 0:10–0:12 is source 14–16 (2x) plus 16–17: a dry run changes nothing on disk.
    const dry = await editProject(file, ['--output-time', '--cut', '0:10,0:12', '--dry-run']);
    assert.deepEqual([dry.before.duration, dry.after.duration], [15, 13]);
    assert.equal((await timelineProject(file)).duration, 15);

    await editProject(file, ['--output-time', '--cut', '0:10,0:12']);
    timeline = await timelineProject(file);
    assert.deepEqual(timeline.parts.map(part => part.source), [[0, 5], [8, 12], [12, 14], [17, 20]]);
    await assert.rejects(editProject(file, ['--output-time', '--cut', '0:40,0:45']), /not in the recording part/);

    assert.equal((await undoProject(file)).duration, 15);
    assert.equal((await undoProject(file)).duration, 20);
    await assert.rejects(undoProject(file), /Nothing to undo/);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('trim, freeze and ramp edits, in video time, with undo', async () => {
  const {folder, file} = await scratchProject();
  try {
    await editProject(file, ['--trim', '2,18']);
    assert.equal((await timelineProject(file)).duration, 16);

    // Video 0:05 is recording 7: hold it for 1.5 s.
    await editProject(file, ['--output-time', '--freeze', '0:05,1.5']);
    let timeline = await timelineProject(file);
    assert.equal(timeline.duration, 17.5);
    assert.deepEqual(timeline.parts.map(part => part.freeze ? `freeze@${part.source[0]}` : part.source.join('-')), ['2-7', 'freeze@7', '7-18']);

    // A speed change with a ramp: one ramp part between the two speeds, and the video gets shorter.
    await editProject(file, ['--speed', '2,10,18', '--ramp', '0.5']);
    timeline = await timelineProject(file);
    const ramp = timeline.parts.find(part => part.ramp);
    assert.ok(ramp && ramp.speed[0] > 1 && ramp.speed[1] < 2);
    assert.ok(timeline.duration < 17.5 && timeline.duration > 13);
    // The freeze survived the speed edit.
    assert.ok(timeline.parts.some(part => part.freeze === 1.5));

    await assert.rejects(editProject(file, ['--freeze', '1,2']), /was cut/);
    await assert.rejects(editProject(file, ['--ramp', '9']), /0.2–2/);
    await undoProject(file); await undoProject(file);
    assert.equal((await timelineProject(file)).duration, 16);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('crop, manual zooms, spotlights and typing zooms', async () => {
  const {folder, file} = await scratchProject();
  try {
    // Pixels of the 1920×1080 recording become fractions; off brings the whole recording back.
    await editProject(file, ['--crop', '960,0,960,540']);
    assert.deepEqual((await timelineProject(file)).crop, {x: 0.5, y: 0, w: 0.5, h: 0.5});
    await assert.rejects(editProject(file, ['--crop', '0.9,0,0.01,0.5']), /Invalid crop/);
    await editProject(file, ['--crop', 'off']);
    assert.equal((await timelineProject(file)).crop, undefined);

    // A manual zoom replaces the automatic one it overlaps (4–7) and takes video times.
    await editProject(file, ['--cut', '0,2']);
    await editProject(file, ['--output-time', '--zoom', '0:03,0:06,0.2,0.8,2']);
    let timeline = await timelineProject(file);
    assert.deepEqual(timeline.zooms, [{from: 3, to: 6, x: 0.2, y: 0.8, scale: 2}]);
    await assert.rejects(editProject(file, ['--zoom', '1,2,1.5,0.5']), /x and y from 0 to 1/);

    await editProject(file, ['--output-time', '--spotlight', '1,3,0.1,0.1,0.3,0.2']);
    timeline = await timelineProject(file);
    assert.deepEqual(timeline.spotlights, [{from: 1, to: 3, x: 0.1, y: 0.1, w: 0.3, h: 0.2}]);
    await editProject(file, ['--spotlight', 'off']);
    assert.deepEqual((await timelineProject(file)).spotlights, []);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('auto-zoom follows typing to the focused field', async () => {
  const {folder, file} = await scratchProject();
  try {
    const project = JSON.parse(await fs.readFile(file, 'utf8'));
    const events = [{type: 'click', x: 0.5, y: 0.5, t: 2},
      // Six keys into a field at (0.3, 0.7) from 8 to 10.5 s, then a stray key at 15 s (too few to zoom on).
      ...[8, 8.5, 9, 9.5, 10, 10.5].map(t => ({type: 'key', x: 0.5, y: 0.5, fx: 0.3, fy: 0.7, t})), {type: 'key', x: 0.5, y: 0.5, fx: 0.9, fy: 0.1, t: 15}];
    await fs.writeFile(path.join(folder, 'recording.cursor.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
    await fs.writeFile(file, JSON.stringify({...project, cursor: 'recording.cursor.jsonl', zooms: []}));
    await editProject(file, ['--auto-zoom']);
    const {zooms} = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(zooms.length, 2);
    const typing = zooms[1];
    assert.deepEqual([typing.x, typing.y], [0.3, 0.7]);
    // In from just before the first key until a second after the last.
    assert.ok(Math.abs(typing.start - 7.65) < 1e-9 && Math.abs(typing.end - 11.5) < 1e-9);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('callouts, steps, arrows, boxes, redactions and keystrokes', async () => {
  const {folder, file} = await scratchProject();
  try {
    await editProject(file, ['--cut', '0,2']);
    await editProject(file, ['--output-time',
      '--step', '0:01,0:03,0.2,0.3,Open the menu, then Save',
      '--callout', '0:04,0:06,0.8,0.5,Saved!',
      '--arrow', '1,3,0.1,0.1,0.2,0.3',
      '--box', '1,3,0.15,0.25,0.2,0.1',
      '--redact', '0,2,0.5,0.5,0.2,0.1']);
    await editProject(file, ['--redact', 'all,0,0,0.3,0.05,solid']);
    let timeline = await timelineProject(file);
    // Text keeps its commas; video times come back out as the same video times.
    const step = timeline.annotations.find(item => item.type === 'step');
    assert.deepEqual(step, {from: 1, to: 3, type: 'step', x: 0.2, y: 0.3, text: 'Open the menu, then Save'});
    assert.deepEqual(timeline.annotations.map(item => item.type).sort(), ['arrow', 'box', 'callout', 'step']);
    assert.deepEqual(timeline.redactions.map(item => [item.from, item.to, item.style]), [[0, 18, 'solid'], [0, 2, 'blur']]);

    await assert.rejects(editProject(file, ['--callout', '1,2,0.5,0.5,']), /Invalid annotation/);
    await assert.rejects(editProject(file, ['--box', '1,2,0.9,0.5,0.3,0.1']), /Invalid annotation/);
    await assert.rejects(editProject(file, ['--redact', '1,2,0.1,0.1,0.2,0.2,pixel']), /blur \(the default\) or solid/);

    await editProject(file, ['--annotations', 'off', '--redact', 'off']);
    timeline = await timelineProject(file);
    assert.deepEqual([timeline.annotations, timeline.redactions], [[], []]);

    // Keystrokes: only combos show (plain key events carry none), at their place in the video.
    const project = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(path.join(folder, 'recording.cursor.jsonl'), [{type: 'key', x: 0.5, y: 0.5, t: 5, combo: 'Ctrl+S'}, {type: 'key', x: 0.5, y: 0.5, t: 6}].map(event => JSON.stringify(event)).join('\n'));
    await fs.writeFile(file, JSON.stringify({...project, cursor: 'recording.cursor.jsonl'}));
    await editProject(file, ['--keystrokes', 'on']);
    assert.deepEqual((await timelineProject(file)).keystrokes, [{at: 3, keys: 'Ctrl+S'}]);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});
