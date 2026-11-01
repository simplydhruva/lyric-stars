import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookUpWithRetries, settle, RETRY_DELAYS_MS, SETTLE_MS, DURATION_WAIT_MS } from '../web/js/lyrics/lookup.js';
import { LyricsError } from '../web/js/lyrics/lrclib.js';

const FOUND = { status: 'synced', lines: [] };
const NONE = { status: 'notfound' };
const clock = () => {
  const waits = [];
  return { waits, wait: async (ms) => void waits.push(ms) };
};
const scripted = (...answers) => {
  let n = 0;
  return { calls: () => n, attempt: async () => { const a = answers[Math.min(n++, answers.length - 1)]; if (a instanceof Error) throw a; return a; } };
};
const down = () => new LyricsError('service-down', 'down');

test('fails once, then found: the second try wins after 2 s, and the page was told it is still searching', async () => {
  const c = clock(), s = scripted(down(), FOUND), told = [];
  const r = await lookUpWithRetries(s.attempt, { isCurrent: () => true, wait: c.wait, onRetry: (n) => told.push(n) });
  assert.equal(r.result, FOUND);
  assert.deepEqual(c.waits, [2000]);
  assert.deepEqual(told, [1]);
});

test('fails twice, then found on the third try (waits 2 s, then 5 s)', async () => {
  const c = clock(), s = scripted(down(), NONE, FOUND);
  const r = await lookUpWithRetries(s.attempt, { isCurrent: () => true, wait: c.wait });
  assert.equal(r.result, FOUND);
  assert.deepEqual(c.waits, RETRY_DELAYS_MS);
  assert.equal(s.calls(), 3);
});

test('"not found" is only reported after all three tries', async () => {
  const c = clock(), s = scripted(NONE);
  const r = await lookUpWithRetries(s.attempt, { isCurrent: () => true, wait: c.wait });
  assert.equal(r.result.status, 'notfound');
  assert.equal(s.calls(), 3);
});

test('a failure on every try ends as an error, never as a result to save', async () => {
  const s = scripted(down());
  const r = await lookUpWithRetries(s.attempt, { isCurrent: () => true, wait: clock().wait });
  assert.ok(r.error instanceof LyricsError);
  assert.equal(r.result, undefined);
});

test('offline is not retried', async () => {
  const s = scripted(new LyricsError('offline', 'off'));
  const r = await lookUpWithRetries(s.attempt, { isCurrent: () => true, wait: clock().wait });
  assert.equal(r.error.kind, 'offline');
  assert.equal(s.calls(), 1);
});

test('an answer for a song that has been replaced is ignored (slow response, and during a wait)', async () => {
  let current = true;
  const slow = async () => { current = false; return FOUND; }; // the song changes while the request is out
  assert.equal(await lookUpWithRetries(slow, { isCurrent: () => current, wait: clock().wait }), null);
  current = true;
  const s = scripted(NONE, FOUND);
  const r = await lookUpWithRetries(s.attempt, { isCurrent: () => current, wait: async () => { current = false; } });
  assert.equal(r, null);
  assert.equal(s.calls(), 1);
});

test('without a known song length a "not found" is marked unsure so it is never saved', async () => {
  const r = await lookUpWithRetries(scripted(NONE).attempt, { isCurrent: () => true, wait: clock().wait, unsure: true });
  assert.equal(r.result.partial, true);
});

test('settle waits for the details to hold still, and longer for a song with no length', async () => {
  const c = clock();
  assert.equal(await settle({ durationMs: 200000 }, { isCurrent: () => true, wait: c.wait }), true);
  assert.deepEqual(c.waits, [SETTLE_MS]);
  const d = clock();
  assert.equal(await settle({ durationMs: 0 }, { isCurrent: () => true, wait: d.wait }), true);
  assert.deepEqual(d.waits, [SETTLE_MS, DURATION_WAIT_MS]);
  assert.equal(await settle({ durationMs: 1 }, { isCurrent: () => false, wait: clock().wait }), false);
});
