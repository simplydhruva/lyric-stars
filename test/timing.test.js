import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSyllables, splitWords, buildTimeline, DEFAULTS } from '../web/js/timing.js';

// Words like "everything" (sung as 3 or 4) need the pronunciation dictionary in milestone 2.
test('countSyllables on common English words', () => {
  const cases = { look: 1, at: 1, the: 1, stars: 1, shine: 1, yellow: 2, beautiful: 3, little: 2, love: 1, you: 1, wishes: 2, makes: 1 };
  for (const [w, n] of Object.entries(cases)) assert.equal(countSyllables(w), n, w);
});

test('countSyllables handles punctuation, accents and CJK', () => {
  assert.equal(countSyllables("you're,"), 1);
  assert.equal(countSyllables('corazón'), 3);
  assert.equal(countSyllables('東京'), 2);
});

test('splitWords drops pure punctuation tokens', () => {
  assert.deepEqual(splitWords('Oh - yeah, (ooh)'), ['Oh', 'yeah,', '(ooh)']);
});

test('buildTimeline: first word at line start, words in order, within the line', () => {
  const tl = buildTimeline([{ time: 1000, text: 'Look at the stars' }, { time: 4000, text: 'next' }]);
  const w = tl[0].words;
  assert.equal(w[0].start, 1000);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start > w[i - 1].start);
  assert.ok(tl[0].end <= 4000 - DEFAULTS.breathMs);
});

test('buildTimeline: long gap does not stretch a short line', () => {
  const tl = buildTimeline([{ time: 0, text: 'hey you' }, { time: 20000, text: 'x' }]);
  assert.ok(tl[0].end < 2000, `ended at ${tl[0].end}`);
});

test('buildTimeline: syllables, not letters, set word length', () => {
  const tl = buildTimeline([{ time: 0, text: 'strengths beautiful' }, { time: 1600, text: 'x' }]);
  const [a, b] = tl[0].words;
  assert.ok(a.end - a.start < b.end - b.start);
});

test('buildTimeline: empty lines produce no words', () => {
  const tl = buildTimeline([{ time: 0, text: '' }, { time: 5000, text: 'x' }]);
  assert.equal(tl[0].words.length, 0);
});
