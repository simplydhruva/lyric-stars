import test from 'node:test';
import assert from 'node:assert/strict';
import { wordScores, wordScales, loudestIndex, layoutKinetic, wordEntrance, exitAlpha, tilt, revealedEnd, CHORUS_BOOST, ENTER_MS, EXIT_MS } from '../web/js/scenes/kinetic-layout.js';
import { MIN_FONT_SCALE } from '../web/js/scenes/karaoke-layout.js';

const w = (text, start = 0, end = 0) => ({ text, start, end });
const line = (...texts) => ({ words: texts.map((t) => w(t)) });
const measure = (text, font) => text.length * font;

test('longer and longer-held words score higher; short words score low', () => {
  const words = [w('I', 0, 200), w('remember', 200, 1400), w('you', 1400, 1600)];
  const s = wordScores(words);
  assert.ok(s[1] > s[0] && s[1] > s[2]);
  for (const v of s) assert.ok(v >= 0 && v <= 1);
});

test('without timing, length alone decides', () => {
  const s = wordScores([w('a'), w('stars')]);
  assert.ok(s[1] > s[0]);
  assert.deepEqual(wordScores([]), []);
});

test('the loudest word is the biggest of its line', () => {
  const words = [w('I', 0, 200), w('remember', 200, 1400), w('you', 1400, 1600)];
  const sc = wordScales(words);
  assert.equal(loudestIndex(words), 1);
  assert.equal(sc[1], Math.max(...sc));
  assert.equal(loudestIndex([]), -1);
});

test('a chorus line is bigger than the same line elsewhere, every word by the same factor', () => {
  const words = [w('hold', 0, 800), w('me', 800, 1000)];
  const plain = wordScales(words, false);
  const chorus = wordScales(words, true);
  chorus.forEach((v, i) => assert.ok(Math.abs(v - plain[i] * CHORUS_BOOST) < 1e-9));
});

test('layout keeps short lines on one centred row at full size', () => {
  const f = layoutKinetic(['hello', 'world'], [1, 1], measure, { maxW: 1000, baseFont: 20 });
  assert.equal(f.font, 20);
  assert.equal(f.rows.length, 1);
  assert.equal(f.offsets[0], 0);
  assert.ok(f.offsets[1] > f.widths[0]);
});

test('layout sizes each word by its own scale', () => {
  const f = layoutKinetic(['big', 'big'], [1, 2], measure, { maxW: 1000, baseFont: 20 });
  assert.equal(f.widths[0], 60);
  assert.equal(f.widths[1], 120);
});

test('a long line shrinks until it fits in four rows, never below the floor', () => {
  const texts = Array.from({ length: 16 }, () => 'word');
  const f = layoutKinetic(texts, texts.map(() => 1), measure, { maxW: 500, baseFont: 40 });
  assert.ok(f.rows.length <= 4);
  assert.ok(f.font < 40 && f.font >= 40 * MIN_FONT_SCALE);
  const many = Array.from({ length: 400 }, () => 'word');
  const g = layoutKinetic(many, many.map(() => 1), measure, { maxW: 300, baseFont: 40 });
  assert.equal(g.font, 40 * MIN_FONT_SCALE);
});

test('an empty line lays out to nothing', () => {
  const f = layoutKinetic([], [], measure, { maxW: 100, baseFont: 20 });
  assert.equal(f.height, 0);
  assert.deepEqual(f.rows, []);
});

test('a word is invisible before its start and fully visible the instant it starts', () => {
  assert.equal(wordEntrance(1000, 999, false).visible, false);
  const e = wordEntrance(1000, 1000, false);
  assert.equal(e.visible, true); // nothing delays it
  assert.ok(e.grow > 1 && e.drop > 0); // but it is still landing
});

test('a word settles to normal size and place after ENTER_MS', () => {
  const e = wordEntrance(1000, 1000 + ENTER_MS, false);
  assert.equal(e.grow, 1);
  assert.equal(e.drop, 0);
  assert.ok(wordEntrance(1000, 1000 + ENTER_MS / 2, false).grow > 1);
});

test('reduce motion: visible at the start, no movement', () => {
  assert.deepEqual(wordEntrance(1000, 1000, true), { visible: true, grow: 1, drop: 0 });
  assert.equal(wordEntrance(1000, 500, true).visible, false);
});

test('the old line fades out over EXIT_MS, and not at all with reduce motion', () => {
  assert.equal(exitAlpha(0, false), 1);
  assert.equal(exitAlpha(EXIT_MS, false), 0);
  assert.ok(Math.abs(exitAlpha(EXIT_MS / 2, false) - 0.5) < 1e-9);
  assert.equal(exitAlpha(0, true), 0);
  assert.equal(exitAlpha(NaN, false), 0);
});

test('tilt is steady and small', () => {
  assert.equal(tilt(3, 4), tilt(3, 4));
  for (let l = 0; l < 20; l++) for (let i = 0; i < 20; i++) assert.ok(Math.abs(tilt(l, i)) <= 0.04);
});

test('rows centre on the words showing, easing to each new word so nothing jumps', () => {
  const row = { from: 0, to: 3 };
  const offsets = [0, 60, 120];
  const widths = [50, 50, 50];
  const starts = [1000, 2000, 3000];
  assert.equal(revealedEnd(row, offsets, widths, starts, 999, false), null);
  assert.equal(revealedEnd(row, offsets, widths, starts, 1000, false), 50);
  assert.equal(revealedEnd(row, offsets, widths, starts, 2000, false), 50); // the new word starts where the last ended
  assert.equal(revealedEnd(row, offsets, widths, starts, 2000 + ENTER_MS, false), 110);
  assert.equal(revealedEnd(row, offsets, widths, starts, 3000 + ENTER_MS, false), 170);
  assert.equal(revealedEnd(row, offsets, widths, starts, 2000, true), 110); // reduce motion: no easing
});
