// Narration over recordings: lines pinned to recording moments land in the right place after cuts, speed changes,
// freezes and an intro, and the edit options write lines an agent can come back to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {placeLines, lineGap} from '../lib/narration.mjs';
import {editProject, undoProject, timelineProject, validate} from '../lib/project.mjs';

const recording = (extra = {}) => ({
  version: 1, source: 'recording.mp4', duration: 20, width: 1920, height: 1080, fps: 30, cursor: null, cursorBaked: true,
  clips: [{start: 0, end: 20}], markers: [], zooms: [],
  style: {background: '#111', padding: 64, radius: 20, shadow: true, cursorSize: 32, clickColor: '#fff'},
  captions: {enabled: true}, audio: {normalize: true, clicks: true}, export: {width: 1080, height: 1080, fps: 30}, webcam: null, ...extra,
});
const round = value => value === null ? null : +value.toFixed(2);

test('lines follow the recording moment they were pinned to', () => {
  // Kept: 0–5 at 1x, then 8–20 at 2x, after a 1 s intro. Recording 10 s is video 1 + 5 + (10 - 8) / 2 = 7 s.
  const project = recording({intro: {text: 'Hi', duration: 1}, clips: [{start: 0, end: 5}, {start: 8, end: 20, speed: 2}], narration: {lines: [
    {id: 'n1', text: 'First.', at: 2},
    {id: 'n2', text: 'Then.', at: null},
    {id: 'n3', text: 'Later.', at: 10, until: 12},
    {id: 'n4', text: 'Cut away.', at: 6},
  ]}});
  const placed = placeLines(project, new Map([['n1', 1.5], ['n2', 1], ['n3', 2.5], ['n4', 1]]));
  assert.deepEqual(placed.map(line => [line.id, round(line.from), round(line.to)]), [
    ['n1', 3, 4.5],
    ['n2', round(4.5 + lineGap), round(5.5 + lineGap)],
    ['n3', 7, 9.5],
    // Recording 6 s was cut: the line starts where the video picks up again, recording 8 s = video 6 s.
    ['n4', 6, 7],
  ]);
  assert.equal(placed[3].snapped, true);
  // until 12 s is video 8 s: 1 s of room for a 2.5 s line.
  assert.equal(round(placed[2].room), 1);
  assert.equal(round(placed[2].overrun), 1.5);
});

test('lines that are not spoken yet have no end, and neither do the lines that follow them', () => {
  const project = recording({narration: {lines: [{id: 'n1', text: 'One.', at: 1}, {id: 'n2', text: 'Two.', at: null}, {id: 'n3', text: 'Three.', at: 15}]}});
  const placed = placeLines(project, new Map([['n3', 2]]));
  assert.deepEqual(placed.map(line => [round(line.from), round(line.to)]), [[1, null], [null, null], [15, 17]]);
});

test('overlaps and lines running past the end are reported', () => {
  const project = recording({narration: {lines: [{id: 'n1', text: 'Long.', at: 1}, {id: 'n2', text: 'Too soon.', at: 2}, {id: 'n3', text: 'Too late.', at: 19}]}});
  const placed = placeLines(project, new Map([['n1', 3], ['n2', 1], ['n3', 2]]));
  assert.equal(placed[1].overlaps, 'n1');
  assert.equal(round(placed[2].runsPast), 1);
});

test('a freeze pushes later lines back by its length, and trims shorten a line', () => {
  const project = recording({clips: [{start: 0, end: 5}, {start: 5, end: 5, hold: 2}, {start: 5, end: 20}], narration: {lines: [{id: 'n1', text: 'After.', at: 6, trimStart: 0.2, trimEnd: 0.3}]}});
  const [line] = placeLines(project, new Map([['n1', 1.5]]));
  assert.deepEqual([round(line.from), round(line.to)], [8, 9]);
});

