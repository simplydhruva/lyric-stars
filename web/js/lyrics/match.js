// Deciding whether a lyric result belongs to the playing track.
// Rule one: never show wrong lyrics. When in doubt, reject.

export const DURATION_TOLERANCE_S = 3;

// Suffixes that name the same recording (or the same words) and should not affect matching.
const SAME_SONG_SUFFIX =
  /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|re-?master(?:ed)?|mono|stereo|single version|album version|radio edit|single edit|album edit|original mix|explicit|clean|bonus track|from\b.*|.*\bremaster(?:ed)?\b.*)(?:\s+\d{4})?\s*$/i;
const FEAT_SUFFIX = /\s+-\s+(?:feat\.?|ft\.?|featuring|with)\s.*$/i;
const FEAT_GROUP = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;
const REMASTER_GROUP = /\s*[([][^)\]]*\b(?:remaster(?:ed)?|explicit|mono|stereo|radio edit|single edit|album edit|single version|album version)\b[^)\]]*[)\]]/gi;

// The title as a person would write it, without the parts that only name the release:
// "Song (feat. X) - Remastered 2011" and "Song - Radio Edit" both become "Song". Case and punctuation are kept,
// so it can be sent to the lyrics service as it is.
export function cleanTitle(title) {
  let t = String(title || '');
  t = t.replace(FEAT_GROUP, '').replace(REMASTER_GROUP, '');
  // Strip repeatedly: "Song - Remastered 2009 - Mono"
  for (let i = 0; i < 3; i++) t = t.replace(SAME_SONG_SUFFIX, '').replace(FEAT_SUFFIX, '');
  return t.replace(/\s+/g, ' ').trim() || String(title || '').trim();
}

// The main artist: Spotify's first listed artist, with any "feat." tail removed. Names that contain "&" or ","
// ("Simon & Garfunkel", "Tyler, The Creator") are single artists and stay whole.
export function cleanArtist(track) {
  const a = track.artists?.[0] || track.artist || '';
  return String(a).replace(FEAT_GROUP, '').replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, '').trim();
}

export function normalizeTitle(title) {
  return simplify(cleanTitle(title));
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

// Why a record is not accepted for this track, in a few words ('' when it is). Used for the lookup log.
export function rejectReason(c, track, { strict = true, rejectIds = [] } = {}) {
  if (!c) return 'empty';
  if (rejectIds.includes(c.id)) return 'you marked these lyrics as wrong';
  if (!durationOk(track.durationMs, c.duration)) {
    const off = c.duration == null ? null : Math.abs(track.durationMs / 1000 - Number(c.duration));
    return off == null ? 'no duration' : `duration ${Math.round(c.duration)} s is ${off.toFixed(1)} s off (limit ${DURATION_TOLERANCE_S} s)`;
  }
  if (strict && !titlesMatch(track.title, c.trackName)) return `title "${c.trackName}" does not match`;
  if (strict && !artistsMatch(track.artists, c.artistName)) return `artist "${c.artistName}" does not match`;
  return '';
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
