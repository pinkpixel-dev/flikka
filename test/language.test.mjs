// Narration in other languages: sentences end where each language ends them, and Japanese and Chinese captions
// break by characters (they have no spaces), while other languages keep breaking by words.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sentences, captionLines} from '../lib/film.mjs';

test('sentences and caption lines follow the narration language', () => {
  assert.deepEqual(sentences('今日はいい天気ですね。散歩に行きましょう！「本当？」'), ['今日はいい天気ですね。', '散歩に行きましょう！', '「本当？」']);
  assert.deepEqual(sentences('यह मेरा टूल है। यह काम करता है।'), ['यह मेरा टूल है।', 'यह काम करता है।']);
  assert.deepEqual(sentences('Hola. ¿Qué tal? Muy bien'), ['Hola.', '¿Qué tal?', 'Muy bien']);

  const chinese = captionLines('它可以录制屏幕，剪掉无聊的部分，然后在两分钟内生成一个短视频。', 10, 6, 'z');
  assert.ok(chinese.every(line => line.text.length <= 16), JSON.stringify(chinese));
  assert.equal(chinese.map(line => line.text).join(''), '它可以录制屏幕，剪掉无聊的部分，然后在两分钟内生成一个短视频。');
  // Timed back to back over the sentence.
  assert.equal(chinese[0].start, 10);
  assert.ok(Math.abs(chinese.at(-1).end - 16) < 1e-9);

  const spanish = captionLines('Graba la pantalla, corta las partes aburridas y hace un video corto en dos minutos.', 0, 5, 'e');
  assert.ok(spanish.every(line => line.text.split(' ').length <= 8));
  assert.deepEqual(captionLines('Short one.', 0, 1).map(line => line.text), ['Short one.']);
});
