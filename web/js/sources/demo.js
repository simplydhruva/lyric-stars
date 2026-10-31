// Demo source for testing visuals without Spotify: open /?demo
// Optional: /?demo&title=Yellow&artist=Coldplay&album=Parachutes&duration=268&start=20&art=https://i.scdn.co/image/...
// Add &paused to hold at the start position (the visual checks use this).
// There is no audio, so the clock simply runs from the start position.
export class DemoSource {
  constructor({ onSample, onProblem }) {
    this.name = 'demo';
    this.onSample = onSample;
    this.onProblem = onProblem;
    const q = new URLSearchParams(location.search);
    this.track = {
      key: `demo:${q.get('title') || 'Yellow'}`,
      title: q.get('title') || 'Yellow',
      artists: [q.get('artist') || 'Coldplay'],
      artist: q.get('artist') || 'Coldplay',
      album: q.get('album') ?? 'Parachutes',
      durationMs: Number(q.get('duration') || 268) * 1000,
      // Album art for palette testing; only Spotify's image host is allowed by the page's CSP.
      art: /^https:\/\/i\.scdn\.co\//.test(q.get('art') || '') ? q.get('art') : undefined,
    };
    this.track.artLarge = this.track.art;
    this.startPos = Number(q.get('start') || 0) * 1000;
    this.playing = !q.has('paused');
    this.pos = this.startPos;
    this.at = performance.now();
  }

  start() {
    this.onProblem(null);
    this._emit();
    this.timer = setInterval(() => this._emit(), 2000);
  }

  stop() {
    clearInterval(this.timer);
  }

  pollNow() {
    this._emit();
  }

  _now() {
    return this.pos + (this.playing ? performance.now() - this.at : 0);
  }

  togglePause() {
    this.pos = this._now();
    this.at = performance.now();
    this.playing = !this.playing;
    this._emit();
  }

  seek(deltaMs) {
    this.pos = Math.max(0, this._now() + deltaMs);
    this.at = performance.now();
    this._emit();
  }

  seekTo(ms) {
    this.pos = Math.max(0, ms);
    this.at = performance.now();
    this._emit();
  }

  // The same commands the Spotify account offers, so the player bar works in the demo.
  // There is only one song, so next and previous start it again.
  commands() {
    return {
      play: async () => this.playing || this.togglePause(),
      pause: async () => !this.playing || this.togglePause(),
      next: async () => this.seekTo(0),
      previous: async () => this.seekTo(0),
      seek: async (ms) => this.seekTo(ms),
    };
  }

  _emit() {
    const positionMs = this._now();
    if (positionMs >= this.track.durationMs) {
      this.pos = 0;
      this.at = performance.now();
    }
    this.onSample({ kind: 'track', track: this.track, positionMs: this._now(), at: performance.now(), isPlaying: this.playing });
  }
}
