// The Windows media session has no Spotify cover, so find the song on Spotify by title
// and artist (GET /v1/search) and use its album images. Needs a Spotify login.
import { spotifyGet, trackFromItem } from './sources/spotify.js';
import { titlesMatch, artistsMatch } from './lyrics/match.js';

const cache = new Map(); // track key -> cover fields, or null when nothing matched

export function searchUrl(track) {
  const clean = (s) => String(s || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = `track:"${clean(track.title)}" artist:"${clean(track.artists?.[0] || track.artist)}"`;
  return `https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: 'track', limit: '5' })}`;
}

// The best result for the track: same title and artist, nearest in length, and with a cover.
export function pickResult(track, items) {
  const ok = (items || []).filter(
    (it) =>
      it?.album?.images?.length &&
      titlesMatch(track.title, it.name) &&
      artistsMatch(track.artists?.length ? track.artists : [track.artist], it.artists?.[0]?.name)
  );
  const gap = (it) => (track.durationMs ? Math.abs(it.duration_ms - track.durationMs) : 0);
  return ok.sort((a, b) => gap(a) - gap(b))[0] || null;
}

// Resolves to { art, artLarge, album } or null (use the placeholder). Never throws.
export async function findCover(track) {
  if (!track?.title) return null;
  if (cache.has(track.key)) return cache.get(track.key);
  let found;
  try {
    const { data } = await spotifyGet(searchUrl(track));
    found = pickResult(track, data?.tracks?.items);
  } catch {
    return null; // offline, rate limited or logged out: try again for the next song
  }
  const t = found && trackFromItem(found);
  const cover = t?.artLarge ? { art: t.art, artLarge: t.artLarge, album: t.album } : null;
  cache.set(track.key, cover);
  return cover;
}
