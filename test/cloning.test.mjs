// Your own voices: found by name or id, cached by their reference clip, accepted wherever a voice is named, and
// spoken through flikka-voice, whose failures come back as messages a person can act on. A fake helper stands in for
// the real one, so these run without the model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-cloning-'));
const voices = path.join(home, 'voices');
Object.assign(process.env, {HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), FLIKKA_VOICES: voices});
const {ownVoices, findOwnVoice, speechLanguage, saveOwnVoice, speakCloned, modelDir, modelFiles} = await import('../lib/cloning.mjs');
const {narrationClip} = await import('../lib/film.mjs');
const {validate} = await import('../lib/project.mjs');

async function addVoice(id, name, created) {
  await fs.mkdir(path.join(voices, id), {recursive: true});
  await fs.writeFile(path.join(voices, id, 'reference.wav'), 'RIFF');
  await fs.writeFile(path.join(voices, id, 'voice.json'), JSON.stringify({name, source: 'Recorded', createdMs: created}));
}

// A stand-in for flikka-voice: says it loaded, then answers each job, failing any whose text says "stumble".
async function fakeHelper(body) {
  const file = path.join(home, `helper-${Math.random().toString(16).slice(2)}.mjs`);
  await fs.writeFile(file, `#!/usr/bin/env node\n${body}`);
  await fs.chmod(file, 0o755);
  return file;
}

test('your voices are found by id or name, and Kokoro names always mean Kokoro', async () => {
  await addVoice('v1', 'My voice', 2);
  await addVoice('v2', 'Narrator', 1);
  await fs.mkdir(path.join(voices, 'not-a-voice'), {recursive: true});
  assert.deepEqual(ownVoices().map(voice => voice.name), ['Narrator', 'My voice']);
  assert.equal(findOwnVoice('my VOICE').id, 'v1');
  assert.equal(findOwnVoice('v2').name, 'Narrator');
  assert.equal(findOwnVoice('af_heart'), null);
  assert.equal(speechLanguage('My voice'), 'a');
  assert.equal(speechLanguage('bf_emma'), 'b');
  assert.equal(speechLanguage('Nobody'), null);
  await assert.rejects(saveOwnVoice({name: 'af_heart', source: 'Recorded', clip: path.join(voices, 'v1', 'reference.wav'), consent: true}), /one of Kokoro's voices/);
});

test('a line in your voice is cached by the voice, and made again when its clip changes', async () => {
  const before = narrationClip('Hello there.', 'My voice', 1, '/cache');
  assert.equal(narrationClip('Hello there.', 'v1', 1, '/cache'), before);
  assert.notEqual(narrationClip('Hello there.', 'af_heart', 1, '/cache'), before);
  await new Promise(resolve => setTimeout(resolve, 20));
  await fs.writeFile(path.join(voices, 'v1', 'reference.wav'), 'RIFF, again');
  assert.notEqual(narrationClip('Hello there.', 'My voice', 1, '/cache'), before);
});

test('narration lines can be read in your voice', () => {
  const project = {version: 1, source: 'recording.mp4', duration: 20, width: 1920, height: 1080, clips: [{start: 0, end: 20}],
    style: {background: '#111', padding: 64, radius: 20, shadow: true, cursorSize: 32}, export: {width: 1080, height: 1080, fps: 30}};
  assert.doesNotThrow(() => validate({...project, narration: {voice: 'My voice', lines: [{id: 'n1', text: 'Hi.', at: 1, voice: 'Narrator'}]}}));
  assert.throws(() => validate({...project, narration: {voice: 'Nobody', lines: []}}), /not a Kokoro voice or one of yours/);
});

test('speaking through the helper: every line answered, a failed line named, an old system explained', async () => {
  // Model files of the right size count as downloaded (sparse, so they take no space).
  for (const [name, size] of modelFiles) {
    await fs.mkdir(path.dirname(path.join(modelDir, name)), {recursive: true});
    await (await fs.open(path.join(modelDir, name), 'w')).truncate(size);
  }
  process.env.FLIKKA_VOICE_BIN = await fakeHelper(`
import {createInterface} from 'node:readline';
const say = value => process.stdout.write(JSON.stringify(value) + '\\n');
say({event: 'loaded', provider: 'cpu', seconds: 0.1});
createInterface({input: process.stdin}).on('line', line => {
  const job = JSON.parse(line);
  if (!process.argv.includes('${voices}')) return say({event: 'error', id: job.id, error: 'wrong voices folder'});
  say(job.text.includes('stumble') ? {event: 'error', id: job.id, error: 'speech generation failed'} : {event: 'done', id: job.id, out: job.out, seconds: 1, elapsed: 0.5});
});`);
  const done = await speakCloned('My voice', [{text: 'One.', out: '/tmp/a.wav'}, {text: 'Two.', out: '/tmp/b.wav'}]);
  assert.deepEqual(done.map(line => line.out), ['/tmp/a.wav', '/tmp/b.wav']);
  await assert.rejects(speakCloned('My voice', [{text: 'Fine.', out: '/tmp/c.wav'}, {text: 'I stumble here.', out: '/tmp/d.wav'}]), /Couldn't say "I stumble here\." in My voice/);
  await assert.rejects(speakCloned('Nobody', [{text: 'Hi.', out: '/tmp/e.wav'}]), /There's no voice "Nobody"/);

  process.env.FLIKKA_VOICE_BIN = await fakeHelper(`
process.stderr.write("flikka-voice: /lib/libc.so.6: version \`GLIBC_2.43' not found (required by flikka-voice)\\n");
process.exit(1);`);
  await assert.rejects(speakCloned('My voice', [{text: 'Hi.', out: '/tmp/f.wav'}]), /need a newer Linux: glibc 2\.38/);
  delete process.env.FLIKKA_VOICE_BIN;
});

test.after(() => fs.rm(home, {recursive: true, force: true}));
