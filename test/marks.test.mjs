// Say-as marks: [read](red) and [GIF](/ʤˈɪf/) in narration text, read the right way by each engine, kept out of
// captions, and written by --say-as and phoneme pronunciations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {marks, plainText, insideMark, kokoroText, markWord} from '../lib/marks.mjs';
import {editNarration} from '../lib/narration.mjs';
import {captionLines} from '../lib/film.mjs';

const text = 'I [read](red) the [GIF](/ʤˈɪf/) spec.';

test('marks are found, and captions see the plain words', () => {
  assert.deepEqual(marks(text).map(mark => [mark.word, mark.say]), [['read', 'red'], ['GIF', '/ʤˈɪf/']]);
  assert.equal(plainText(text), 'I read the GIF spec.');
  assert.deepEqual(captionLines(text, 0, 2).map(line => line.text), ['I read the GIF spec.']);
  assert.equal(insideMark(text, 4), true);
  assert.equal(insideMark(text, 1), false);
});

test('Kokoro reads sounds-like marks as their respelling and keeps phonemes for English only', () => {
  assert.equal(kokoroText(text, 'a'), 'I red the [GIF](/ʤˈɪf/) spec.');
  assert.equal(kokoroText(text, 'f'), 'I red the GIF spec.');
});

test('markWord marks the first free place a word stands alone, and takes a mark off', () => {
  assert.equal(markWord('Read it, then read it again.', 'read', 'red'), 'Read it, then [read](red) it again.');
  assert.equal(markWord('I [read](red) and read.', 'read', '/ɹˈid/'), 'I [read](red) and [read](/ɹˈid/).');
  assert.equal(markWord('A bread roll.', 'read', 'red'), null);
  assert.equal(markWord('I [read](red) it.', 'read', ''), 'I read it.');
});

test('--say-as writes a mark, --split refuses to cut inside one', () => {
  const project = {duration: 20, narration: {lines: [{id: 'n1', text: 'Open the GIF settings.', at: 1}]}};
  editNarration(project, ['--say-as', 'n1,GIF=/ʤˈɪf/'], 0, {});
  assert.equal(project.narration.lines[0].text, 'Open the [GIF](/ʤˈɪf/) settings.');
  assert.throws(() => editNarration(project, ['--split', 'n1,12'], 0, {}), /inside a say-as mark/);
  assert.throws(() => editNarration(project, ['--say-as', 'n1,cake=kayk'], 0, {}), /isn't in n1/);
  editNarration(project, ['--say-as', 'n1,GIF='], 0, {});
  assert.equal(project.narration.lines[0].text, 'Open the GIF settings.');
});
