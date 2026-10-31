import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sync from '../web/js/sync.js';

test('song offsets are saved per track and cleared at zero', () => {
  assert.equal(sync.songOffset('sp:a'), 0);
  sync.setSongOffset('sp:a', 150);
  sync.setSongOffset('sp:b', -40);
  assert.equal(sync.songOffset('sp:a'), 150);
  assert.equal(sync.songOffset('sp:b'), -40);
  sync.setSongOffset('sp:a', 0);
  assert.equal(sync.songOffset('sp:a'), 0);
  assert.equal(sync.setSongOffset('sp:c', 99_999), sync.OFFSET_LIMIT_MS);
});

test('global offset persists', () => {
  sync.setGlobalOffset(-200);
  assert.equal(sync.globalOffset(), -200);
});

test('display latency follows the refresh interval', () => {
  const d = new sync.DisplayLatency();
  for (let i = 0; i <= 60; i++) d.tick(i * (1000 / 120));
  assert.ok(Math.abs(d.ms - 12.5) < 0.1, `got ${d.ms}`);
  d.tick(60 * (1000 / 120) + 5000); // a stall is ignored
  assert.ok(Math.abs(d.ms - 12.5) < 0.1);
});

test('frameStride: about 60 paints a second at even spacing', async () => {
  const { frameStride } = await import('../web/js/sync.js');
  const s = (hz) => frameStride(1000 / hz);
  assert.deepEqual([s(59.94), s(60), s(75), s(100), s(119.9), s(144), s(165), s(240)], [1, 1, 1, 1, 2, 2, 3, 4]);
});
