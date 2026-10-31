// The time mapping every agent tool relies on: recording seconds ↔ seconds in the finished video.
import test from 'node:test';
import assert from 'node:assert/strict';
import {segments, toOutput, toSource, seconds, demoFrames, clock} from '../render/timing.js';

// 1 s intro, then 0–5 s as recorded, a cut from 5 to 8, then 8–12 s at double speed. 30 fps.
const project = {export: {fps: 30}, intro: {duration: 1, text: 'Hi'}, clips: [{start: 0, end: 5}, {start: 8, end: 12, speed: 2}]};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('segments land after the intro, frame-exact and speed-aware', () => {
  const [first, second] = segments(project);
  assert.deepEqual([first.from, first.to], [1, 6]);
  assert.deepEqual([second.from, second.to], [6, 8]);
  assert.equal(second.speed, 2);
  // The video ends where the last part does, the same length the renderer draws.
  assert.equal(demoFrames(project) / 30, second.to);
});

test('toOutput maps kept moments and returns null for cut ones', () => {
  near(toOutput(project, 2), 3);
  near(toOutput(project, 10), 7);
  assert.equal(toOutput(project, 6), null);
  near(toOutput(project, 12), 8);
});

test('toSource is the inverse, and null in the intro', () => {
  near(toSource(project, 3), 2);
  near(toSource(project, 7), 10);
  assert.equal(toSource(project, 0.5), null);
  // On the boundary between the parts: a start belongs to the next part, a range's end to the one before.
  near(toSource(project, 6), 8);
  near(toSource(project, 6, {end: true}), 5);
});

test('rounding to frames never maps past the end of a part', () => {
  const odd = {export: {fps: 30}, clips: [{start: 0, end: 1.01}, {start: 2, end: 3}]};
  const [first] = segments(odd);
  assert.equal(first.to, 1); // 30.3 frames round to 30
  assert.ok(toSource(odd, first.to, {end: true}) <= 1.01);
  assert.ok(toOutput(odd, 1.005) <= first.to);
});

test('seconds reads plain seconds and clock times', () => {
  assert.equal(seconds('80'), 80);
  assert.equal(seconds('1:20.5'), 80.5);
  assert.equal(seconds('1:02:03'), 3723);
  assert.ok(Number.isNaN(seconds('soon')));
  assert.ok(Number.isNaN(seconds('-3')));
  assert.equal(clock(80.5), '1:20.50');
});
