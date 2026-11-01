// Demo source for testing visuals without Spotify: open /?demo
// Optional: /?demo&title=Yellow&artist=Coldplay&album=Parachutes&duration=268&start=20&art=https://i.scdn.co/image/...
// Add &paused to hold at the start position (the visual checks use this).
// There is no audio, so the clock simply runs from the start position.
// A made-up album cover for testing: 'bright', 'dark', 'red', 'blue' or 'busy' (lots of detail). A 640 px data: URL, or undefined.
function fakeCover(kind) {
  if (!['bright', 'dark', 'red', 'blue', 'busy'].includes(kind) || typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = c.height = 640;
  const g = c.getContext('2d');
  const base = { bright: ['#fff6d8', '#ffe27a'], dark: ['#06070c', '#12161f'], red: ['#a3151b', '#e0322d'], blue: ['#0b3a8f', '#3f8cff'], busy: ['#222', '#999'] }[kind];
  const grad = g.createLinearGradient(0, 0, 640, 640);
  grad.addColorStop(0, base[0]);
  grad.addColorStop(1, base[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 640);
  if (kind === 'busy') {
    let s = 12345;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `hsl(${Math.floor(rnd() * 360)},${60 + rnd() * 40}%,${25 + rnd() * 55}%)`;
      const x = rnd() * 640;
      const y = rnd() * 640;
      const r = 8 + rnd() * 70;
      if (i % 2) g.fillRect(x, y, r, r * (0.3 + rnd()));
      else {
        g.beginPath();
        g.arc(x, y, r / 2, 0, 7);
        g.fill();
      }
    }
  } else {
    g.fillStyle = kind === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
    g.beginPath();
    g.arc(320, 320, 210, 0, 7);
    g.fill();
  }
  return c.toDataURL('image/png');
}

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
    // Test hook for the Reel scene: ?demoCover=bright|dark|red|blue|busy paints a fake cover (a data: image, which the page's CSP allows).
    const fake = fakeCover(q.get('demoCover'));
    if (fake) this.track.art = fake;
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
