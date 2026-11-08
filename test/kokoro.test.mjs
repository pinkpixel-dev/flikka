// Kokoro's voices: the first letter is the language Kokoro reads the text in, and names it doesn't have are refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kokoroVoices, kokoroLanguages, voiceLanguage} from '../lib/kokoro.mjs';
import {voiceCommand} from '../lib/voice.mjs';

test('a voice speaks its own language, and adding your own voice needs consent', async () => {
  assert.equal(voiceLanguage('af_heart'), 'a');
  assert.equal(voiceLanguage('bf_emma'), 'b');
  assert.equal(voiceLanguage('ff_siwis'), 'f');
  assert.equal(voiceLanguage('zm_yunxi'), 'z');
  assert.equal(voiceLanguage('me'), null);
  assert.equal(kokoroVoices.length, 54);
  assert.ok(kokoroVoices.every(voice => kokoroLanguages[voice.code]));
  // Kokoro's voices come first; yours (if any) follow them.
  assert.deepEqual((await voiceCommand(['list'])).slice(0, kokoroVoices.length), kokoroVoices);
  await assert.rejects(voiceCommand(['add', 'me']), /--consent/);
  await assert.rejects(voiceCommand(['say', 'nobody-here', 'hi']), /There's no voice "nobody-here"/);
});