test('narration edits: say, follow, reword, line settings, unsay and undo', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-narration-'));
  const file = path.join(folder, 'recording.project.json');
  await fs.writeFile(file, JSON.stringify(recording()));
  const read = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  try {
    await editProject(file, ['--say', '5,Open the settings, then wait.', '--say', '2,Hello there.', '--say', 'next,And we are done.']);
    let {narration} = await read();
    // Anchored lines sort by time, a following line goes on the end, and commas in the text survive.
    assert.deepEqual(narration.lines.map(line => [line.id, line.at, line.text]), [['n2', 2, 'Hello there.'], ['n1', 5, 'Open the settings, then wait.'], ['n3', null, 'And we are done.']]);

    // Output time: after cutting 0–4, video 1 s is recording 5 s.
    await editProject(file, ['--cut', '0,4']);
    await editProject(file, ['--output-time', '--line', 'n1,at=1,until=0:03,voice=bf_emma,gain=-3,fade-in=0.2,mute=on']);
    ({narration} = await read());
    assert.deepEqual(narration.lines.find(line => line.id === 'n1'), {id: 'n1', text: 'Open the settings, then wait.', at: 5, until: 7, voice: 'bf_emma', gain: -3, fadeIn: 0.2, muted: true});

    await editProject(file, ['--reword', 'n3,All done.', '--line', 'n1,voice=,gain=0,mute=off', '--narrator', 'am_michael,1.2', '--pronounce', 'Memlake=Mem-lake']);
    ({narration} = await read());
    assert.deepEqual(narration.lines.find(line => line.id === 'n1'), {id: 'n1', text: 'Open the settings, then wait.', at: 5, until: 7, fadeIn: 0.2});
    assert.equal(narration.lines.find(line => line.id === 'n3').text, 'All done.');
    assert.deepEqual([narration.voice, narration.speed, narration.pronounce], ['am_michael', 1.2, {Memlake: 'Mem-lake'}]);

    // The timeline lists every line; none are spoken in a test, so they have no end yet.
    const timeline = await timelineProject(file);
    assert.deepEqual(timeline.narration.map(line => [line.id, line.from, line.made]), [['n2', 0, false], ['n1', 1, false], ['n3', null, false]]);
    assert.equal(timeline.narration[0].snapped, true);

    await assert.rejects(editProject(file, ['--line', 'n9,gain=1']), /no narration line "n9"/);
    await assert.rejects(editProject(file, ['--line', 'n1,voice=nobody']), /not a Kokoro voice/);
    await assert.rejects(editProject(file, ['--line', 'n1,speed=3']), /0\.7–1\.5/);

    await editProject(file, ['--unsay', 'n2']);
    assert.deepEqual((await read()).narration.lines.map(line => line.id), ['n1', 'n3']);
    await undoProject(file);
    assert.deepEqual((await read()).narration.lines.map(line => line.id), ['n2', 'n1', 'n3']);

    // default puts the voice back to the one in Settings and keeps the speed.
    await editProject(file, ['--unsay', 'all', '--narrator', 'default', '--pronounce', 'off']);
    assert.deepEqual((await read()).narration, {lines: [], speed: 1.2});
  } finally {
    await fs.rm(folder, {recursive: true, force: true});
  }
});

test('the project check catches broken narration', () => {
  assert.throws(() => validate(recording({narration: {lines: [{id: 'n1', text: 'Hi', at: 30}]}})), /at must be a moment of the recording/);
  assert.throws(() => validate(recording({narration: {lines: [{id: 'n1', text: 'Hi', at: 1}, {id: 'n1', text: 'Again', at: 2}]}})), /two lines have the id "n1"/);
  assert.throws(() => validate(recording({narration: {lines: [{id: 'n1', text: 'Hi', at: 1, gian: 2}]}})), /unknown field "gian"/);
  assert.throws(() => validate(recording({narration: {lines: [], voise: 'af_heart'}})), /unknown field "voise"/);
  assert.doesNotThrow(() => validate(recording({narration: {voice: 'af_heart', duck: false, lines: [{id: 'n1', text: 'Hi', at: null}]}})));
});
