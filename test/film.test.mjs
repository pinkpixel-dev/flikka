// Saving a film from the panel: the schema guards it, every save can be undone, and undo walks back in order.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {saveFilm, undoFilm} from '../lib/film.mjs';

const read = file => fs.readFile(file, 'utf8').then(JSON.parse);

test('film saves are checked against the schema and undo in order', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-film-'));
  const file = path.join(folder, 'film.json');
  const first = {scenes: [{type: 'title', title: 'One'}, {type: 'title', title: 'Two'}]};
  await fs.writeFile(file, JSON.stringify(first, null, 2) + '\n');
  try {
    // A scene with no title, and a misspelled field: refused, nothing written.
    await assert.rejects(saveFilm(file, {scenes: [{type: 'title'}]}), /^Error: Scene 1: missing "title"$/);
    await assert.rejects(saveFilm(file, {...first, captoins: false}), /^Error: Film: unknown field "captoins"/);
    assert.deepEqual(await read(file), first);

    // Moving a scene, then a setting: two saves, two steps back.
    const moved = {scenes: [first.scenes[1], first.scenes[0]]};
    assert.deepEqual(await saveFilm(file, moved), {saved: true});
    assert.deepEqual(await saveFilm(file, {...moved, captions: false}), {saved: true});
    // The same film again changes nothing and leaves no step to undo.
    assert.deepEqual(await saveFilm(file, {...moved, captions: false}), {saved: false});
    await undoFilm(file);
    assert.deepEqual(await read(file), moved);
    await undoFilm(file);
    assert.deepEqual(await read(file), first);
    await assert.rejects(undoFilm(file), /Nothing to undo/);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});
