// Automatic source: the Spotify app on this PC first (instant, no login, no rate
// limits), the Spotify account when music plays on another device (phone, speaker),
// and any other player on this PC as a last resort. Both run side by side; only the
// chosen one drives the clock, and a hand-over within the same song keeps its lyrics.
import { simplify, titlesMatch, artistsMatch } from '../lyrics/match.js';
import { MediaSessionSource } from './mediaSession.js';
import { SpotifySource } from './spotify.js';

export const STALE_MS = { local: 3000, account: 20_000 };
export const SWITCH_AFTER_MS = 1500; // a better source must keep playing this long to take over

// How much we want each child right now: -1 nothing, 0 paused, then 1..3 when playing.
export function rank(name, entry, now) {
  const s = entry?.sample;
  if (!s || s.kind === 'idle' || now - entry.at > STALE_MS[name]) return -1;
  if (!s.isPlaying) return 0;
  if (name === 'account') return 2;
  return s.spotify ? 3 : 1;
}

// entries: { local, account } of { sample, at, playingSince }. Returns 'local', 'account' or null.
export function pickActive(current, entries, now) {
  const names = ['local', 'account'];
  const r = Object.fromEntries(names.map((n) => [n, rank(n, entries[n], now)]));
  const playing = names.filter((n) => r[n] >= 1).sort((a, b) => r[b] - r[a]);
  const cur = current ? r[current] : -1;
  if (cur >= 1) {
    const best = playing[0];
    const settled = best && now - (entries[best].playingSince ?? now) >= SWITCH_AFTER_MS;
    return best !== current && r[best] > cur && settled ? best : current;
  }
  if (playing.length) return playing[0];
  if (cur === 0) return current;
  // Nothing playing: show a paused song, the Spotify app on this PC first.
  const paused = names.filter((n) => r[n] === 0);
  if (paused.includes('local') && entries.local.sample.spotify) return 'local';
  return paused.includes('account') ? 'account' : (paused[0] ?? null);
}

// Same recording reported by two sources (their track keys differ).
export function sameSong(a, b) {
  if (!a || !b) return false;
  if (Math.abs((a.durationMs || 0) - (b.durationMs || 0)) > 3000) return false;
  const titles = simplify(a.title) === simplify(b.title) || titlesMatch(a.title, b.title);
  return titles && artistsMatch(a.artists?.length ? a.artists : [a.artist], b.artists?.[0] || b.artist);
}

export class AutoSource {
  // useAccount: logged in to Spotify, so the account can be followed too.
  constructor({ onSample, onProblem }, { useAccount }) {
    this.kind = 'auto';
    this.onSample = onSample;
    this.onProblem = onProblem;
    this.entries = { local: null, account: null };
    this.problems = { local: null, account: null };
    this.active = null;
    this.track = null; // last track sent on, kept across a same-song hand-over
    this.alias = null; // { key, track }: the other source's key for that same song
    this.lastProblem = undefined;
    this.children = {
      local: new MediaSessionSource(this._handlers('local')),
      account: useAccount ? new SpotifySource(this._handlers('account')) : null,
    };
  }

  // The chosen child's name and diagnostics, so the spike panel works unchanged.
  get name() {
    return this.active === 'account' ? 'spotify' : this.active === 'local' ? 'media-session' : 'auto';
  }
  get last() {
    return this.children[this.active]?.last ?? null;
  }
  get followsAccount() {
    return Boolean(this.children.account);
  }

  start() {
    this.children.local.start();
    this.children.account?.start();
  }
  stop() {
    this.children.local.stop();
    this.children.account?.stop();
  }
  pollNow() {
    this.children.local.pollNow();
    this.children.account?.pollNow();
  }

  _handlers(name) {
    return {
      onSample: (sample) => {
        const now = performance.now();
        const prev = this.entries[name];
        const playing = sample.kind !== 'idle' && sample.isPlaying;
        const playingSince = playing ? (prev?.sample?.isPlaying && prev.sample.kind !== 'idle' ? prev.playingSince : now) : null;
        this.entries[name] = { sample, at: now, playingSince };
        this._decide(name);
      },
      onProblem: (problem) => {
        this.problems[name] = problem;
        // A child that stopped for good (login expired, refused) reports nothing more.
        if (problem && ['expired', 'not-allowlisted', 'refused'].includes(problem.code)) this.entries[name] = null;
        if (problem?.code === 'media-session-unavailable') this.entries.local = null;
        this._decide(null);
      },
    };
  }

  _decide(from) {
    const now = performance.now();
    const next = pickActive(this.active, this.entries, now);
    const switched = next !== this.active;
    this.active = next;
    this._problem();
    if (!next) {
      if (switched || (from && (this.entries[from]?.sample?.kind === 'idle' || !this.entries[from]))) {
        this.track = null;
        this.alias = null;
        this.onSample({ kind: 'idle' });
      }
      return;
    }
    if (switched || from === next) this._emit(this.entries[next].sample);
  }

  _emit(sample) {
    if (sample.kind !== 'track') {
      this.track = null;
      this.alias = null;
      return this.onSample(sample);
    }
    let track = sample.track;
    if (this.alias?.key === track.key) track = this.alias.track;
    else if (this.track && track.key !== this.track.key && sameSong(this.track, track)) {
      this.alias = { key: track.key, track: this.track };
      track = this.track;
    } else if (track.key !== this.track?.key) this.alias = null;
    this.track = track;
    this.onSample(track === sample.track ? sample : { ...sample, track });
  }

  // Report what matters for what is on screen: the chosen source's trouble, or, with
  // nothing to show, why (account login expired, not on the user list, no helper…).
  _problem() {
    const { local, account } = this.problems;
    let p;
    if (this.active === 'account') p = account;
    else if (this.active === 'local') p = null;
    else if (this.children.account && account) p = account;
    else if (!this.children.account) p = local;
    else p = null;
    if (p?.code === 'offline' && this.active !== 'account') p = null; // local playback needs no internet
    if (p === this.lastProblem) return;
    this.lastProblem = p;
    this.onProblem(p ?? null);
  }
}
