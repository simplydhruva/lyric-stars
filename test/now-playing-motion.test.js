import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverMotion, ringPhase, ringStyle, makeStars, starAt, sceneColors, hashString } from '../web/js/now-playing-motion.js';
import { THEMES, forNightSky } from '../web/js/theme.js';

test('the cover breathes between 1.00 and 1.03 and never leaves that range', () => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < 30; t += 0.05) {
    const { scale } = coverMotion(t, false);
    lo = Math.min(lo, scale);
    hi = Math.max(hi, scale);
  }
  assert.ok(lo >= 1 && lo < 1.002, `low ${lo}`);
  assert.ok(hi <= 1.03 && hi > 1.028, `high ${hi}`);
});

test('reduced motion holds the cover at rest', () => {
  for (const t of [0, 1.7, 99]) assert.deepEqual(coverMotion(t, true), { dy: 0, scale: 1 });
});

test('ring phase follows the song position and wraps each period', () => {
  assert.equal(ringPhase(0), 0);
  assert.equal(ringPhase(500), 0.25);
  assert.equal(ringPhase(2500), 0.25);
  assert.equal(ringPhase(-500), 0.75);
});

test('the ring swells and fades over a pulse, and sits still when asked', () => {
  const a = ringStyle(0.05, false);
  const b = ringStyle(0.9, false);
  assert.ok(b.scale > a.scale);
  assert.ok(b.opacity < a.opacity);
  assert.deepEqual(ringStyle(0.4, true), ringStyle(0.9, true));
});

test('stars are the same for the same seed and keep clear of the cover', () => {
  assert.deepEqual(makeStars(hashString('a'), 10), makeStars(hashString('a'), 10));
  assert.notDeepEqual(makeStars(hashString('a'), 10), makeStars(hashString('b'), 10));
  for (const s of makeStars(7, 40)) {
    for (let t = 0; t < 60; t += 3) {
      const { x, y } = starAt(s, t, false);
      assert.ok(Math.hypot(x, y) >= 0.6, 'star drifted onto the cover');
    }
  }
});

test('stars drift and twinkle, but stay put when still', () => {
  const [s] = makeStars(3, 1);
  assert.notDeepEqual(starAt(s, 0, false), starAt(s, 20, false));
  assert.deepEqual(starAt(s, 0, true), starAt(s, 20, true));
  for (let t = 0; t < 30; t += 0.5) {
    const { glow } = starAt(s, t, false);
    assert.ok(glow >= 0.45 && glow <= 1);
  }
});

test('scene colours come from the cover, lifted for the night sky', () => {
  const colors = sceneColors([[200, 30, 30], [30, 30, 200]]);
  assert.equal(colors.length, 3);
  assert.deepEqual(colors[0], forNightSky([200, 30, 30]));
  assert.deepEqual(colors[2], colors[1]);
});

test('scene colours fall back to gold when there is no palette', () => {
  const gold = forNightSky(THEMES.gold.base);
  for (const none of [[], null, undefined]) assert.deepEqual(sceneColors(none), [gold, gold, gold]);
});
