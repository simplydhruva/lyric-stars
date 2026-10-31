import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock } from '../web/js/sources/clock.js';

function setup() {
  let t = 0;
  const clock = new PlaybackClock({ clock: () => t });
  return { clock, advance: (ms) => (t += ms), now: () => t };
}

test('extrapolates while playing, holds while paused', () => {
  const { clock, advance } = setup();
  clock.update({ positionMs: 10_000, at: 0, isPlaying: true, trackKey: 'a' });
  advance(1500);
  assert.equal(clock.position(), 11_500);
  clock.update({ positionMs: 11_500, at: 1500, isPlaying: false, trackKey: 'a' });
  advance(5000);
  assert.equal(clock.position(), 11_500);
});

test('accounts for sample age', () => {
  const { clock, advance } = setup();
  advance(1000);
  clock.update({ positionMs: 5000, at: 800, isPlaying: true, trackKey: 'a' });
  assert.equal(clock.position(), 5200);
});

test('small drift is smoothed, not jumped', () => {
  const { clock, advance } = setup();
  clock.update({ positionMs: 0, at: 0, isPlaying: true, trackKey: 'a' });
  advance(2000);
  clock.update({ positionMs: 2150, at: 2000, isPlaying: true, trackKey: 'a' }); // 150 ms ahead
  assert.equal(clock.position(), 2000); // no visible jump
  advance(500);
  const mid = clock.position();
  assert.ok(mid > 2500 && mid < 2650, String(mid));
  advance(1000);
  assert.equal(clock.position(), 3650); // fully converged
  assert.equal(clock.stats.resyncs, 0);
});

test('drift over 300 ms snaps immediately (seek)', () => {
  const { clock, advance } = setup();
  clock.update({ positionMs: 0, at: 0, isPlaying: true, trackKey: 'a' });
  advance(2000);
  const r = clock.update({ positionMs: 60_000, at: 2000, isPlaying: true, trackKey: 'a' });
  assert.ok(r.snapped);
  assert.equal(clock.position(), 60_000);
  assert.equal(clock.stats.resyncs, 1);
});

test('track change snaps even with small difference', () => {
  const { clock, advance } = setup();
  clock.update({ positionMs: 0, at: 0, isPlaying: true, trackKey: 'a' });
  advance(1000);
  clock.update({ positionMs: 1100, at: 1000, isPlaying: true, trackKey: 'b' });
  assert.equal(clock.position(), 1100);
});
