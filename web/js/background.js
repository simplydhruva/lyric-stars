// Background sky: a faint nebula in the theme's colors, two layers of dust stars
// that drift slowly at different speeds, and a few that twinkle. Layers are drawn
// once per size and theme, then moved, so a frame costs a handful of image copies.

const FAR_PX_PER_S = 2.2;
const NEAR_PX_PER_S = 5.5;
const NEBULA_FADE_MS = 1200;

function rng(seed) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 7), 61 | s) ^ s;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const tint = (c, t) => c.map((v) => Math.round(255 + (v - 255) * t));

function layer(w, h, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, g };
}

export class Background {
  constructor() {
    this.key = '';
    this.nebula = null;
    this.oldNebula = null;
    this.nebulaAt = 0;
    this.twinklers = [];
  }

  // Rebuilds the layers when the size or colors change.
  prepare(w, h, dpr, theme, now) {
    const sizeKey = `${w}x${h}@${dpr}`;
    const colorKey = theme.accents.map((c) => c.join(',')).join('|');
    if (sizeKey + colorKey === this.key) return;
    const sizeChanged = !this.key.startsWith(sizeKey);
    this.key = sizeKey + colorKey;

    // The nebula crossfades when only the colors change (a new song's palette).
    this.oldNebula = !sizeChanged && this.nebula ? this.nebula : null;
    this.nebula = this._nebula(w, h, dpr, theme);
    this.nebulaAt = now;

    // Same sky every time for a given size; only its tint follows the theme.
    const rand = rng(0x5eed);
    const area = w * h;
    const far = layer(w, h, dpr);
    const near = layer(w, h, dpr);
    const tintFor = () => tint(theme.accents[Math.floor(rand() * theme.accents.length)], 0.35 + rand() * 0.3);
    for (let i = 0, n = Math.min(520, Math.round(area / 4200)); i < n; i++) {
      far.g.fillStyle = rgba(tintFor(), 0.12 + rand() * 0.3);
      far.g.beginPath();
      far.g.arc(rand() * w, rand() * h, 0.35 + rand() * 0.7, 0, Math.PI * 2);
      far.g.fill();
    }
    this.twinklers = [];
    for (let i = 0, n = Math.min(110, Math.round(area / 22000)); i < n; i++) {
      const star = { x: rand() * w, y: rand() * h, r: 0.7 + rand() * 0.9, a: 0.25 + rand() * 0.35, color: tintFor() };
      // One in eight twinkles; those are drawn live, the rest are baked in.
      if (rand() < 0.125) {
        this.twinklers.push({ ...star, phase: rand() * Math.PI * 2, speed: 0.6 + rand() * 1.2 });
        continue;
      }
      near.g.fillStyle = rgba(star.color, star.a);
      near.g.beginPath();
      near.g.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      near.g.fill();
    }
    this.far = far.c;
    this.near = near.c;
  }

  _nebula(w, h, dpr, theme) {
    const { c, g } = layer(w, h, dpr);
    const rand = rng(0x6e6b);
    const n = Math.max(2, theme.accents.length);
    for (let i = 0; i < n; i++) {
      const color = theme.accents[i % theme.accents.length];
      const x = w * (0.15 + 0.7 * rand());
      const y = h * (0.2 + 0.6 * rand());
      const r = Math.max(w, h) * (0.35 + 0.25 * rand());
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(color, 0.075));
      grad.addColorStop(0.5, rgba(color, 0.03));
      grad.addColorStop(1, rgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    return c;
  }

  // Draws onto ctx (already scaled to CSS pixels). `now` is wall time in ms.
  draw(ctx, w, h, now, still) {
    const t = still ? 0 : now / 1000;
    const fade = Math.min(1, (now - this.nebulaAt) / NEBULA_FADE_MS);
    if (this.oldNebula && fade < 1) {
      ctx.globalAlpha = 1 - fade;
      ctx.drawImage(this.oldNebula, 0, 0, w, h);
    } else this.oldNebula = null;
    ctx.globalAlpha = this.oldNebula ? fade : 1;
    ctx.drawImage(this.nebula, 0, 0, w, h);
    ctx.globalAlpha = 1;

    // Drift right to left, wrapping: each layer is drawn twice side by side.
    for (const [img, speed] of [[this.far, FAR_PX_PER_S], [this.near, NEAR_PX_PER_S]]) {
      const x = -((t * speed) % w);
      ctx.drawImage(img, x, 0, w, h);
      if (x < 0) ctx.drawImage(img, x + w, 0, w, h);
    }
    const shift = (t * NEAR_PX_PER_S) % w;
    for (const s of this.twinklers) {
      const a = still ? s.a : s.a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed * 2 + s.phase)));
      let x = s.x - shift;
      if (x < 0) x += w;
      ctx.fillStyle = rgba(s.color, a);
      ctx.beginPath();
      ctx.arc(x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // True while something still moves without the song moving.
  animating(now, still) {
    return !still || (this.oldNebula && now - this.nebulaAt < NEBULA_FADE_MS);
  }
}
