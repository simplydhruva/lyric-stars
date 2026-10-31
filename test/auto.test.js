import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickActive, rank, sameSong, SWITCH_AFTER_MS } from '../web/js/sources/auto.js';
import { tidyMediaInfo, playerName, isSpotifyApp } from '../web/js/sources/players.js';

const NOW = 100_000;
const track = (title, artist, durationMs = 266_000) => ({ title, artist, artists: [artist], durationMs });
const entry = ({ playing = true, spotify = false, idle = false, at = NOW, since = NOW - 10_000 } = {}) => ({
  sample: idle ? { kind: 'idle' } : { kind: 'track', isPlaying: playing, spotify, track: track('Yellow', 'Coldplay') },
  at,
  playingSince: playing && !idle ? since : null,
});

test('rank: local Spotify > account > other local player > paused > nothing', () => {
  assert.equal(rank('local', entry({ spotify: true }), NOW), 3);
  assert.equal(rank('account', entry(), NOW), 2);
  assert.equal(rank('local', entry(), NOW), 1);
  assert.equal(rank('local', entry({ playing: false, spotify: true }), NOW), 0);
  assert.equal(rank('local', entry({ idle: true }), NOW), -1);
  assert.equal(rank('local', null, NOW), -1);
  assert.equal(rank('local', entry({ at: NOW - 10_000 }), NOW), -1, 'stale local sample');
  assert.equal(rank('account', entry({ at: NOW - 10_000 }), NOW), 2, 'account polls slowly');
});

test('pickActive: Spotify on this PC wins over the account', () => {
  assert.equal(pickActive(null, { local: entry({ spotify: true }), account: entry() }, NOW), 'local');
});

test('pickActive: the account wins over a browser playing on this PC', () => {
  assert.equal(pickActive(null, { local: entry(), account: entry() }, NOW), 'account');
});

test('pickActive: music on the phone only follows the account', () => {
  assert.equal(pickActive(null, { local: entry({ idle: true }), account: entry() }, NOW), 'account');
  assert.equal(pickActive(null, { local: entry({ playing: false }), account: entry() }, NOW), 'account');
});

test('pickActive: a better source takes over only after it has played for a moment', () => {
  const fresh = { local: entry({ spotify: true, since: NOW - 200 }), account: entry() };
  assert.equal(pickActive('account', fresh, NOW), 'account');
  const settled = { local: entry({ spotify: true, since: NOW - SWITCH_AFTER_MS }), account: entry() };
  assert.equal(pickActive('account', settled, NOW), 'local');
});

test('pickActive: switches at once when the current source stops', () => {
  const entries = { local: entry({ spotify: true, playing: false }), account: entry({ since: NOW - 100 }) };
  assert.equal(pickActive('local', entries, NOW), 'account');
});

test('pickActive: keeps a paused song on screen, preferring this PC', () => {
  assert.equal(pickActive('account', { local: entry({ idle: true }), account: entry({ playing: false }) }, NOW), 'account');
  const bothPaused = { local: entry({ spotify: true, playing: false }), account: entry({ playing: false }) };
  assert.equal(pickActive(null, bothPaused, NOW), 'local');
  assert.equal(pickActive(null, { local: entry({ playing: false }), account: entry({ playing: false }) }, NOW), 'account');
  assert.equal(pickActive('local', { local: entry({ idle: true }), account: null }, NOW), null);
});

test('sameSong: same recording from both sources, not a different one', () => {
  assert.ok(sameSong(track('Yellow', 'Coldplay', 266_773), track('Yellow', 'Coldplay', 266_000)));
  assert.ok(sameSong(track('Yellow - Remastered 2021', 'Coldplay'), track('Yellow', 'Coldplay')));
  assert.ok(!sameSong(track('Yellow', 'Coldplay', 266_000), track('Yellow', 'Coldplay', 300_000)));
  assert.ok(!sameSong(track('Yellow', 'Coldplay'), track('Fix You', 'Coldplay')));
  assert.ok(!sameSong(null, track('Yellow', 'Coldplay')));
});

test('tidyMediaInfo: leaves Spotify alone', () => {
  const info = { title: 'Yellow (Official Video)', artist: 'Coldplay', album: 'Parachutes', app: 'Spotify.exe' };
  assert.deepEqual(tidyMediaInfo(info), { title: 'Yellow (Official Video)', artist: 'Coldplay', album: 'Parachutes' });
});

test('tidyMediaInfo: cleans video titles and channel names', () => {
  const t = (title, artist) => tidyMediaInfo({ title, artist, app: 'MSEdge' });
  assert.deepEqual(t('Coldplay - Yellow (Official Video)', 'Coldplay'), { title: 'Yellow', artist: 'Coldplay', album: '' });
  assert.deepEqual(t('Yellow', 'Coldplay - Topic'), { title: 'Yellow', artist: 'Coldplay', album: '' });
  assert.deepEqual(t('Yellow [Lyrics]', 'ColdplayVEVO'), { title: 'Yellow', artist: 'Coldplay', album: '' });
  assert.deepEqual(t('The Weeknd - Blinding Lights (Official Audio) | 4K', 'The Weeknd'), {
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: '',
  });
  assert.equal(t('Yellow (Live at Glastonbury)', 'Coldplay').title, 'Yellow (Live at Glastonbury)', 'keeps real version info');
});

