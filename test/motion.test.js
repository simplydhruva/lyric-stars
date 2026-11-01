import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, hash, written, fallDuration, fallProgress, landBounce, lanternRise, lanternAlpha, neonFlicker,
  typedChars, cursorOn, lineEnergy, orbitSpot, slideIn, slideOut, inkAlpha, shownAt,
} from '../web/js/scenes/motion.js';

const line = { time: 1000, end: 3000, words: [{ text: 'a', start: 1000, end: 1500 }, { text: 'bb', start: 1500, end: 2500 }] };

test('hash is stable and in [0, 1)', () => {
  assert.equal(hash(3, 4), hash(3, 4));
  for (let i = 0; i < 200; i++) assert.ok(hash(i, 7) >= 0 && hash(i, 7) < 1);
  assert.notEqual(hash(1, 2), hash(2, 1));
});

test('written: nothing before the start, a pen sweep during the word, all of it after', () => {
  const w = line.words[0];
  assert.equal(written(w, 999, false, 'word', line), 0);
  assert.equal(written(w, 1250, false, 'word', line), 0.5);
  assert.equal(written(w, 1600, false, 'word', line), 1);
  assert.equal(written(w, 1001, true, 'word', line), 1); // reduce motion: whole word at its start
  assert.equal(written(line.words[1], 1000, false, 'line', line), 1); // line mode: the line at once
  assert.equal(shownAt(line.words[1], line, 'line'), 1000);
});

test('the pen word shows something from the first instant of the word', () => {
  assert.ok(written(line.words[0], 1001, false, 'word', line) > 0);
});

test('rain: a word has not fallen at its start and has landed after its duration', () => {
  assert.equal(fallProgress(0, 1000, false), 0);
  assert.equal(fallProgress(1000, 1000, false), 1);
  assert.equal(fallProgress(5, 1000, true), 1);
  const d = fallDuration(2, 3);
  assert.ok(d >= 900 && d <= 1500);
  assert.equal(landBounce(-1), 0);
  assert.equal(landBounce(300), 0);
  assert.ok(landBounce(60) < 0);
});

test('lanterns rise over their life and burn out at the top', () => {
  assert.equal(lanternRise(0), 0);
  assert.equal(lanternRise(1e9), 1);
  assert.equal(lanternAlpha(0), 1);
  assert.equal(lanternAlpha(1e9), 0);
});

test('neon is lit at the very start and steady after the flicker', () => {
  for (let seed = 0; seed < 50; seed++) {
    assert.equal(neonFlicker(0, seed, false), 1);
    assert.equal(neonFlicker(500, seed, false), 1);
    assert.equal(neonFlicker(100, seed, true), 1);
  }
});

test('typewriter: at least one character at the start, all by the end, all at once with reduce motion', () => {
  assert.equal(typedChars(5, 1000, 2000, 999, false), 0);
  assert.equal(typedChars(5, 1000, 2000, 1000, false), 1);
  assert.equal(typedChars(5, 1000, 2000, 5000, false), 5);
  assert.equal(typedChars(5, 1000, 2000, 1001, true), 5);
  assert.equal(typedChars(5, 1000, 2000, 1001, false, true), 5);
  assert.ok(cursorOn(0, 123456));
  assert.equal(cursorOn(1000, 0), true);
  assert.equal(cursorOn(1000, 520), false);
});

test('ribbon energy: faster and chorus lines are livelier, always 0..1', () => {
  const slow = { words: [{ start: 0, end: 4000 }, { start: 4000, end: 8000 }] };
  const fast = { words: Array.from({ length: 12 }, (_, i) => ({ start: i * 200, end: i * 200 + 200 })) };
  assert.ok(lineEnergy(fast, false) > lineEnergy(slow, false));
  assert.ok(lineEnergy(slow, true) > lineEnergy(slow, false));
  assert.equal(lineEnergy({ words: [] }, true), 0);
  assert.equal(clamp(lineEnergy(fast, true), 0, 1), lineEnergy(fast, true));
});

test('orbit: the ring is a circle', () => {
  const front = orbitSpot(2, 2, 6);
  assert.ok(Math.abs(front.x) < 1e-9 && front.depth === 1);
  const back = orbitSpot(5, 2, 6);
  assert.ok(back.depth < 1e-9);
});

test('slide and ink fades', () => {
  assert.equal(slideIn(0, false), 1);
  assert.equal(slideIn(10000, false), 0);
  assert.equal(slideIn(0, true), 0);
  assert.equal(slideOut(0, false), 0);
  assert.equal(slideOut(10000, false), 1);
  assert.equal(inkAlpha(0), 1);
  assert.ok(inkAlpha(10000) < 1 && inkAlpha(10000) > 0.4);
});
