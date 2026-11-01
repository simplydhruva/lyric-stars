import test from 'node:test';
import assert from 'node:assert/strict';
import { penState } from '../web/js/scenes/motion.js';

const W = 300;
const F = 40;

test('the pen is on screen on the very frame a word starts', () => {
  const p = penState(0, W, F);
  assert.equal(p.tracing, true);
  assert.ok(p.traceW > 0, 'outline already shows');
  assert.equal(p.fillW, 0);
});

test('the pen leads: the outline is always ahead of the ink while writing', () => {
  for (let f = 0; f < 0.99; f += 0.05) {
    const p = penState(f, W, F);
    assert.ok(p.traceW >= p.fillW, `at ${f}`);
    assert.ok(p.traceW <= W && p.fillW >= 0);
  }
});

test('both only move forward as the word is written', () => {
  let a = penState(0, W, F);
  for (let f = 0.02; f <= 1; f += 0.02) {
    const b = penState(f, W, F);
    assert.ok(b.fillW >= a.fillW - 1e-9 && b.traceW >= a.traceW - 1e-9 && b.dash >= a.dash - 1e-9, `at ${f}`);
    a = b;
  }
});

test('a finished word is all ink with no outline', () => {
  const p = penState(1, W, F);
  assert.deepEqual(p, { fillW: W, traceW: W, dash: 0, tracing: false });
});

test('reduce motion: all ink at once, never an outline', () => {
  for (const f of [0, 0.3, 0.9]) assert.deepEqual(penState(f, W, F, true), { fillW: W, traceW: W, dash: 0, tracing: false });
});
