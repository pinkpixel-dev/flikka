// A film scene's "say" as a string or a list (lib/say.mjs): sentences keep their own voice and speed, edits switch
// to the list form only when needed and back again, and the schema takes both forms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sayItems, sayFrom, editSay} from '../lib/say.mjs';
import {sceneSentences, schemaFile} from '../lib/film.mjs';
import {validate} from '../lib/schema.mjs';
import {readJSON} from '../lib/common.mjs';

test('a list say gives sentences their own voice and speed; the rest read in the film voice', () => {
  const film = {voice: {name: 'af_heart', speed: 1.1}};
  const scene = {say: ['Open the settings. Then wait.', {text: 'Save it.', voice: 'bf_emma', speed: 0.9}]};
  assert.deepEqual(sceneSentences(scene, film), [
    {text: 'Open the settings.', voice: 'af_heart', speed: 1.1}, {text: 'Then wait.', voice: 'af_heart', speed: 1.1}, {text: 'Save it.', voice: 'bf_emma', speed: 0.9}]);
  assert.deepEqual(sceneSentences({say: 'One. Two.'}, film).map(item => item.text), ['One.', 'Two.']);
  assert.deepEqual(sceneSentences({}, film), []);
});

test('editing one sentence switches to the list form only when it needs to, and back', () => {
  const said = editSay('One. Two. Three.', 1, {voice: 'bf_emma'});
  assert.deepEqual(said, ['One.', {text: 'Two.', voice: 'bf_emma'}, 'Three.']);
  assert.deepEqual(editSay(said, 1, {speed: '1.2'}), ['One.', {text: 'Two.', voice: 'bf_emma', speed: 1.2}, 'Three.']);
  assert.equal(editSay(said, 1, {voice: ''}), 'One. Two. Three.');
  assert.equal(editSay('One. Two.', 0, {text: 'First one.'}), 'First one. Two.');
  assert.equal(editSay('One. Two.', 0, {text: ''}), 'Two.');
  assert.equal(editSay('One.', 0, {text: ' '}), undefined);
  assert.deepEqual(sayItems(['A. B.', {text: 'C.', speed: 1.3}]), [{text: 'A.'}, {text: 'B.'}, {text: 'C.', speed: 1.3}]);
  assert.equal(sayFrom([{text: 'A.'}, {text: ' B. '}]), 'A. B.');
  assert.throws(() => editSay('One.', 3, {text: 'x'}), /no sentence 4/);
});

test('the film schema takes say as a string or a list of strings and {text, voice, speed}', async () => {
  const schema = await readJSON(schemaFile);
  const film = say => ({scenes: [{type: 'title', title: 'Hi', say}]});
  assert.deepEqual(validate(schema, film('Hello.')), []);
  assert.deepEqual(validate(schema, film(['Hello.', {text: 'Bye.', voice: 'bf_emma', speed: 1.2}])), []);
  assert.notDeepEqual(validate(schema, film([{voice: 'bf_emma'}])), []);
  assert.notDeepEqual(validate(schema, film([{text: 'Bye.', speed: 3}])), []);
});
