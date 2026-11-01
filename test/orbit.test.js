import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_MS, followStep, orbitTarget } from '../web/js/scenes/orbit.js';

const words = Array.from({ length: 12 }, (_, i) => ({ start: i * 250, end: i * 250 + 240 }));

test('the ring aims at the word being sung', () => {
  assert.equal(orbitTarget(words, -100, 'word'), 0);
  assert.equal(orbitTarget(words, 0, 'word'), 0);
  assert.equal(orbitTarget(words, 260, 'word'), 1);
  assert.equal(orbitTarget(words, 99999, 'word'), 11);
  assert.equal(orbitTarget(words, 900, 'line'), 0);
});

test('following does not depend on the frame rate', () => {
  let a = 0;
  for (let i = 0; i < 60; i++) a = followStep(a, 1, 1000 / 60);
  let b = 0;
  for (let i = 0; i < 120; i++) b = followStep(b, 1, 1000 / 120);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.ok(followStep(0, 1, FOLLOW_MS) > 0.6 && followStep(0, 1, FOLLOW_MS) < 0.65);
  assert.equal(followStep(0.3, 1, 0), 0.3);
});

test('fast words (250 ms each) make the ring chase smoothly: it never turns back and never jumps more than half a word per frame', () => {
  let c = 0;
  let maxStep = 0;
  for (let t = 0; t < 3200; t += 1000 / 60) {
    const next = followStep(c, orbitTarget(words, t, 'word'), 1000 / 60);
    assert.ok(next >= c - 1e-12, 'the ring turned backwards');
    maxStep = Math.max(maxStep, next - c);
    c = next;
  }
  assert.ok(maxStep < 0.3, `biggest step ${maxStep}`);
});
