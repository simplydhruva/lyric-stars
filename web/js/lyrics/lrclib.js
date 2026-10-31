// LRCLIB provider. The title and artist are cleaned first ("- Remastered 2011", "(feat. X)", "- Radio Edit", only the
// first artist), then it tries, in order: an exact lookup with the album, an exact lookup without it, a search by
// title and artist, and a broader search. Every record is duration-checked. Every request is logged.
import { parseLrc } from './lrc.js';
import { pickBest, cleanTitle, cleanArtist, rejectReason, DURATION_TOLERANCE_S } from './match.js';

const BASE = 'https://lrclib.net/api';
export const TIMEOUT_MS = 10_000;

export class LyricsError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'offline' | 'service-down'
  }
}

const defaultLog = (...a) => console.info('[lyrics]', ...a);

// One request. Returns { ok, status, ms, body }. `ok` is false when the answer says nothing about the song: a network
// failure, a timeout, a 429 or 5xx, or any other unexpected status. A 404 is a real "no such song" and is ok.
async function request(path, params, fetchImpl, log) {
  const url = `${BASE}/${path}?${new URLSearchParams(params)}`;
  const t0 = performance.now();
  const took = () => Math.round(performance.now() - t0);
  let res;
  try {
    const signal = globalThis.AbortSignal?.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    log(`${path} ${[...Object.values(params)].join(' | ')} -> ${timedOut ? 'timed out' : 'network error'} after ${took()} ms (${e?.name}: ${e?.message}) [${url}]`);
    // An error page from the service's proxy (502…) has no CORS header, so the browser reports it as a network
    // error too; so it is only called a service problem when the computer says it is online.
    const offline = globalThis.navigator?.onLine !== true && !timedOut;
    return { ok: false, status: 0, ms: took(), kind: offline ? 'offline' : 'service-down', message: timedOut ? 'The lyrics service took too long.' : offline ? 'Could not reach the lyrics service.' : 'The lyrics service is not responding.' };
  }
  const status = res.status;
  let body = null;
  if (res.ok) {
    try {
      body = await res.json();
    } catch {
      log(`${path} -> ${status} but the answer was not JSON`);
      return { ok: false, status, ms: took(), kind: 'service-down', message: 'The lyrics service sent something unreadable.' };
    }
  }
  const count = Array.isArray(body) ? `${body.length} result${body.length === 1 ? '' : 's'}` : body ? '1 result' : 'no result';
  log(`${path} ${[...Object.values(params)].join(' | ')} -> ${status} ${count} in ${took()} ms [${url}]`);
  if (status === 404) return { ok: true, status, ms: took(), body: null };
  if (!res.ok) {
    return { ok: false, status, ms: took(), kind: 'service-down', message: `Lyrics service returned ${status}.` };
  }
  return { ok: true, status, ms: took(), body };
}

function toResult(record, extra = {}) {
  if (!record) return { status: 'notfound', ...extra };
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
  return { status: 'notfound', ...extra };
}

// What was searched for, cleaned. Exported for tests and the lookup log.
export function lookupFor(track) {
  return {
    title: cleanTitle(track.title),
    artist: cleanArtist(track),
    album: track.album || '',
    durationS: Math.round(track.durationMs / 1000),
  };
}

// track: { title, artists: [], artist, album, durationMs }
// Resolves with { status: 'synced' | 'plain' | 'instrumental' | 'notfound', ... }. A 'notfound' with `partial: true`
// means some request failed on the way, so it is not a sure "not found" and must not be saved. Rejects with a
// LyricsError when nothing could be asked at all.
export async function fetchLyrics(track, { fetchImpl = globalThis.fetch.bind(globalThis), rejectIds = [], log = defaultLog } = {}) {
  const q = lookupFor(track);
  log(`looking up "${track.title}" by ${track.artists?.[0] || track.artist} (${q.durationS} s)` + (q.title !== track.title || q.artist !== (track.artists?.[0] || track.artist) ? `, cleaned to "${q.title}" by ${q.artist}` : ''));

  const failures = []; // failed requests; their kinds and messages
  let answered = 0; // requests that gave a real answer, including "not found"
  const ask = async (path, params) => {
    const r = await request(path, params, fetchImpl, log);
    if (r.ok) answered++;
    else failures.push(r);
    return r;
  };
  const explain = (list, strict) => {
    for (const c of list) {
      const why = rejectReason(c, track, { strict, rejectIds });
      log(`  ${why ? 'rejected' : 'candidate'} "${c.trackName}" by ${c.artistName}, ${Math.round(c.duration)} s, ${c.syncedLyrics ? 'timed' : c.instrumental ? 'instrumental' : c.plainLyrics ? 'not timed' : 'empty'}${why ? ': ' + why : ''}`);
    }
  };

  // 1) Exact lookups. LRCLIB already matches on duration (about 2 s), but we check again.
  const exact = { track_name: q.title, artist_name: q.artist, duration: String(q.durationS) };
  let fromGet = null; // a not-timed or instrumental match, kept in case nothing timed turns up
  for (const withAlbum of q.album ? [true, false] : [false]) {
    const r = await ask('get', withAlbum ? { ...exact, album_name: q.album } : exact);
    if (r.kind === 'offline') break; // the computer says it is offline: no point trying more
    if (!(r.ok && r.body)) continue;
    explain([r.body], false);
    const ok = pickBest([r.body], track, { strict: false, rejectIds });
    if (ok?.syncedLyrics) return toResult(ok);
    if (ok && !fromGet) fromGet = ok;
  }

  // 2) Search fallbacks: title and artist must match and the duration must be within tolerance.
  const seen = new Map();
  if (failures[failures.length - 1]?.kind !== 'offline') {
    for (const params of [{ track_name: q.title, artist_name: q.artist }, { q: `${q.artist} ${q.title}`.trim() }]) {
      const r = await ask('search', params);
      if (r.kind === 'offline') break;
      const list = r.ok && Array.isArray(r.body) ? r.body : [];
      explain(list, true);
      for (const c of list) seen.set(c.id, c);
      const best = pickBest([...seen.values()], track, { strict: true, rejectIds });
      if (best?.syncedLyrics) return toResult(best);
    }
  }

  // Nothing timed. Use whatever matched (not timed, or instrumental) if there is any.
  const any = fromGet || pickBest([...seen.values()], track, { strict: true, rejectIds });
  if (any) return toResult(any);

  // Nothing at all. If no request got a real answer the service could not be asked; if only some failed, this is
  // a "not found" that is not certain, so the caller must not save it.
  if (!answered) {
    const f = failures.find((x) => x.kind === 'offline') || failures[0];
    throw new LyricsError(f?.kind || 'service-down', f?.message || 'The lyrics service is not responding.');
  }
  return toResult(null, failures.length ? { partial: true } : {});
}

export { DURATION_TOLERANCE_S };
