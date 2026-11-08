// flikka-cursor's log becomes a screen recording's cursor events: wall-clock times turned into seconds from the
// recording's start, with the pointer placed from the first frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {alignPointer} from '../lib/screen.mjs';

const line = (t, x, y, visible = true) => JSON.stringify({type: 'move', x, y, t, visible});

test('times count from the recording start', () => {
  const events = alignPointer([line(1000.25, 0.1, 0.2), line(1001.5, 0.3, 0.4)].join('\n'), 1000);
  assert.deepEqual(events.map(event => [event.t, event.x, event.y]), [[0.25, 0.1, 0.2], [1.5, 0.3, 0.4]]);
});

test('the last position before the start is where the pointer begins', () => {
  const events = alignPointer([line(998, 0.9, 0.9), line(999.5, 0.5, 0.6), line(1002, 0.7, 0.7)].join('\n'), 1000);
  assert.deepEqual(events.map(event => [event.t, event.x]), [[0, 0.5], [2, 0.7]]);
});

test('a pointer off the monitor stays hidden, and broken lines are skipped', () => {
  const events = alignPointer([line(1001, 1.2, 0.5, false), '{"type":"mo', '', line(1003, 0.2, 0.5)].join('\n'), 1000);
  assert.deepEqual(events.map(event => [event.t, event.visible]), [[1, false], [3, true]]);
});

test('nothing logged gives no events', () => {
  assert.deepEqual(alignPointer('', 1000), []);
});
