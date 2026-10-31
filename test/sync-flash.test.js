import test from 'node:test';
import assert from 'node:assert/strict';
import { FLASH_MS, flashProgress, flashing, drawFlash } from '../web/js/sync-flash.js';

test('flashProgress: none before any flash, runs 0..1, then ends', () => {
  assert.equal(flashProgress(1000, undefined), 0);
  assert.equal(flashProgress(999, 1000), 0); // a clock that went backwards
  assert.ok(flashProgress(1000, 1000) > 0);
  assert.ok(Math.abs(flashProgress(1000 + FLASH_MS / 2, 1000) - 0.5) < 1e-9);
  assert.equal(flashProgress(1000 + FLASH_MS, 1000), 0);
  assert.ok(flashing(1100, 1000) && !flashing(5000, 1000));
});

function fakeCtx() {
  const calls = [];
  const grad = { addColorStop: (...a) => calls.push(['stop', ...a]) };
  return {
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    createRadialGradient: (...a) => (calls.push(['grad', ...a]), grad),
    set fillStyle(v) { calls.push(['fill', v]); },
  };
}

test('drawFlash: draws nothing without a flash, a ring while it runs, a plain fade with reduce motion', () => {
  const none = fakeCtx();
  drawFlash(none, 800, 600, 5000, { at: 1000, dir: 1 }, [255, 200, 100], false);
  drawFlash(none, 800, 600, 5000, null, [255, 200, 100], false);
  assert.equal(none.calls.length, 0);
  const ring = fakeCtx();
  drawFlash(ring, 800, 600, 1200, { at: 1000, dir: 1 }, [255, 200, 100], false);
  assert.ok(ring.calls.some((c) => c[0] === 'grad'));
  const calm = fakeCtx();
  drawFlash(calm, 800, 600, 1200, { at: 1000, dir: 1 }, [255, 200, 100], true);
  assert.ok(!calm.calls.some((c) => c[0] === 'grad') && calm.calls.some((c) => c[0] === 'fillRect'));
});

test('drawFlash: later rings shrink, earlier rings grow', () => {
  const radiusAt = (dir, now) => {
    const c = fakeCtx();
    drawFlash(c, 800, 600, now, { at: 1000, dir }, [255, 200, 100], false);
    return c.calls.find((x) => x[0] === 'grad')[6];
  };
  assert.ok(radiusAt(1, 1500) > radiusAt(1, 1100));
  assert.ok(radiusAt(-1, 1500) < radiusAt(-1, 1100));
});
