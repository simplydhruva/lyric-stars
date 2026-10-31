// Windows media-session source: what Spotify (or, failing that, another player) shows
// in the Windows volume pop-up, read by the local server's native helper. No login.
import { simplify } from '../lyrics/match.js';
import { isSpotifyApp, playerName, tidyMediaInfo } from './players.js';

const POLL_MS = 250;

export class MediaSessionSource {
  constructor({ onSample, onProblem }) {
    this.name = 'media-session';
    this.onSample = onSample;
    this.onProblem = onProblem;
    this.timer = null;
    this.running = false;
    this.last = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._poll();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  pollNow() {
    clearTimeout(this.timer);
    this._poll();
  }

  async _poll() {
    if (!this.running) return;
    let next = POLL_MS;
    try {
      const res = await fetch('/api/media-session', { cache: 'no-store' });
      if (res.status === 501) {
        this.onProblem({ code: 'media-session-unavailable', message: 'Only available on Windows.' });
        next = 10_000;
      } else {
        const d = await res.json();
        this.last = { ...d, receivedAt: Date.now() };
        this.onProblem(null);
        this._handle(d);
      }
    } catch {
      this.onProblem({ code: 'media-session-unavailable', message: 'The local helper is not running.' });
      next = 3000;
    }
    if (this.running) this.timer = setTimeout(() => this._poll(), document.hidden ? 1000 : next);
  }

  _handle(d) {
    if (!d.ok || !d.session || !d.title) {
      this.playedKey = null;
      this.onSample({ kind: 'idle' });
      return;
    }
    const isPlaying = d.status === 'Playing';
    const spotify = isSpotifyApp(d.app);
    const { title, artist, album } = tidyMediaInfo(d);
    const durationMs = d.durationMs || 0;
    const key = `ms:${simplify(title)}|${simplify(artist)}|${Math.round(durationMs / 1000)}`;
    // A video left paused in a browser tab is not "the song": other players count while
    // playing, or when paused right after we showed them playing. Spotify always counts.
    if (isPlaying) this.playedKey = key;
    else if (!spotify && key !== this.playedKey) {
      this.onSample({ kind: 'idle' });
      return;
    }
    // Position was true at lastUpdatedMs (wall clock); express that in performance.now() time.
    const updated = d.lastUpdatedMs > 0 && d.lastUpdatedMs <= Date.now() + 1000 ? d.lastUpdatedMs : d.nowMs;
    const at = performance.now() - (Date.now() - updated);
    // Spotify joins artists with commas; other players often write "A & B" or "A feat. B",
    // so keep the whole name first (for the search) and the parts for matching.
    const parts = artist.split(spotify ? /\s*,\s*/ : /\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i).filter(Boolean);
    const artists = spotify ? parts : [...new Set([artist, ...parts])].filter(Boolean);
    this.onSample({
      kind: 'track',
      at,
      isPlaying,
      positionMs: d.positionMs || 0,
      player: playerName(d.app),
      spotify,
      track: {
        key,
        title,
        artists: artists.length ? artists : [artist],
        artist,
        album,
        durationMs,
      },
    });
  }
}
