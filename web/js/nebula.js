// Nebula glow: a few very large, soft clouds in the theme's colours (the album's colours with album colours on)
// that drift slowly behind the stars and breathe a little. Each cloud is a small pre-drawn sprite stretched over
// the screen, so a frame costs three image copies. It sits on top of the faint fixed nebula in background.js.
// With reduce motion the clouds hold still. Wall-clock motion is fine here: it is background, never lyrics.
import { hash } from './scenes/motion.js';

const FADE_MS = 1500; // crossfade when a new song changes the colours
const CLOUDS = 3;
const SPRITE = 192;

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

function sprite(color) {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
  grad.addColorStop(0, rgba(color, 0.14));
  grad.addColorStop(0.45, rgba(color, 0.055));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE, SPRITE);
  return c;
}

export class NebulaGlow {
  constructor() {
    this.key = '';
    this.sprites = null;
    this.old = null;
    this.at = 0;
    this.buf = null; // the clouds are painted small here, then stretched over the screen in one copy
    this.bufAt = -1e9;
  }

  prepare(theme, now) {
    const key = theme.accents.map((c) => c.join(',')).join('|');
    if (key === this.key) return;
    this.old = this.sprites;
    this.at = now;
    this.key = key;
    this.sprites = Array.from({ length: CLOUDS }, (_, i) => sprite(theme.accents[i % theme.accents.length]));
  }

  _cloud(ctx, sprites, i, w, h, t, alpha) {
    const phase = hash(i, 21) * 6.283;
    const big = Math.max(w, h) * (0.85 + 0.3 * hash(i, 22));
    const x = w * (0.2 + 0.6 * hash(i, 23)) + Math.sin(t * 0.045 * (1 + 0.3 * i) + phase) * w * 0.09;
    const y = h * (0.25 + 0.5 * hash(i, 24)) + Math.cos(t * 0.037 * (1 + 0.25 * i) + phase) * h * 0.09;
    const breathe = 0.82 + 0.18 * Math.sin(t * 0.09 + phase);
    ctx.globalAlpha = alpha * breathe;
    ctx.drawImage(sprites[i], x - big / 2, y - big / 2, big, big);
  }

  draw(ctx, w, h, now, still) {
    if (!this.sprites) return;
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    if (!this.buf) this.buf = document.createElement('canvas');
    const fading = this.old && now - this.at < FADE_MS;
    const resized = this.buf.width !== bw || this.buf.height !== bh;
    if (resized) {
      this.buf.width = bw;
      this.buf.height = bh;
    }
    // the clouds move very slowly, so repainting about 10 times a second looks the same
    if (resized || fading || now - this.bufAt >= 100 || now < this.bufAt) {
      this.bufAt = now;
      const b = this.buf.getContext('2d');
      b.clearRect(0, 0, bw, bh);
      const t = still ? 0 : now / 1000;
      const fade = Math.min(1, (now - this.at) / FADE_MS);
      b.globalCompositeOperation = 'lighter';
      for (let i = 0; i < CLOUDS; i++) {
        if (this.old && fade < 1) this._cloud(b, this.old, i, bw, bh, t, 1 - fade);
        this._cloud(b, this.sprites, i, bw, bh, t, this.old && fade < 1 ? fade : 1);
      }
      if (fade >= 1) this.old = null;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.buf, 0, 0, w, h);
    ctx.restore();
  }
}
