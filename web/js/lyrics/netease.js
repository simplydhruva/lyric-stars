// Backup lyrics source, used only when LRCLIB is down or has no timed lyrics for the song. It asks NetEase Music's
// public search and lyric pages through the local server (browsers may not call them directly). It is an unofficial
// service: it can change or stop at any time, and then this simply finds nothing. The same rule as everywhere
// applies: the title, artist and duration (within 3 s) must match, or the result is dropped.
import { rejectReason } from './match.js';

export const ALT_TIMEOUT_MS = 10_000;

// Credit lines NetEase puts in the lyric text ("作词 : …", "Composer : …").
const CREDIT = /^\[[^\]]*\]\s*(?:作词|作曲|编曲|制作人?|词|曲|监制|混音|母带|Lyrics?|Words?|Music|Composer|Composed|Arranger|Arranged|Producer|Produced|Mix(?:ed)?|Master(?:ed)?)\s*(?:by)?\s*[:：]/i;

export function cleanNeteaseLrc(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .filter((l) => !CREDIT.test(l))
    .join('\n')
    .trim();
}

async function getJson(base, path, params, fetchImpl, log) {
  const url = `${base}/api/lyrics-alt/${path}?${new URLSearchParams(params)}`;
  const t0 = performance.now();
  const took = () => Math.round(performance.now() - t0);
  try {
    const signal = globalThis.AbortSignal?.timeout ? AbortSignal.timeout(ALT_TIMEOUT_MS) : undefined;
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) {
      log(`backup ${path} ${Object.values(params).join(' | ')} -> ${res.status} in ${took()} ms`);
      return { ok: false, message: `The backup lyrics service returned ${res.status}.` };
    }
    const body = await res.json();
    const n = Array.isArray(body) ? `${body.length} result${body.length === 1 ? '' : 's'}` : 'ok';
    log(`backup ${path} ${Object.values(params).join(' | ')} -> ${res.status} ${n} in ${took()} ms`);
    return { ok: true, body };
  } catch (e) {
    log(`backup ${path} -> failed after ${took()} ms (${e?.name}: ${e?.message})`);
    return { ok: false, message: 'The backup lyrics service is not responding.' };
  }
}

// q: { title, artist } (cleaned). Resolves { ok, record } where record has the LRCLIB record shape (timed lyrics in
// syncedLyrics, or instrumental) or is null when nothing matched; ok is false when the service could not be asked.
export async function fetchBackup(track, q, { fetchImpl, base = globalThis.location?.origin || '', rejectIds = [], log }) {
  if (!fetchImpl || !base) return { ok: false, record: null, message: 'No backup lyrics service.' };
  const s = await getJson(base, 'search', { title: q.title, artist: q.artist }, fetchImpl, log);
  if (!s.ok) return { ok: false, record: null, message: s.message };
  const list = Array.isArray(s.body) ? s.body : [];
  const close = [];
  for (const c of list) {
    const why = rejectReason(c, track, { strict: true, rejectIds });
    log(`  backup ${why ? 'rejected' : 'candidate'} "${c.trackName}" by ${c.artistName}, ${Math.round(c.duration)} s${why ? ': ' + why : ''}`);
    if (!why) close.push(c);
  }
  close.sort((a, b) => Math.abs(track.durationMs / 1000 - a.duration) - Math.abs(track.durationMs / 1000 - b.duration));
  let failed = false;
  for (const c of close.slice(0, 3)) {
    const l = await getJson(base, 'lyric', { id: c.id.replace(/^ne:/, '') }, fetchImpl, log);
    if (!l.ok) {
      failed = true;
      continue;
    }
    const lrc = cleanNeteaseLrc(l.body?.syncedLyrics);
    if (l.body?.instrumental) return { ok: true, record: { ...c, source: 'netease', instrumental: true, syncedLyrics: null, plainLyrics: '' } };
    if (/\[\d{1,3}:\d{1,2}/.test(lrc)) return { ok: true, record: { ...c, source: 'netease', instrumental: false, syncedLyrics: lrc, plainLyrics: '' } };
    log(`  backup "${c.trackName}" has no timed lyrics`);
  }
  return { ok: !failed || close.length === 0, record: null, message: failed ? 'The backup lyrics service did not answer.' : '' };
}