test('playerName: friendly names for known players', () => {
  assert.equal(playerName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'), 'Spotify');
  assert.equal(playerName('MSEdge'), 'Edge');
  assert.equal(playerName('Brave'), 'Brave');
  assert.equal(playerName('308046B0AF4A39CB'), 'Firefox');
  assert.equal(playerName('C:\\Tools\\foo.exe'), 'foo');
  assert.ok(isSpotifyApp('Spotify.exe') && !isSpotifyApp('Chrome'));
});

test('media session: a paused browser video is ignored, a paused song we showed is kept', async () => {
  const { MediaSessionSource } = await import('../web/js/sources/mediaSession.js');
  const got = [];
  const src = new MediaSessionSource({ onSample: (s) => got.push(s), onProblem: () => {} });
  const d = (app, status, title = 'Yellow', artist = 'Coldplay') => ({
    ok: true, session: true, app, status, title, artist, album: '', positionMs: 1000, durationMs: 266_000, nowMs: Date.now(), lastUpdatedMs: Date.now(),
  });
  src._handle(d('Brave', 'Paused', 'Some gaming clip', 'A Streamer'));
  assert.equal(got.at(-1).kind, 'idle');
  src._handle(d('MSEdge', 'Playing', 'Coldplay - Yellow (Official Video)', 'ColdplayVEVO'));
  assert.equal(got.at(-1).track.title, 'Yellow');
  assert.equal(got.at(-1).player, 'Edge');
  src._handle(d('MSEdge', 'Paused', 'Coldplay - Yellow (Official Video)', 'ColdplayVEVO'));
  assert.equal(got.at(-1).kind, 'track', 'just paused: still shown');
  src._handle(d('Spotify.exe', 'Paused', 'Fix You'));
  assert.equal(got.at(-1).kind, 'track', 'paused Spotify always counts');
  src._handle(d('MSEdge', 'Playing', 'Simon & Garfunkel - The Boxer', 'Some Channel'));
  assert.deepEqual(got.at(-1).track.artists, ['Simon & Garfunkel', 'Simon', 'Garfunkel']);
});

test('AutoSource: account to this PC within one song keeps the lyrics; problems only when nothing plays', async () => {
  const { AutoSource } = await import('../web/js/sources/auto.js');
  const samples = [];
  const problems = [];
  const auto = new AutoSource({ onSample: (s) => samples.push(s), onProblem: (p) => problems.push(p) }, { useAccount: true });
  const local = auto._handlers('local');
  const account = auto._handlers('account');
  const s = (key, title, { playing = true, spotify = false, durationMs = 266_000 } = {}) => ({
    kind: 'track', isPlaying: playing, spotify, positionMs: 1000, at: performance.now(),
    track: { key, title, artist: 'Coldplay', artists: ['Coldplay'], durationMs },
  });

  account.onSample(s('spotify:abc', 'Yellow', { durationMs: 266_773 }));
  assert.equal(auto.active, 'account');
  assert.equal(auto.name, 'spotify');
  const first = samples.at(-1).track;

  // The Spotify app on this PC reports the same song: after it settles, it takes over…
  local.onSample(s('ms:yellow|coldplay|266', 'Yellow', { spotify: true }));
  assert.equal(auto.active, 'account', 'not before it has played a moment');
  auto.entries.local.playingSince -= 2000;
  local.onSample(s('ms:yellow|coldplay|266', 'Yellow', { spotify: true }));
  assert.equal(auto.active, 'local');
  assert.equal(auto.name, 'media-session');
  // …with the same track object, so the app does not reload the lyrics.
  assert.equal(samples.at(-1).track, first);
  local.onSample(s('ms:yellow|coldplay|266', 'Yellow', { spotify: true }));
  assert.equal(samples.at(-1).track, first);

  // A different song is a different track.
  local.onSample(s('ms:fixyou|coldplay|295', 'Fix You', { spotify: true, durationMs: 295_000 }));
  assert.equal(samples.at(-1).track.title, 'Fix You');

  // Account trouble is hidden while this PC plays, and shown once nothing does.
  const before = problems.length;
  account.onProblem({ code: 'rate-limited', retryInMs: 5000 });
  assert.equal(problems.length, before);
  local.onSample({ kind: 'idle' });
  account.onProblem({ code: 'expired' });
  assert.equal(auto.active, null);
  assert.equal(problems.at(-1).code, 'expired');
  assert.equal(samples.at(-1).kind, 'idle');
});

test('AutoSource without a login follows this PC only', async () => {
  const { AutoSource } = await import('../web/js/sources/auto.js');
  const problems = [];
  const auto = new AutoSource({ onSample: () => {}, onProblem: (p) => problems.push(p) }, { useAccount: false });
  assert.equal(auto.followsAccount, false);
  auto._handlers('local').onProblem({ code: 'media-session-unavailable', message: 'x' });
  assert.equal(problems.at(-1).code, 'media-session-unavailable');
  auto._handlers('local').onProblem({ code: 'offline' });
  assert.equal(problems.at(-1), null, 'offline does not matter for local playback');
});
