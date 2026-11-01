import test from 'node:test';
import assert from 'node:assert/strict';
import { emojiOf, emojisForLine, MAX_PER_LINE } from '../web/js/scenes/emoji.js';

test('words map to emojis, case-insensitively and by simple stem', () => {
  assert.equal(emojiOf('love'), '❤️');
  assert.equal(emojiOf('LOVE,'), '❤️');
  assert.equal(emojiOf('Burning'), '🔥');
  assert.equal(emojiOf('tears'), '😢');
  assert.equal(emojiOf('dancing'), '💃');
  assert.equal(emojiOf('kissed'), '💋');
  assert.equal(emojiOf('moon'), '🌙');
  assert.equal(emojiOf('rain'), '🌧️');
  assert.equal(emojiOf('the'), null);
  assert.equal(emojiOf('Märchen'), null);
});

test('at most two emojis per line, the first matches, and the result never depends on timing', () => {
  const words = ['love', 'fire', 'night', 'moon', 'the'].map((text, i) => ({ text, start: i * 100, end: i * 100 + 90 }));
  const e = emojisForLine(words);
  assert.equal(e.filter(Boolean).length, MAX_PER_LINE);
  assert.deepEqual(e, ['❤️', '🔥', null, null, null]);
  assert.deepEqual(emojisForLine(words), e);
});
