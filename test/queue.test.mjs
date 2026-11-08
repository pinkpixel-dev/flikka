// The panel's render queue: one render at a time, in order, a waiting one can be taken out, and a failure
// doesn't stop the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderQueue} from '../lib/queue.mjs';

test('renders run one at a time, in order', async () => {
  const started = [], finish = {};
  const queue = renderQueue(id => { started.push(id); return new Promise((resolve, reject) => { finish[id] = {resolve, reject}; }); });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  queue.add('a'); queue.add('b'); queue.add('c');
  await tick();
  assert.deepEqual(started, ['a']);
  assert.equal(queue.status('c').ahead, 2);
  // Asking again keeps the place in line.
  assert.equal(queue.add('b').ahead, 1);
  assert.equal(queue.list().length, 3);

  queue.cancel('b');
  assert.throws(() => queue.cancel('a'), /isn’t waiting/);
  finish.a.reject(new Error('boom'));
  await tick(); await tick();
  assert.deepEqual(started, ['a', 'c']);
  assert.equal(queue.status('a').error, 'boom');
  finish.c.resolve();
  await tick(); await tick();
  assert.deepEqual(queue.list().map(item => [item.id, item.state]), [['a', 'failed'], ['b', 'cancelled'], ['c', 'done']]);
  queue.clear();
  assert.deepEqual(queue.list(), []);
});
