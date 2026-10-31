// Windows media-session source (experimental in milestone 1).
// Reads the Spotify desktop app's session through the local server's probe.
import { simplify } from '../lyrics/match.js';

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
      this.onSample({ kind: 'idle' });
      return;
    }
    const isPlaying = d.status === 'Playing';
    // Position was true at lastUpdatedMs (wall clock); express that in performance.now() time.
    const updated = d.lastUpdatedMs > 0 && d.lastUpdatedMs <= Date.now() + 1000 ? d.lastUpdatedMs : d.nowMs;
    const at = performance.now() - (Date.now() - updated);
    const artists = String(d.artist || '').split(/\s*,\s*/).filter(Boolean);
    const durationMs = d.durationMs || 0;
    this.onSample({
      kind: 'track',
      at,
      isPlaying,
      positionMs: d.positionMs || 0,
      track: {
        key: `ms:${simplify(d.title)}|${simplify(d.artist)}|${Math.round(durationMs / 1000)}`,
        title: d.title,
        artists,
        artist: d.artist || '',
        album: d.album || '',
        durationMs,
      },
    });
  }
}
