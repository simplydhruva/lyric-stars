// Lyric cache on disk, via the local server (/api/cache). Found lyrics are
// kept until cleared; "not found" results expire after a day.

export const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;

const memory = new Map();

async function request(method, key, body) {
  const res = await fetch(`/api/cache/${encodeURIComponent(key)}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cache ${method} ${res.status}`);
  return method === 'GET' ? res.json() : true;
}

export function lyricsKey(track) {
  return `lyrics:${track.key}`;
}

// Returns { entry, fresh } or null. Stale entries are still returned so they can be used offline.
export async function getLyrics(track) {
  const key = lyricsKey(track);
  let entry = memory.get(key);
  if (!entry) {
    try {
      entry = await request('GET', key);
    } catch {
      entry = null;
    }
    if (entry) memory.set(key, entry);
  }
  if (!entry) return null;
  const isMiss = entry.result.status === 'notfound';
  const fresh = !isMiss || Date.now() - entry.savedAt < NOT_FOUND_TTL_MS;
  return { entry, fresh };
}

export async function putLyrics(track, result, extra = {}) {
  const entry = { savedAt: Date.now(), track: { title: track.title, artists: track.artists }, result, ...extra };
  memory.set(lyricsKey(track), entry);
  try {
    await request('PUT', lyricsKey(track), entry);
  } catch (e) {
    console.warn('Lyric cache write failed', e);
  }
  return entry;
}

export async function clearAll() {
  memory.clear();
  await fetch('/api/cache', { method: 'DELETE' });
}

export async function stats() {
  const res = await fetch('/api/cache-stats');
  return res.ok ? res.json() : { count: 0, bytes: 0 };
}
