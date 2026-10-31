// Deciding whether a lyric result belongs to the playing track.
// Rule one: never show wrong lyrics. When in doubt, reject.

export const DURATION_TOLERANCE_S = 3;

// Suffixes that name the same recording (or the same words) and should not affect matching.
const SAME_SONG_SUFFIX =
  /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|re-?master(?:ed)?|mono|stereo|single version|album version|original mix|explicit|clean|bonus track|from\b.*|.*\bremaster(?:ed)?\b.*)(?:\s+\d{4})?\s*$/i;
const FEAT_GROUP = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;
const REMASTER_GROUP = /\s*[([][^)\]]*\b(?:remaster(?:ed)?|explicit|mono|stereo)\b[^)\]]*[)\]]/gi;

export function normalizeTitle(title) {
  let t = String(title || '');
  t = t.replace(FEAT_GROUP, '').replace(REMASTER_GROUP, '');
  // Strip repeatedly: "Song - Remastered 2009 - Mono"
  for (let i = 0; i < 3; i++) t = t.replace(SAME_SONG_SUFFIX, '');
  return simplify(t);
}

export function simplify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(s) {
  return new Set(simplify(s).split(' ').filter(Boolean));
}

export function titlesMatch(trackTitle, candidateTitle) {
  const a = normalizeTitle(trackTitle);
  const b = normalizeTitle(candidateTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  // Allow one side to carry an extra qualifier, but only if the core title is fully contained.
  const ta = tokens(a);
  const tb = tokens(b);
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const w of small) if (!big.has(w)) return false;
  // "Love" should not match "Love Story": require the shorter to cover most of the longer.
  return small.size / big.size >= 0.6;
}

export function artistsMatch(trackArtists, candidateArtist) {
  const cand = simplify(candidateArtist);
  if (!cand) return false;
  const list = Array.isArray(trackArtists) ? trackArtists : [trackArtists];
  return list.some((a) => {
    const s = simplify(a);
    return s && (cand === s || cand.includes(s) || s.includes(cand));
  });
}

export function durationOk(trackDurationMs, candidateDurationS) {
  if (!trackDurationMs || candidateDurationS == null) return false;
  return Math.abs(trackDurationMs / 1000 - Number(candidateDurationS)) <= DURATION_TOLERANCE_S;
}

// Pick the best LRCLIB record for a track, or null.
// `strict` (search results) also requires title and artist to match.
export function pickBest(candidates, track, { strict = true, rejectIds = [] } = {}) {
  const ok = (candidates || []).filter(
    (c) =>
      c &&
      !rejectIds.includes(c.id) &&
      durationOk(track.durationMs, c.duration) &&
      (!strict || (titlesMatch(track.title, c.trackName) && artistsMatch(track.artists, c.artistName)))
  );
  if (!ok.length) return null;
  const score = (c) =>
    (c.syncedLyrics ? 0 : 100) +
    (c.instrumental ? 50 : 0) +
    (simplify(c.albumName) === simplify(track.album) ? 0 : 2) +
    Math.abs(track.durationMs / 1000 - c.duration);
  return ok.sort((a, b) => score(a) - score(b))[0];
}
