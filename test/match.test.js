import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, titlesMatch, artistsMatch, durationOk, pickBest } from '../web/js/lyrics/match.js';
import { fetchLyrics } from '../web/js/lyrics/lrclib.js';

test('normalizeTitle removes remaster and feat noise, keeps real versions', () => {
  assert.equal(normalizeTitle('Here Comes the Sun - Remastered 2009'), 'here comes the sun');
  assert.equal(normalizeTitle('Bohemian Rhapsody - 2011 Remaster'), 'bohemian rhapsody');
  assert.equal(normalizeTitle('Stay (feat. Justin Bieber)'), 'stay');
  assert.equal(normalizeTitle('Song (Remastered)'), 'song');
  assert.equal(normalizeTitle('Song - Acoustic'), 'song acoustic');
  assert.equal(normalizeTitle('Song - Remix'), 'song remix');
});

test('titlesMatch is strict about different songs', () => {
  assert.ok(titlesMatch('Yellow', 'Yellow'));
  assert.ok(titlesMatch('Don’t Stop Me Now - Remastered 2011', "Don't Stop Me Now"));
  assert.ok(!titlesMatch('Love', 'Love Story'));
  assert.ok(!titlesMatch('Yellow', 'Mellow Yellow Submarine Song'));
});

test('artistsMatch handles multiple and joined artists', () => {
  assert.ok(artistsMatch(['The Kid LAROI', 'Justin Bieber'], 'The Kid LAROI & Justin Bieber'));
  assert.ok(artistsMatch(['Beyoncé'], 'Beyonce'));
  assert.ok(!artistsMatch(['Coldplay'], 'Taylor Swift'));
});

test('durationOk enforces the tolerance', () => {
  assert.ok(durationOk(268_000, 270));
  assert.ok(!durationOk(268_000, 272));
  assert.ok(!durationOk(268_000, null));
});

const track = { title: 'Yellow', artists: ['Coldplay'], album: 'Parachutes', durationMs: 266_773 };
const rec = (o) => ({ id: 1, trackName: 'Yellow', artistName: 'Coldplay', albumName: 'Parachutes', duration: 267, syncedLyrics: '[00:01.00]x', ...o });

test('pickBest rejects wrong durations and prefers synced, closer matches', () => {
  assert.equal(pickBest([rec({ duration: 300 })], track), null);
  const best = pickBest([rec({ id: 1, syncedLyrics: null }), rec({ id: 2 }), rec({ id: 3, duration: 269 })], track);
  assert.equal(best.id, 2);
  assert.equal(pickBest([rec({ id: 2 })], track, { rejectIds: [2] }), null);
  assert.equal(pickBest([rec({ artistName: 'Someone Else' })], track), null);
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const body = routes[u.pathname]?.(u.searchParams);
    if (body instanceof Error) throw body;
    if (body === undefined) return { status: 404, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('fetchLyrics uses exact match when duration agrees', async () => {
  const f = fakeFetch({ '/api/get': () => rec({}) });
  const r = await fetchLyrics(track, { fetchImpl: f });
  assert.equal(r.status, 'synced');
  assert.equal(f.calls.length, 1);
});

test('fetchLyrics never accepts a wrong-duration exact match, falls back to search', async () => {
  const f = fakeFetch({
    '/api/get': () => rec({ id: 9, duration: 320 }),
    '/api/search': () => [rec({ id: 5, duration: 266 }), rec({ id: 6, artistName: 'Cover Band' })],
  });
  const r = await fetchLyrics(track, { fetchImpl: f });
  assert.equal(r.status, 'synced');
  assert.equal(r.record.id, 5);
});

test('fetchLyrics returns notfound rather than a near miss', async () => {
  const f = fakeFetch({ '/api/search': () => [rec({ duration: 290 }), rec({ trackName: 'Yellow Submarine' })] });
  assert.equal((await fetchLyrics(track, { fetchImpl: f })).status, 'notfound');
});

test('fetchLyrics reports plain and instrumental results', async () => {
  let f = fakeFetch({ '/api/get': () => rec({ syncedLyrics: null, plainLyrics: 'words' }) });
  assert.equal((await fetchLyrics(track, { fetchImpl: f })).status, 'plain');
  f = fakeFetch({ '/api/get': () => rec({ syncedLyrics: null, instrumental: true }) });
  assert.equal((await fetchLyrics(track, { fetchImpl: f })).status, 'instrumental');
});

test('fetchLyrics falls back to search when exact lookup errors', async () => {
  const f = fakeFetch({ '/api/search': () => [rec({ id: 7 })] });
  const flaky = async (url) => (url.includes('/api/get') ? { status: 503, ok: false } : f(url));
  const r = await fetchLyrics(track, { fetchImpl: flaky });
  assert.equal(r.record.id, 7);
});

test('fetchLyrics surfaces offline and service errors', async () => {
  await assert.rejects(fetchLyrics(track, { fetchImpl: async () => { throw new TypeError('net'); } }), { kind: 'offline' });
  await assert.rejects(fetchLyrics(track, { fetchImpl: async () => ({ status: 503, ok: false }) }), { kind: 'service-down' });
});
