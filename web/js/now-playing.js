// The "now playing" scene shown instead of lyrics when there are none: the album
// cover floating in a glow, a ring pulsing with the song, and a few drifting stars.
// Motion maths is in now-playing-motion.js; the look is in css/now-playing.css.
import { albumPalette } from './palette.js';
import { coverMotion, ringPhase, ringStyle, makeStars, starAt, sceneColors, hashString } from './now-playing-motion.js';

const STAR_COUNT = 16;
const MARKUP = `
  <div class="np-stage">
    <canvas class="np-stars" aria-hidden="true"></canvas>
    <div class="np-float">
      <div class="np-glow"></div>
      <div class="np-ring"></div>
      <div class="np-cover"><span class="np-fallback" aria-hidden="true">★</span><img alt=""></div>
    </div>
  </div>
  <h1 class="np-title"></h1>
  <p class="np-artist"></p>
  <div class="np-status"><span class="np-label"></span><button type="button" class="np-retry">Retry</button></div>`;

export class NowPlaying {
  // onRetry: search for the lyrics again.
  constructor(root, { onRetry }) {
    this.root = root;
    root.innerHTML = MARKUP;
    const q = (s) => root.querySelector(s);
    this.el = {
      stage: q('.np-stage'),
      canvas: q('.np-stars'),
      float: q('.np-float'),
      ring: q('.np-ring'),
      img: q('.np-cover img'),
      title: q('.np-title'),
      artist: q('.np-artist'),
      label: q('.np-label'),
      retry: q('.np-retry'),
    };
    this.ctx = this.el.canvas.getContext('2d');
    this.identity = null; // which play is on screen; a new one replays the entrance
    this.artKey = null;
    this.playing = true;
    this.still = false;
    this.busy = false; // a retry search is running
    this.motion = 0; // seconds of motion; stops while paused
    this.last = null;
    this.stars = [];
    this.colors = sceneColors();
    this.dirty = true;
    this.el.img.addEventListener('load', () => this.el.img.classList.add('ready'));
    this.el.retry.addEventListener('click', () => !this.busy && onRetry());
    new ResizeObserver(() => this._resize()).observe(this.el.stage);
  }

  get visible() {
    return !this.root.hidden;
  }

  // identity: changes when the song (or a replay of it) changes. label: the small status text.
  show({ track, identity, label, busy }) {
    this.root.hidden = false;
    this.busy = busy;
    if (identity !== this.identity) {
      this.identity = identity;
      this.artKey = null;
      this.motion = 0;
      this.stars = makeStars(hashString(track.key || track.title), STAR_COUNT);
      this.el.title.textContent = track.title;
      this.el.artist.textContent = track.artist;
      this.root.classList.remove('np-enter');
      void this.root.offsetWidth; // restart the 500 ms fade and slide
      this.root.classList.add('np-enter');
      this._resize();
    }
    // The cover can arrive late (borrowed from the account), so check it every time.
    if ((track.artLarge || track.art || '') !== this.artKey) this._loadArt(track);
    this.el.label.textContent = label;
    this.el.retry.disabled = busy;
  }

  hide() {
    this.root.hidden = true;
    this.identity = null;
    this.last = null;
    this.busy = false;
  }

  setPlaying(playing) {
    if (playing === this.playing) return;
    this.playing = playing;
    this.root.classList.toggle('paused', !playing);
    this.dirty = true;
  }

  setStill(still) {
    this.still = still;
    this.root.classList.toggle('still', still);
    this.dirty = true;
  }

  // Called every animation frame. positionMs is the song position, which paces the ring.
  frame(now, positionMs) {
    if (this.root.hidden) return;
    const dt = this.last == null ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const moving = this.playing && !this.still;
    if (moving) this.motion += dt;
    const { dy, scale } = coverMotion(this.motion, this.still);
    this.el.float.style.transform = `translateY(${dy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    const ring = ringStyle(ringPhase(positionMs), !moving);
    this.el.ring.style.transform = `scale(${ring.scale.toFixed(3)})`;
    this.el.ring.style.opacity = ring.opacity.toFixed(3);
    if (moving || this.dirty) {
      this._drawStars();
      this.dirty = false;
    }
  }

  _loadArt(track) {
    this.artKey = track.artLarge || track.art || '';
    const img = this.el.img;
    img.classList.remove('ready'); // the ★ square shows until the cover loads, or for good if it fails
    if (this.artKey) img.src = this.artKey;
    else img.removeAttribute('src');
    // Colours come from the cover; gold until they are known, and if the cover fails.
    this._setColors(sceneColors());
    const id = this.identity;
    const key = this.artKey;
    albumPalette(track.art || track.artLarge).then((palette) => {
      if (this.identity === id && this.artKey === key) this._setColors(sceneColors(palette));
    });
  }

  _setColors(colors) {
    this.colors = colors;
    colors.forEach((c, i) => this.root.style.setProperty(`--np-${'abc'[i]}`, c.join(' ')));
    this.dirty = true;
  }

  _resize() {
    const { canvas, stage } = this.el;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(stage.clientWidth * 2.6 * dpr); // the canvas reaches well past the cover
    if (size && canvas.width !== size) {
      canvas.width = canvas.height = size;
      this.dirty = true;
    }
  }

  _drawStars() {
    const { canvas } = this.el;
    const g = this.ctx;
    const w = canvas.width;
    const half = w / 2;
    const unit = w / 520; // star sizes are in css px at the scene's usual size
    g.clearRect(0, 0, w, w);
    for (const star of this.stars) {
      const { x, y, glow } = starAt(star, this.motion, this.still);
      const [r, gr, b] = this.colors[star.color];
      const px = half + x * half;
      const py = half + y * half;
      const size = star.size * unit * 1.3;
      const reach = size * 4;
      const halo = g.createRadialGradient(px, py, 0, px, py, reach);
      halo.addColorStop(0, `rgba(${r},${gr},${b},${(glow * 0.5).toFixed(3)})`);
      halo.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = halo;
      g.fillRect(px - reach, py - reach, reach * 2, reach * 2);
      g.fillStyle = `rgba(255,246,222,${glow.toFixed(3)})`;
      g.beginPath();
      g.arc(px, py, size * 0.55, 0, Math.PI * 2);
      g.fill();
    }
  }
}
