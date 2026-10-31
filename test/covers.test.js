import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../web/js/settings.js';
import { SCOPES } from '../web/js/auth.js';
import { pickImages, imagesOf } from '../web/js/covers.js';
import { searchUrl, pickResult, findCover } from '../web/js/cover-search.js';
import { trackFromItem } from '../web/js/sources/spotify.js';

const img = (w) => ({ url: `u${w}`, width: w, height: w });

test('pickImages takes the 640 px cover and the 64 px thumbnail, in any order', () => {
  assert.deepEqual(pickImages([img(64), img(640), img(300)]), { large: 'u640', small: 'u64' });
  assert.deepEqual(pickImages([img(800), img(300)]), { large: 'u800', small: 'u300' }, 'nearest when exact sizes are missing');
  assert.deepEqual(pickImages([{ url: 'a' }, { url: 'b' }]), { large: 'a', small: 'b' }, 'list order without sizes');
  assert.deepEqual(pickImages([]), {});
  assert.deepEqual(pickImages(undefined), {});
});

test('empty album images fall back to the track’s own images', () => {
  const item = { id: 'i', name: 'N', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Al', images: [] }, images: [img(640), img(64)] };
  assert.deepEqual(imagesOf(item), { large: 'u640', small: 'u64' });
  const t = trackFromItem(item);
  assert.equal(t.artLarge, 'u640');
  assert.equal(t.artist, 'A, B');
  assert.equal(t.album, 'Al');
  assert.equal(trackFromItem({ ...item, images: undefined }).artLarge, undefined, 'nothing: the placeholder shows');
});

const local = { key: 'smtc:1', title: 'Yellow', artist: 'Coldplay', artists: ['Coldplay'], durationMs: 266_000 };
const hit = (name, artist, ms, id = name) => ({ id, name, duration_ms: ms, artists: [{ name: artist }], album: { name: 'Parachutes', images: [img(640), img(64)] } });

test('searchUrl asks for the title and artist, without stray quotes', () => {
  const u = new URL(searchUrl({ ...local, title: 'Say "Hi"' }));
  assert.equal(u.pathname, '/v1/search');
  assert.equal(u.searchParams.get('type'), 'track');
  assert.equal(u.searchParams.get('q'), 'track:"Say Hi" artist:"Coldplay"');
});

test('pickResult needs a matching title and artist, then prefers the nearest length', () => {
  const items = [hit('Yellow', 'Someone Else', 266_000), hit('Fix You', 'Coldplay', 266_000), hit('Yellow', 'Coldplay', 290_000, 'live'), hit('Yellow', 'Coldplay', 266_500, 'studio')];
  assert.equal(pickResult(local, items).id, 'studio');
  assert.equal(pickResult(local, [hit('Fix You', 'Coldplay', 1)]), null);
  assert.equal(pickResult(local, []), null);
  assert.equal(pickResult(local, [{ ...hit('Yellow', 'Coldplay', 1), album: { images: [] } }]), null, 'a result without a cover is no use');
});

const realFetch = globalThis.fetch;
let calls;
const reply = (body, status = 200) => {
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => body };
  };
};
beforeEach(() => {
  calls = [];
  store.set('ls.tokens', { access: 'tok', refresh: 'ref', expiresAt: Date.now() + 3_600_000, clientId: 'b8103b5f8c55484fb593fb98ba857d40', scope: SCOPES });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  store.remove?.('ls.tokens');
});

test('findCover returns the album images of the match, and remembers the answer per track', async () => {
  reply({ tracks: { items: [hit('Yellow', 'Coldplay', 266_200)] } });
  const t = { ...local, key: 'smtc:cache-1' };
  const first = await findCover(t);
  assert.deepEqual(first, { art: 'u64', artLarge: 'u640', album: 'Parachutes' });
  assert.equal(calls.length, 1);
  assert.deepEqual(await findCover(t), first);
  assert.equal(calls.length, 1, 'no second search');
});

test('findCover gives null when nothing matches, and never throws', async () => {
  reply({ tracks: { items: [] } });
  assert.equal(await findCover({ ...local, key: 'smtc:none' }), null);
  reply({}, 429);
  assert.equal(await findCover({ ...local, key: 'smtc:limited' }), null);
  assert.equal(await findCover({}), null);
});
