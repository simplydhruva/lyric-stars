// A scripted fake Spotify for the browser checks. It answers the app's real requests (the Web API player
// endpoint, the playback commands and the lyrics service) from inside the browser, so the real Spotify source,
// player bar and lyrics code run unchanged. Nothing leaves the machine and no account is needed.
//
//   const fake = new FakeSpotify();               // starts on SONGS[0], playing, at 0
//   await installFake(session, fake);             // call before opening the page
//   await seedLogin(session);                     // pretend to be logged in (token in localStorage)
//   fake.pause(); fake.seek(30_000); fake.next(); // drive it from the test
import { syncedEntry } from './headless.mjs';

// Lyrics for the test song: 12 lines, one every 4 seconds, words 400 ms apart (so word starts are exact).
export const WORDS_PER_LINE = 4;
const LINE_WORDS = [
  'Hold me in the light', 'Stars are falling slow', 'Sing it back to me', 'Never let it go',
  'Hold me in the light', 'Stars are falling slow', 'Every word a spark', 'Burning bright and low',
  'Hold me in the light', 'Stars are falling slow', 'Sing it back to me', 'Never let it go',
];
export const LONG_LINE = 'We walked through the endless city lights remembering every single promise we made under the quiet midnight sky';

export function lrcFor(lines = LINE_WORDS) {
  return lines
    .map((t, i) => {
      const s = i * 4;
      return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.00]${t}`;
    })
    .join('\n');
}

// Items in the order next() steps through them.
export const SONGS = [
  { type: 'track', id: 'fake1', name: 'Fake Song', artist: 'Test Band', album: 'Scripts', duration_ms: 60_000, lyrics: lrcFor() },
  { type: 'track', id: 'fake2', name: 'Silent Track', artist: 'Test Band', album: 'Scripts', duration_ms: 45_000, lyrics: null },
  { type: 'ad', duration_ms: 15_000 },
  { type: 'episode', id: 'ep1', name: 'A Podcast Episode', duration_ms: 90_000 },
  { type: 'track', id: 'fake1', name: 'Fake Song', artist: 'Test Band', album: 'Scripts', duration_ms: 60_000, lyrics: lrcFor() },
];

export class FakeSpotify {
  constructor(songs = SONGS) {
    this.songs = songs;
    this.n = 0;
    this.playing = true;
    this.base = 0; // progress at `since`
    this.since = Date.now();
    this.requests = [];
    this.loop = true; // wrap to the start when the song ends
  }

  get item() {
    return this.songs[this.n];
  }
  get progress() {
    const p = this.base + (this.playing ? Date.now() - this.since : 0);
    return this.loop && p >= this.item.duration_ms ? p % this.item.duration_ms : Math.min(p, this.item.duration_ms);
  }
  _set(ms) {
    this.base = Math.max(0, ms);
    this.since = Date.now();
  }
  pause() {
    this._set(this.progress);
    this.playing = false;
  }
  play() {
    this._set(this.progress);
    this.playing = true;
  }
  seek(ms) {
    this._set(ms);
  }
  next() {
    this.n = (this.n + 1) % this.songs.length;
    this._set(0);
  }
  previous() {
    this.n = (this.n + this.songs.length - 1) % this.songs.length;
    this._set(0);
  }
  jump(n, ms = 0) {
    this.n = n;
    this._set(ms);
  }

  // The body of GET /v1/me/player.
  playerBody() {
    const it = this.item;
    const common = { device: { name: 'Fake Speaker' }, is_playing: this.playing, progress_ms: Math.round(this.progress) };
    if (it.type === 'ad') return { ...common, currently_playing_type: 'ad', item: null };
    if (it.type === 'episode') {
      return { ...common, currently_playing_type: 'episode', item: { id: it.id, name: it.name, duration_ms: it.duration_ms } };
    }
    return {
      ...common,
      currently_playing_type: 'track',
      item: {
        id: it.id,
        uri: `spotify:track:${it.id}`,
        name: it.name,
        duration_ms: it.duration_ms,
        artists: [{ name: it.artist }],
        album: { name: it.album, images: it.images || [] },
      },
    };
  }

  // `delayMs: n` on a song: its lyrics requests take that long to answer.
  delayFor(url) {
    const u = new URL(url);
    if (u.host !== 'lrclib.net') return 0;
    const name = u.searchParams.get('track_name') || u.searchParams.get('q') || '';
    return this.songs.find((s) => s.type === 'track' && name.includes(s.name))?.delayMs || 0;
  }

  // Answers one intercepted request: returns { status, body } or null to let it through.
  answer(method, url) {
    const u = new URL(url);
    this.requests.push(`${method} ${u.host}${u.pathname}`);
    if (u.host === 'api.spotify.com') {
      const p = u.pathname.replace('/v1/me/player', '') || '/';
      if (method === 'GET') return { status: 200, body: this.playerBody() };
      if (p === '/play') this.play();
      else if (p === '/pause') this.pause();
      else if (p === '/next') this.next();
      else if (p === '/previous') this.previous();
      else if (p === '/seek') this.seek(Number(u.searchParams.get('position_ms')));
      return { status: 204, body: null };
    }
    if (u.host === 'accounts.spotify.com') {
      return { status: 200, body: { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, scope: 'user-read-playback-state user-read-currently-playing user-modify-playback-state' } };
    }
    if (u.pathname.startsWith('/api/lyrics-alt/')) {
      // The local server's NetEase backup: songs with `alt` (timed lyrics) or `altError` answer; others find nothing.
      const name = u.searchParams.get('title') || '';
      const song = this.songs.find((s) => s.type === 'track' && (name.includes(s.name) || (u.searchParams.get('id') && s.id.replace(/D/g, '') === u.searchParams.get('id'))));
      if (u.pathname.endsWith('/search')) {
        if (song?.altError) return { status: 502, body: { error: 'down' } };
        return { status: 200, body: song?.alt ? [{ id: `ne:${song.id.replace(/D/g, '') || 1}`, trackName: song.name, artistName: song.artist, albumName: song.album, duration: song.duration_ms / 1000 }] : [] };
      }
      return { status: 200, body: { syncedLyrics: song?.alt || '', instrumental: false } };
    }
    if (u.host === 'lrclib.net') {
      const name = u.searchParams.get('track_name') || u.searchParams.get('q') || '';
      const song = this.songs.find((s) => s.type === 'track' && name.includes(s.name));
      if (song?.service === 'error') return { status: 502, body: 'error code: 502' };
      // `failAttempts: n`: the first n lookups (each starts with a /get that carries the album) fail with a server error.
      if (song?.failAttempts) {
        if (u.pathname.endsWith('/get') && (u.searchParams.has('album_name') || !song.album)) song.attempts = (song.attempts || 0) + 1;
        if ((song.attempts || 0) <= song.failAttempts) return { status: 502, body: 'error code: 502' };
      }
      if (u.pathname.endsWith('/search') && !song?.instrumental && !song?.plain) return { status: 200, body: [] };
      if (song?.instrumental) return { status: 200, body: { id: 2, trackName: song.name, artistName: song.artist, albumName: song.album, duration: song.duration_ms / 1000, instrumental: true, plainLyrics: '', syncedLyrics: null } };
      if (song?.plain) return { status: 200, body: { id: 3, trackName: song.name, artistName: song.artist, albumName: song.album, duration: song.duration_ms / 1000, instrumental: false, plainLyrics: song.plain, syncedLyrics: null } };
      if (!song || !song.lyrics) return { status: 404, body: { message: 'not found' } };
      return {
        status: 200,
        body: { id: 1, trackName: song.name, artistName: song.artist, albumName: song.album, duration: song.duration_ms / 1000, instrumental: false, plainLyrics: '', syncedLyrics: song.lyrics },
      };
    }
    return null;
  }
}

// Intercept the app's Spotify and lyrics requests in this browser session.
export async function installFake(session, fake) {
  session.on('Fetch.requestPaused', async (p) => {
    const a = fake.answer(p.request.method, p.request.url);
    const cors = [
      { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Access-Control-Allow-Headers', value: '*' },
      { name: 'Access-Control-Allow-Methods', value: '*' },
    ];
    if (p.request.method === 'OPTIONS') {
      return session.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 204, responseHeaders: cors });
    }
    if (!a) return session.send('Fetch.continueRequest', { requestId: p.requestId });
    const delay = fake.delayFor(p.request.url);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return session.send('Fetch.fulfillRequest', {
      requestId: p.requestId,
      responseCode: a.status,
      responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }],
      body: a.body == null ? '' : Buffer.from(JSON.stringify(a.body)).toString('base64'),
    });
  });
  await session.send('Fetch.enable', {
    patterns: ['https://api.spotify.com/*', 'https://accounts.spotify.com/*', 'https://lrclib.net/*', '*/api/lyrics-alt/*'].map((urlPattern) => ({ urlPattern })),
  });
}

// Put a login in the page's storage (the page must already be on our origin) and use the account source.
export async function seedLogin(session) {
  await session.js(`(() => {
    localStorage.setItem('ls.tokens', JSON.stringify({ access: 'fake-access', refresh: 'fake-refresh', expiresAt: Date.now() + 3600e3, clientId: 'b8103b5f8c55484fb593fb98ba857d40', scope: 'user-read-playback-state user-read-currently-playing user-modify-playback-state' }));
    localStorage.setItem('ls.settings', JSON.stringify({ ...(JSON.parse(localStorage.getItem('ls.settings') || '{}')), source: 'spotify' }));
  })()`);
}

export { syncedEntry };
