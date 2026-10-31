import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerControl, HOLD_MS } from '../web/js/player-control.js';

function setup({ fail, isPlaying = true, positionMs = 30_000, available = true } = {}) {
  let t = 1000;
  const log = { applied: [], sent: [], errors: [], refreshes: 0, timers: [] };
  const state = { available, trackKey: 'sp:1', durationMs: 200_000, isPlaying, positionMs };
  const sender = new Proxy({}, {
    get: (_, name) => async (...args) => {
      log.sent.push([name, ...args]);
      if (fail) throw fail;
    },
  });
  const ctl = new PlayerControl({
    sender,
    state: () => state,
    apply: (s) => log.applied.push(s),
    refresh: () => log.refreshes++,
    onError: (e) => log.errors.push(e),
    now: () => t,
    later: (fn, ms) => log.timers.push([fn, ms]),
  });
  return { ctl, log, state, advance: (ms) => (t += ms) };
}

const sample = (over = {}) => ({ kind: 'track', track: { key: 'sp:1' }, positionMs: 0, at: 1000, isPlaying: true, ...over });

test('pressing pause shows paused at once, sends the command, and asks for the real state after', async () => {
  const { ctl, log } = setup();
  await ctl.playPause();
  assert.deepEqual(log.applied, [{ isPlaying: false, positionMs: 30_000 }]);
  assert.deepEqual(log.sent, [['pause']]);
  assert.equal(log.timers.length, 1);
  log.timers[0][0]();
  assert.equal(log.refreshes, 1);
});

test('play/pause sends play when paused', async () => {
  const { ctl, log } = setup({ isPlaying: false });
  await ctl.playPause();
  assert.deepEqual(log.sent, [['play']]);
  assert.equal(log.applied[0].isPlaying, true);
});

test('next and previous restart from the top and play', async () => {
  const { ctl, log } = setup({ isPlaying: false });
  await ctl.next();
  await ctl.previous();
  assert.deepEqual(log.sent, [['next'], ['previous']]);
  assert.deepEqual(log.applied[0], { isPlaying: true, positionMs: 0 });
});

test('seek is clamped inside the song', async () => {
  const { ctl, log } = setup();
  await ctl.seek(-5);
  await ctl.seek(999_999);
  assert.deepEqual(log.sent, [['seek', 0], ['seek', 199_500]]);
});

test('a refused command is undone and reported', async () => {
  const err = new Error('Premium only');
  const { ctl, log, advance } = setup({ fail: err });
  const p = ctl.playPause();
  advance(300);
  await p;
  assert.deepEqual(log.errors, [err]);
  assert.equal(log.applied.at(-1).isPlaying, true); // back to playing
  assert.ok(Math.abs(log.applied.at(-1).positionMs - 30_300) < 1);
  assert.equal(log.timers.length, 0);
  assert.equal(ctl.holding(sample({ isPlaying: false })), false);
});

test('nothing happens when the controls are not available', async () => {
  const { ctl, log } = setup({ available: false });
  await ctl.playPause();
  await ctl.next();
  await ctl.seek(1000);
  assert.deepEqual(log.sent, []);
  assert.deepEqual(log.applied, []);
});

test('a poll that still shows the old state is held back; one that agrees is let through', async () => {
  const { ctl, advance } = setup();
  await ctl.playPause();
  advance(400);
  assert.equal(ctl.holding(sample({ isPlaying: true, positionMs: 30_400 })), true, 'stale: still playing');
  advance(300);
  assert.equal(ctl.holding(sample({ isPlaying: false, positionMs: 30_000 })), false, 'confirmed');
  assert.equal(ctl.holding(sample({ isPlaying: true })), false, 'no longer holding');
});

test('a seek holds polls that report the old position', async () => {
  const { ctl, advance } = setup();
  await ctl.seek(100_000);
  advance(500);
  assert.equal(ctl.holding(sample({ positionMs: 30_500 })), true);
  assert.equal(ctl.holding(sample({ positionMs: 100_500 })), false);
});

test('holding gives up after a while, and a different song clears it at once', async () => {
  const a = setup();
  await a.ctl.playPause();
  a.advance(HOLD_MS + 1);
  assert.equal(a.ctl.holding(sample({ isPlaying: true })), false);

  const b = setup();
  await b.ctl.next();
  assert.equal(b.ctl.holding(sample({ track: { key: 'sp:2' }, positionMs: 0 })), false);
  assert.equal(b.ctl.holding(sample({ positionMs: 90_000 })), false, 'hold is gone');
});

test('after next, a stale poll of the old song is held', async () => {
  const { ctl, advance } = setup();
  await ctl.next();
  advance(300);
  assert.equal(ctl.holding(sample({ positionMs: 30_300 })), true);
});
