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

test('moving a line keeps the lines in time order, and the lines following it go along', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-narration-'));
  const file = path.join(folder, 'recording.project.json');
  await fs.writeFile(file, JSON.stringify(recording({narration: {lines: [
    {id: 'n1', text: 'One.', at: 2}, {id: 'n2', text: 'Two.', at: null}, {id: 'n3', text: 'Three.', at: 8}, {id: 'n4', text: 'Four.', at: 12, trimStart: 0.25},
  ]}})));
  const order = async () => JSON.parse(await fs.readFile(file, 'utf8')).narration.lines.map(line => line.id);
  try {
    // n1 moves past n3: n2 follows n1, so it goes along.
    await editProject(file, ['--line', 'n1,at=10']);
    assert.deepEqual(await order(), ['n3', 'n1', 'n2', 'n4']);
    // A following line that's moved gets a moment of its own.
    await editProject(file, ['--line', 'n2,at=1']);
    assert.deepEqual(await order(), ['n2', 'n3', 'n1', 'n4']);
    // The timeline shows a line's trims, so the panel can draw and change them.
    const timeline = await timelineProject(file);
    assert.equal(timeline.narration.find(line => line.id === 'n4').trimStart, 0.25);
  } finally {
    await fs.rm(folder, {recursive: true, force: true});
  }
});

test('timeline lines: a move snaps an end to a nearby edge, trims stay inside the clip', async () => {
  const {dragShape, lineChange, lineShape} = await import('../ui/src/timeline/lines.js');
  const frame = value => Math.round(value * 30) / 30;
  const line = {id: 'n1', text: 'Hello there.', from: 2, to: 4, trimStart: 0.5, trimEnd: 0.5, room: 3};
  const context = {edges: [6.1], reach: 0.15, frame, first: 0, last: 20};
  assert.deepEqual(lineShape(line), {from: 2, to: 4, trimStart: 0.5, trimEnd: 0.5, full: 3});
  // Moved 2 s: the end lands at 6, near the edge at 6.1, so it snaps there. until moves along (room 3 s).
  const moved = dragShape(line, {mode: 'line', shift: 2, now: 0}, context);
  assert.deepEqual([round(moved.from), round(moved.to)], [4.1, 6.1]);
  assert.deepEqual(lineChange(line, 'line', moved), {set: {line: 'n1', at: moved.from, until: moved.from + 3}});
  // A start trim can't reach back past the clip's own start, and an end trim can't go past its end.
  const start = dragShape(line, {mode: 'trim-start', shift: 0, now: 0}, context);
  assert.deepEqual([round(start.from), round(start.trimStart)], [1.5, 0]);
  assert.deepEqual(lineChange(line, 'trim-start', start), {set: {line: 'n1', at: start.from, trimStart: start.trimStart}});
  const end = dragShape(line, {mode: 'trim-end', shift: 0, now: 3}, context);
  assert.deepEqual([round(end.to), round(end.trimEnd)], [3, 1.5]);
  assert.equal(lineChange(line, 'trim-end', dragShape(line, {mode: 'trim-end', shift: 0, now: 9}, context)).set.trimEnd, 0);
  // Nothing moved, nothing to save.
  assert.equal(lineChange(line, 'line', lineShape(line)), null);
});

test('narration edits: split a line at a character or at words, and merge it back', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-narration-'));
  const file = path.join(folder, 'recording.project.json');
  const lines = [{id: 'n1', text: 'Open the settings.', at: 1}, {id: 'n2', text: 'Pick a theme, then save it.', at: 5, until: 12, voice: 'bf_emma', gain: -2, fadeIn: 0.3}];
  await fs.writeFile(file, JSON.stringify(recording({narration: {lines}})));
  const read = async () => (JSON.parse(await fs.readFile(file, 'utf8'))).narration.lines;
  try {
    // The first half keeps its moment, the second follows it and keeps the until; both keep the voice and gain
    // but lose the fade, since they're spoken again.
    await editProject(file, ['--split', 'n2,then save']);
    assert.deepEqual(await read(), [lines[0], {id: 'n2', text: 'Pick a theme,', at: 5, voice: 'bf_emma', gain: -2}, {id: 'n3', text: 'then save it.', at: null, until: 12, voice: 'bf_emma', gain: -2}]);
    await editProject(file, ['--split', 'n3,5']);
    assert.deepEqual((await read()).map(line => line.text), ['Open the settings.', 'Pick a theme,', 'then', 'save it.']);

    // A merge joins a line onto the one before it, which keeps its moment, settings and the later until.
    await editProject(file, ['--merge', 'n4', '--merge', 'n3']);
    assert.deepEqual((await read())[1], {id: 'n2', text: 'Pick a theme, then save it.', at: 5, voice: 'bf_emma', gain: -2, until: 12});

    await assert.rejects(editProject(file, ['--merge', 'n1']), /first line/);
    await assert.rejects(editProject(file, ['--split', 'n1,nowhere']), /--split takes/);
    await assert.rejects(editProject(file, ['--split', 'n1,0']), /--split takes/);
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

test('Fit asks for just enough speed, capped at 1.3×, and Shorten gets a word budget', async () => {
  const {fitSpeed, shortenTo, maxFitSpeed} = await import('../lib/narration.mjs');
  // 2.88 s of speech in 2.5 s of room at 1×: 1.15 × 1.03 headroom, rounded up.
  assert.equal(fitSpeed(1, 2.88, 2.5), 1.19);
  assert.equal(fitSpeed(1.2, 4, 2), maxFitSpeed);
  assert.equal(fitSpeed(maxFitSpeed, 4, 2), null);
  assert.equal(fitSpeed(1, 2, 0), null);
  // Ten words in 4 s with 3 s of room: 7 words fit (less 5%), marks counted as their word.
  assert.equal(shortenTo('one two three four five six seven eight nine [ten](tenn)', 4, 3), 7);
  assert.equal(shortenTo('one two three four', 4, 0.5), 3);
  // placeLines gives a line that runs over its word budget.
  const project = recording({narration: {lines: [{id: 'n1', text: 'one two three four five six seven eight nine ten', at: 1, until: 4}]}});
  const [line] = placeLines(project, new Map([['n1', 4]]));
  assert.deepEqual([+line.overrun.toFixed(2), line.shortenTo], [1, 7]);
});
