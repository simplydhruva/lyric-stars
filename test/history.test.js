import test from 'node:test';
import assert from 'node:assert/strict';
import { History, ago, MAX_ENTRIES } from '../web/js/history.js';
import { fileName } from '../web/js/export.js';

const memStore = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), m }; };

test('history records newest first, counts repeat plays, keeps the picture', async () => {
  let t = 1000;
  const h = new History(memStore(), () => t++);
  await h.record({ key: 'a', title: 'A', artist: 'X' });
  await h.setThumb('a', 'data:thumb');
  await h.record({ key: 'b', title: 'B' });
  await h.record({ key: 'a', title: 'A', artist: 'X' });
  assert.deepEqual(h.entries.map((e) => e.key), ['a', 'b']);
  assert.equal(h.entries[0].plays, 2);
  assert.equal(h.entries[0].thumb, 'data:thumb');
  assert.equal(await h.record({}), null);
});

test('history survives a reload, is capped, and clears', async () => {
  const s = memStore();
  const h = new History(s);
  for (let i = 0; i < MAX_ENTRIES + 5; i++) await h.record({ key: 'k' + i, title: 't' });
  assert.equal(h.entries.length, MAX_ENTRIES);
  const h2 = new History(s);
  await h2.load();
  assert.equal(h2.entries.length, MAX_ENTRIES);
  await h2.clear();
  assert.equal((await new History(s).load(), s.m.get('history').entries.length), 0);
});

test('history ignores a damaged store', async () => {
  const h = new History({ get: async () => ({ entries: 'oops' }), put: async () => {} });
  await h.load();
  assert.deepEqual(h.entries, []);
});

test('ago and file names', () => {
  const now = 10 * 86400000;
  assert.equal(ago(now - 5000, now), 'just now');
  assert.equal(ago(now - 5 * 60000, now), '5 min ago');
  assert.equal(ago(now - 3 * 3600000, now), '3 h ago');
  assert.equal(ago(now - 30 * 3600000, now), 'yesterday');
  assert.equal(fileName({ title: 'A/B: C?', artist: 'D' }, 'png', new Date('2026-01-02T03:04:05Z')), 'A B C - D 20260102-030405.png');
  assert.match(fileName(null, 'webm'), /^Lyric Stars \d{8}-\d{6}\.webm$/);
});
