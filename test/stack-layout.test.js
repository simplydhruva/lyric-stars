import test from 'node:test';
import assert from 'node:assert/strict';
import { ABOVE, BELOW, OFFSETS, stackAlpha, stackScale, stackCentres, stackY, stackReach, stackFit } from '../web/js/scenes/stack-layout.js';

test('the stack shows two lines above and three below', () => {
  assert.equal(ABOVE, 2);
  assert.equal(BELOW, 3);
  for (let o = -ABOVE; o <= BELOW; o++) assert.ok(stackAlpha(o) > 0, `slot ${o} is visible`);
  // One more slot each side, only reached while the stack glides, is invisible once it settles.
  assert.equal(stackAlpha(-(ABOVE + 1)), 0);
  assert.equal(stackAlpha(BELOW + 1), 0);
});

test('alpha is full in the middle and falls away from it, continuously', () => {
  assert.equal(stackAlpha(0), 1);
  for (let o = 0; o < BELOW; o++) assert.ok(stackAlpha(o + 1) < stackAlpha(o));
  for (let o = 0; o > -ABOVE; o--) assert.ok(stackAlpha(o - 1) < stackAlpha(o));
  for (let s = -3.5; s < 4; s += 0.05) assert.ok(Math.abs(stackAlpha(s + 0.05) - stackAlpha(s)) < 0.1, `jump at ${s}`);
});

test('scale stays big: gentle shrink, same either side', () => {
  assert.equal(stackScale(0), 1);
  assert.ok(stackScale(1) > 0.85);
  assert.ok(stackScale(3) > 0.6);
  assert.equal(stackScale(-2), stackScale(2));
});

test('centres stack the lines in order without overlap', () => {
  const heights = OFFSETS.map(() => 50);
  const c = stackCentres(heights, 10);
  assert.equal(c[0], 0);
  assert.equal(c[1], 60);
  assert.equal(c[-1], -60);
  for (let o = -3; o < 3; o++) assert.ok(c[o + 1] - c[o] >= 60 - 1e-9, `slots ${o} and ${o + 1}`);
});

test('a missing line takes no room and adds no gap', () => {
  const heights = OFFSETS.map((o) => (o === -2 || o === -3 ? 0 : 40));
  const c = stackCentres(heights, 10);
  assert.equal(c[-3], c[-2]); // nothing there, so no gap is added above the last real line
  assert.equal(c[-1], -(20 + 10 + 20)); // the real lines are unaffected
});

test('stackY moves linearly between whole slots', () => {
  const c = stackCentres(OFFSETS.map(() => 40), 10);
  assert.equal(stackY(1, c), c[1]);
  assert.equal(stackY(0.5, c), c[1] / 2);
  assert.equal(stackY(-2.5, c), (c[-2] + c[-3]) / 2);
});

test('reach is how far the settled stack goes above and below the middle', () => {
  const heights = OFFSETS.map((o) => (o >= -ABOVE ? 40 : 0));
  const c = stackCentres(heights, 10);
  const r = stackReach(heights, 10);
  assert.equal(r.down, c[BELOW] + 20); // three below reach further than two above
  assert.equal(r.up, -c[-ABOVE] + 20);
  assert.ok(r.down > r.up);
  assert.deepEqual(stackReach(OFFSETS.map(() => 0), 10), { up: 0, down: 0 });
});

test('fit shrinks the stack until the lowest line clears the player bar, and never enlarges it', () => {
  const heights = OFFSETS.map((o) => (o >= -ABOVE ? 100 : 0));
  assert.equal(stackFit(heights, 20, 5000, 100), 1);
  for (const h of [300, 540, 720, 900]) {
    const f = stackFit(heights, 20, h, 100);
    const r = stackReach(heights.map((v) => v * f), 20 * f);
    assert.ok(f <= 1);
    assert.ok(h / 2 + r.down <= h - 100 + 1e-6, `h ${h}: bottom edge ${h / 2 + r.down}`);
    assert.ok(h / 2 - r.up >= 0, `h ${h}: top edge`);
  }
  assert.equal(stackFit(OFFSETS.map(() => 0), 10, 500, 60), 1);
});
