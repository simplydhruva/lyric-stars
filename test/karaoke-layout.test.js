import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapRows, fitLine, sweepFraction, slideProgress, slotAlpha, slotScale, slotOf, slotCentres, slotY, MIN_FONT_SCALE, LINE_HEIGHT } from '../web/js/scenes/karaoke-layout.js';

// 1 px per character per font px, so widths are easy to reason about.
const measure = (text, font) => text.length * font;

test('wrapRows fills rows greedily', () => {
  const rows = wrapRows([30, 30, 30, 30], 10, 70);
  assert.deepEqual(rows.map((r) => [r.from, r.to, r.width]), [[0, 2, 70], [2, 4, 70]]);
});

test('wrapRows gives a word wider than the row its own row', () => {
  const rows = wrapRows([10, 200, 10], 5, 100);
  assert.deepEqual(rows.map((r) => [r.from, r.to]), [[0, 1], [1, 2], [2, 3]]);
});

test('wrapRows of nothing is nothing', () => {
  assert.deepEqual(wrapRows([], 5, 100), []);
});

test('fitLine keeps the base font when the line fits', () => {
  const f = fitLine(['hello', 'world'], measure, { maxW: 1000, baseFont: 20 });
  assert.equal(f.font, 20);
  assert.equal(f.rows.length, 1);
  assert.equal(f.height, 20 * LINE_HEIGHT);
  assert.deepEqual(f.offsets, [0, 5 * 20 + 20]); // the word, then a space (1 char)
});

test('fitLine shrinks a long line to at most three rows', () => {
  const words = Array.from({ length: 12 }, () => 'word');
  const f = fitLine(words, measure, { maxW: 600, baseFont: 40 });
  assert.ok(f.rows.length <= 3, `rows: ${f.rows.length}`);
  assert.ok(f.font < 40);
  assert.ok(f.font >= 40 * MIN_FONT_SCALE);
});

test('fitLine stops shrinking at the floor, even if it still needs more rows', () => {
  const words = Array.from({ length: 500 }, () => 'word');
  const f = fitLine(words, measure, { maxW: 300, baseFont: 40 });
  assert.equal(f.font, 40 * MIN_FONT_SCALE);
  assert.ok(f.rows.length > 3);
});

test('fitLine of an empty line is empty', () => {
  const f = fitLine([], measure, { maxW: 100, baseFont: 20 });
  assert.equal(f.height, 0);
  assert.deepEqual(f.rows, []);
});

test('sweepFraction runs from start to end', () => {
  const w = { start: 1000, end: 2000 };
  assert.equal(sweepFraction(w, 500), 0);
  assert.equal(sweepFraction(w, 1000), 0);
  assert.equal(sweepFraction(w, 1250), 0.25);
  assert.equal(sweepFraction(w, 2000), 1);
  assert.equal(sweepFraction(w, 9000), 1);
});

test('sweepFraction with reduce motion lights the word at its start', () => {
  const w = { start: 1000, end: 2000 };
  assert.equal(sweepFraction(w, 999, true), 0);
  assert.equal(sweepFraction(w, 1001, true), 1);
});

test('sweepFraction with no usable duration lights the word at its start', () => {
  assert.equal(sweepFraction({ start: 1000, end: 1000 }, 1001), 1);
  assert.equal(sweepFraction({ start: 1000, end: undefined }, 1001), 1);
  assert.equal(sweepFraction({ start: 1000, end: 900 }, 1001), 1);
});

test('slideProgress eases from 0 to 1 and is 1 with no slide', () => {
  assert.equal(slideProgress(0, false), 0);
  assert.equal(slideProgress(10_000, false), 1);
  const mid = slideProgress(175, false);
  assert.ok(mid > 0.5 && mid < 1);
  assert.equal(slideProgress(0, true), 1);
  assert.equal(slideProgress(NaN, false), 1);
});

test('slots: full in the middle, faint beside it, gone two away', () => {
  assert.equal(slotAlpha(0), 1);
  assert.ok(Math.abs(slotAlpha(1) - 0.3) < 1e-9);
  assert.ok(Math.abs(slotAlpha(-1) - 0.3) < 1e-9);
  assert.equal(slotAlpha(2), 0);
  assert.equal(slotAlpha(-3), 0);
  assert.equal(slotScale(0), 1);
  assert.ok(slotScale(1) < 1);
  assert.equal(slotScale(1), slotScale(-5));
});

test('a settled stack puts lines on whole slots; a fresh line starts one slot down', () => {
  assert.equal(slotOf(-1, 1), -1);
  assert.equal(slotOf(0, 1), 0);
  assert.equal(slotOf(1, 1), 1);
  assert.equal(slotOf(0, 0), 1);
  assert.equal(slotOf(-1, 0), 0);
});

test('slotCentres stacks lines without overlap and slotY interpolates', () => {
  const c = slotCentres([20, 30, 100, 30], 10);
  assert.equal(c[0], 0);
  assert.equal(c[1], 50 + 10 + 15);
  assert.equal(c[-1], -(50 + 10 + 15));
  assert.ok(c[-2] < c[-1]);
  assert.equal(slotY(0, c), 0);
  assert.equal(slotY(0.5, c), c[1] / 2);
  assert.equal(slotY(-1, c), c[-1]);
});

test('missing lines take no room', () => {
  const c = slotCentres([0, 0, 0, 40], 10);
  assert.equal(c[1], 10 + 20);
});
