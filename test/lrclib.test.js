import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, cleanArtist, rejectReason } from '../web/js/lyrics/match.js';
import { fetchLyrics, lookupFor, LyricsError } from '../web/js/lyrics/lrclib.js';

const LRC = '[00:01.00]hello there\n[00:05.00]second line';
const rec = (o = {}) => ({ id: 1, trackName: 'Song', artistName: 'Band', albumName: 'Album', duration: 200, instrumental: false, plainLyrics: '', syncedLyrics: LRC, ...o });
const track = { title: 'Song', artists: ['Band'], artist: 'Band', album: 'Album', durationMs: 200_000 };
const quiet = () => {};

// A scripted service: each handler gets the URL's path and params and returns { status, body } (or throws).
function service(handler) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const params = Object.fromEntries(u.searchParams);
    const path = u.pathname.replace('/api/', '');
    calls.push({ path, params });
    const r = await handler(path, params);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { fetchImpl, calls };
}

test('cleanTitle drops release noise but keeps case, and real versions stay', () => {
  assert.equal(cleanTitle('Here Comes the Sun - Remastered 2009'), 'Here Comes the Sun');
  assert.equal(cleanTitle('Bohemian Rhapsody - 2011 Remaster'), 'Bohemian Rhapsody');
  assert.equal(cleanTitle('Stay (feat. Justin Bieber)'), 'Stay');
  assert.equal(cleanTitle('Stay - feat. Justin Bieber'), 'Stay');
  assert.equal(cleanTitle('Levitating - Radio Edit'), 'Levitating');
  assert.equal(cleanTitle('Levitating (Radio Edit)'), 'Levitating');
  assert.equal(cleanTitle('Song (feat. A) - Remastered 2011 - Mono'), 'Song');
  assert.equal(cleanTitle('Song - Acoustic'), 'Song - Acoustic');
  assert.equal(cleanTitle('Song - Remix'), 'Song - Remix');
  assert.equal(cleanTitle('(feat. Only)'), '(feat. Only)'); // never ends up empty
});

test('cleanArtist uses the first artist and leaves joined names whole', () => {
  assert.equal(cleanArtist({ artists: ['The Kid LAROI', 'Justin Bieber'] }), 'The Kid LAROI');
  assert.equal(cleanArtist({ artists: ['Simon & Garfunkel'] }), 'Simon & Garfunkel');
  assert.equal(cleanArtist({ artists: ['Tyler, The Creator'] }), 'Tyler, The Creator');
  assert.equal(cleanArtist({ artist: 'Band feat. Someone' }), 'Band');
  assert.equal(cleanArtist({ artists: [], artist: 'Solo' }), 'Solo');
});

test('lookupFor sends the cleaned title and the first artist', () => {
  const q = lookupFor({ title: 'Song (feat. X) - Remastered 2011', artists: ['Band', 'X'], album: 'A', durationMs: 199_600 });
  assert.deepEqual(q, { title: 'Song', artist: 'Band', album: 'A', durationS: 200 });
});

test('the lookup order: get with album, get without, search, then a broader search; it stops at the first timed match', async () => {
  const s = service((path, p) => (path === 'get' ? { status: 404, body: {} } : { status: 200, body: [] }));
  const r = await fetchLyrics(track, { fetchImpl: s.fetchImpl, log: quiet });
  assert.equal(r.status, 'notfound');
  assert.equal(r.partial, undefined); // every request answered: a true not found
  assert.deepEqual(
    s.calls.map((c) => [c.path, Boolean(c.params.album_name), Boolean(c.params.q)]),
    [['get', true, false], ['get', false, false], ['search', false, false], ['search', false, true]]
  );

  const s2 = service((path, p) => (path === 'get' && !p.album_name ? { status: 200, body: rec() } : { status: 404, body: {} }));
  const r2 = await fetchLyrics(track, { fetchImpl: s2.fetchImpl, log: quiet });
  assert.equal(r2.status, 'synced');
  assert.equal(s2.calls.length, 2); // found on the second call, so no search
});

test('a search result is accepted when its title and duration are close, and a far one is not', async () => {
  const near = rec({ id: 5, duration: 202 });
  const far = rec({ id: 6, duration: 230 });
  const s = service((path) => (path === 'get' ? { status: 404, body: {} } : { status: 200, body: [far, near] }));
  const r = await fetchLyrics(track, { fetchImpl: s.fetchImpl, log: quiet });
  assert.equal(r.status, 'synced');
  assert.equal(r.record.id, 5);
  const onlyFar = service((path) => (path === 'get' ? { status: 404, body: {} } : { status: 200, body: [far] }));
  assert.equal((await fetchLyrics(track, { fetchImpl: onlyFar.fetchImpl, log: quiet })).status, 'notfound');
});

test('a service error is never a "not found": everything failing rejects, so nothing is saved', async () => {
  const s = service(() => ({ status: 502, body: {} }));
  await assert.rejects(fetchLyrics(track, { fetchImpl: s.fetchImpl, log: quiet }), (e) => e instanceof LyricsError && e.kind === 'service-down' && /502/.test(e.message));
  // A timeout is a service problem too, and a network failure is offline unless the computer says it is online.
  const timeout = async () => {
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  };
  await assert.rejects(fetchLyrics(track, { fetchImpl: timeout, log: quiet }), { kind: 'service-down' });
});

test('"not found" after a failed request is marked partial, and a 400 counts as a failure, not as not found', async () => {
  const s = service((path) => (path === 'get' ? { status: 500, body: {} } : { status: 200, body: [] }));
  const r = await fetchLyrics(track, { fetchImpl: s.fetchImpl, log: quiet });
  assert.equal(r.status, 'notfound');
  assert.equal(r.partial, true);

  const bad = service((path) => (path === 'get' ? { status: 400, body: {} } : { status: 200, body: [] }));
  assert.equal((await fetchLyrics(track, { fetchImpl: bad.fetchImpl, log: quiet })).partial, true);
});

test('a get failure does not stop the search from finding the song', async () => {
  const s = service((path) => (path === 'get' ? { status: 502, body: {} } : { status: 200, body: [rec()] }));
  const r = await fetchLyrics(track, { fetchImpl: s.fetchImpl, log: quiet });
  assert.equal(r.status, 'synced');
});

test('every request and every rejected candidate is logged', async () => {
  const lines = [];
  const s = service((path) => (path === 'get' ? { status: 404, body: {} } : { status: 200, body: [rec({ id: 9, duration: 230, trackName: 'Song' })] }));
  await fetchLyrics({ ...track, title: 'Song - Radio Edit' }, { fetchImpl: s.fetchImpl, log: (...a) => lines.push(a.join(' ')) });
  const text = lines.join('\n');
  assert.match(text, /looking up "Song - Radio Edit".*cleaned to "Song"/);
  assert.match(text, /get .*-> 404/);
  assert.match(text, /search .*-> 200 1 result/);
  assert.match(text, /rejected "Song" by Band, 230 s, timed: duration 230 s is 30\.0 s off/);
});

test('rejectReason says why', () => {
  assert.equal(rejectReason(rec(), track), '');
  assert.match(rejectReason(rec({ duration: 207 }), track), /7\.0 s off \(limit 3 s\)/);
  assert.match(rejectReason(rec({ trackName: 'Other Thing' }), track), /title/);
  assert.match(rejectReason(rec({ artistName: 'Nobody' }), track), /artist/);
  assert.match(rejectReason(rec({ id: 4 }), track, { rejectIds: [4] }), /marked/);
});
