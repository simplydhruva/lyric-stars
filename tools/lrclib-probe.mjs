// Calls LRCLIB directly (/api/get and /api/search) for well-known songs and prints the HTTP status, the answer and the
// time taken. Tells you whether the lyrics service itself is reachable from this machine.
//   node tools/lrclib-probe.mjs
const SONGS = [
  { title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', duration: 355 },
  { title: 'Shape of You', artist: 'Ed Sheeran', album: '÷ (Deluxe)', duration: 234 },
  { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200 },
  { title: 'Billie Jean', artist: 'Michael Jackson', album: 'Thriller', duration: 294 },
  { title: 'Hotel California', artist: 'Eagles', album: 'Hotel California', duration: 391 },
];
const BASE = 'https://lrclib.net/api';

async function call(path, params) {
  const url = `${BASE}/${path}?${new URLSearchParams(params)}`;
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const ms = Math.round(performance.now() - t0);
    let body = null;
    try {
      body = await res.json();
    } catch {}
    return { url, status: res.status, ms, body };
  } catch (e) {
    return { url, status: 'ERROR', ms: Math.round(performance.now() - t0), error: `${e.name}: ${e.message}${e.cause ? ' / ' + (e.cause.code || e.cause.message) : ''}` };
  }
}

const describe = (r) => {
  if (r.error) return r.error;
  if (Array.isArray(r.body)) return `${r.body.length} results` + (r.body[0] ? `, first: "${r.body[0].trackName}" by ${r.body[0].artistName} (${Math.round(r.body[0].duration)} s, synced ${Boolean(r.body[0].syncedLyrics)})` : '');
  if (r.body?.trackName) return `"${r.body.trackName}" by ${r.body.artistName} (${Math.round(r.body.duration)} s, synced ${Boolean(r.body.syncedLyrics)}, instrumental ${r.body.instrumental})`;
  return JSON.stringify(r.body)?.slice(0, 120);
};

let bad = 0;
for (const s of SONGS) {
  console.log(`\n${s.title} - ${s.artist}`);
  const get = await call('get', { track_name: s.title, artist_name: s.artist, album_name: s.album, duration: s.duration });
  console.log(`  /get     ${get.status}  ${get.ms} ms  ${describe(get)}`);
  const search = await call('search', { track_name: s.title, artist_name: s.artist });
  console.log(`  /search  ${search.status}  ${search.ms} ms  ${describe(search)}`);
  if (get.status !== 200 && search.status !== 200) bad++;
}
console.log(bad ? `\nlrclib: ${bad} of ${SONGS.length} songs got no answer from either endpoint` : '\nlrclib: reachable, both endpoints answer');
process.exit(bad ? 1 : 0);
