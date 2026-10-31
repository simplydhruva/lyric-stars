// LRCLIB provider: exact lookup first, then search, always duration-checked.
import { parseLrc } from './lrc.js';
import { pickBest, normalizeTitle } from './match.js';

const BASE = 'https://lrclib.net/api';

export class LyricsError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'offline' | 'service-down'
  }
}

async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    // An error page from the service's proxy (502…) has no CORS header and fails like
    // a network error; only call it offline when the computer says so.
    if (globalThis.navigator?.onLine === true) {
      throw new LyricsError('service-down', 'The lyrics service is not responding.');
    }
    throw new LyricsError('offline', 'Could not reach the lyrics service.');
  }
  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    throw new LyricsError('service-down', `Lyrics service returned ${res.status}.`);
  }
  if (!res.ok) return null;
  return res.json();
}

function toResult(record) {
  if (!record) return { status: 'notfound' };
  const base = {
    record: {
      id: record.id,
      trackName: record.trackName,
      artistName: record.artistName,
      albumName: record.albumName,
      duration: record.duration,
    },
  };
  if (record.instrumental) return { ...base, status: 'instrumental' };
  const lines = parseLrc(record.syncedLyrics);
  if (lines.some((l) => l.text)) return { ...base, status: 'synced', lines, synced: record.syncedLyrics };
  if (record.plainLyrics) return { ...base, status: 'plain', plain: record.plainLyrics };
  return { status: 'notfound' };
}

// track: { title, artists: [], artist, album, durationMs }
export async function fetchLyrics(track, { fetchImpl = globalThis.fetch.bind(globalThis), rejectIds = [] } = {}) {
  const durationS = Math.round(track.durationMs / 1000);
  const artist = track.artists?.[0] || track.artist || '';

  // 1) Exact signature lookup. LRCLIB already matches on duration, but we check again.
  const exact = new URLSearchParams({
    track_name: track.title,
    artist_name: artist,
    album_name: track.album || '',
    duration: String(durationS),
  });
  // /get sometimes answers 5xx for a single song while search still works, so only
  // report the service as down if search fails too.
  let got = null;
  try {
    got = await getJson(`${BASE}/get?${exact}`, fetchImpl);
  } catch (e) {
    if (e.kind === 'offline') throw e;
  }
  const fromGet = got && pickBest([got], track, { strict: false, rejectIds });
  if (fromGet && fromGet.syncedLyrics) return toResult(fromGet);

  // 2) Search fallbacks, title and artist must match and duration must be within tolerance.
  const queries = [
    { track_name: track.title, artist_name: artist },
    { track_name: normalizeTitle(track.title), artist_name: artist },
  ];
  const seen = new Map();
  for (const q of queries) {
    const list = await getJson(`${BASE}/search?${new URLSearchParams(q)}`, fetchImpl);
    for (const c of list || []) seen.set(c.id, c);
    const best = pickBest([...seen.values()], track, { strict: true, rejectIds });
    if (best && best.syncedLyrics) return toResult(best);
  }

  // Nothing synced: fall back to whatever matched (plain or instrumental), else not found.
  const any = fromGet || pickBest([...seen.values()], track, { strict: true, rejectIds });
  return toResult(any);
}
