// The one shared sky behind every scene: pure #000000, a field of tiny sharp stars that twinkle and drift very slowly,
// and, now and then, one comet. No gradients, blur, glow or nebula, so the picture stays black and crisp.
//
// Cost: stars are plain whole-device-pixel rectangles in typed arrays, one fillRect each, ~160 a frame; the colours come
// from a table, so a frame allocates nothing. Time comes from the clock the renderer already has, as a delta (clamped, so a
// long pause or a tab switch never makes the sky jump).
//
//   const sky = new Sky(seed);
//   sky.draw(ctx, w, h, dpr, now, { mode: 'comets' | 'stars' | 'off', reduceMotion, quiet })
//   sky.animating(mode) -> true when the sky moves by itself (the renderer keeps painting a paused song for it)

export const SKY_MODES = ['off', 'stars', 'comets'];
export const DEFAULT_SKY = 'comets';

export const STAR_COUNT = 160; // 120..200
export const COMET_GAP_S = [6, 15]; // seconds between one comet ending and the next starting
const MAX_DT = 0.1; // seconds; longer gaps count as this much
const LEVELS = 32; // brightness steps in the colour table
const LAYERS = [
  // size in CSS px, drift in CSS px per second (bigger = nearer = a little faster), brightest the star can twinkle to
  { size: 1, drift: 1.2, peak: 0.55 },
  { size: 1, drift: 1.8, peak: 0.7 },
  { size: 2, drift: 2.6, peak: 0.6 },
];
const DRIFT_DIR = -1; // one direction for everything: slowly to the left
const TAIL_SEGMENTS = 6;
const TAIL_LEN = 0.11; // of the longer screen side
const COMET_SPEED = 0.42; // longer screen sides per second
const LYRIC_AREA = { x0: 0.12, x1: 0.88, y0: 0.22, y1: 0.78 };
const LYRIC_DIM = 0.3; // comet opacity over the lyrics

const GREY = Array.from({ length: LEVELS + 1 }, (_, i) => {
  const v = Math.round((i / LEVELS) * 255);
  return `rgb(${v},${v},${v})`;
});

// Small seeded random numbers, so a given seed always draws the same sky (the screenshots rely on it).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Sky {
  constructor(seed = 20260701) {
    this.rand = rng(seed);
    const n = STAR_COUNT;
    this.x = new Float32Array(n); // 0..1 of the width
    this.y = new Float32Array(n); // 0..1 of the height
    this.phase = new Float32Array(n);
    this.speed = new Float32Array(n); // twinkle, radians per second
    this.layer = new Uint8Array(n);
    this.base = new Float32Array(n); // dimmest brightness, 0..1
    for (let i = 0; i < n; i++) {
      const r = this.rand();
      this.layer[i] = r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
      this.x[i] = this.rand();
      this.y[i] = this.rand();
      this.phase[i] = this.rand() * Math.PI * 2;
      this.speed[i] = 0.5 + this.rand() * 2.2;
      this.base[i] = 0.12 + this.rand() * 0.18;
    }
    this.t = 0; // seconds of sky time (advances by the clamped delta)
    this.lastNow = null;
    this.still = 0; // sky time that reduce motion lets pass, for the very slow twinkle
    // one comet at a time: -1 = none flying, otherwise how long it has flown
    this.comet = { age: -1, x0: 0, y0: 0, dx: 0, dy: 0, dur: 1, len: 1 };
    this.nextComet = COMET_GAP_S[0] + this.rand() * (COMET_GAP_S[1] - COMET_GAP_S[0]);
  }

  animating(mode) {
    return mode !== 'off';
  }

  _launch(w, h) {
    const c = this.comet;
    const side = Math.max(w, h);
    // an angle from 15 to 60 degrees below the horizon, heading left or right
    const ang = ((15 + this.rand() * 45) * Math.PI) / 180;
    const dir = this.rand() < 0.5 ? -1 : 1;
    c.dx = Math.cos(ang) * dir;
    c.dy = Math.sin(ang);
    const travel = side * 1.25;
    const tx = w * (0.25 + this.rand() * 0.5); // where it passes the middle of its flight
    const ty = h * (0.2 + this.rand() * 0.5);
    c.x0 = tx - c.dx * travel * 0.5;
    c.y0 = ty - c.dy * travel * 0.5;
    c.len = side * TAIL_LEN;
    c.dur = travel / (side * COMET_SPEED);
    c.age = 0;
  }

  draw(ctx, w, h, dpr, now, { mode = DEFAULT_SKY, reduceMotion = false, quiet = false } = {}) {
    if (mode === 'off' || !w || !h) {
      this.lastNow = now;
      return;
    }
    const dt = this.lastNow == null ? 0 : Math.min(MAX_DT, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.t += dt;
    // Reduce motion: the stars stand still and twinkle only very slowly; no comets.
    const tw = reduceMotion ? this.t * 0.15 : this.t;
    const dim = quiet ? 0.5 : 1;
    let last = -1;
    for (let i = 0; i < STAR_COUNT; i++) {
      const L = LAYERS[this.layer[i]];
      // position in CSS px, then snapped to a whole device pixel so the star is a sharp square, never a blur
      let x = this.x[i] * w + (reduceMotion ? 0 : DRIFT_DIR * L.drift * this.t);
      x -= Math.floor(x / w) * w;
      const sx = Math.round(x * dpr) / dpr;
      const sy = Math.round(this.y[i] * h * dpr) / dpr;
      const s = 0.5 + 0.5 * Math.sin(tw * this.speed[i] + this.phase[i]);
      const a = (this.base[i] + (L.peak - this.base[i]) * s) * dim;
      const level = Math.round(a * LEVELS);
      if (level !== last) {
        ctx.fillStyle = GREY[level];
        last = level;
      }
      ctx.fillRect(sx, sy, L.size, L.size);
    }

    if (mode !== 'comets' || reduceMotion) {
      this.comet.age = -1;
      return;
    }
    const c = this.comet;
    if (c.age < 0) {
      this.nextComet -= dt;
      if (this.nextComet <= 0) this._launch(w, h);
      else return;
    } else {
      c.age += dt;
      if (c.age > c.dur) {
        c.age = -1;
        this.nextComet = COMET_GAP_S[0] + this.rand() * (COMET_GAP_S[1] - COMET_GAP_S[0]);
        return;
      }
    }
    this._drawComet(ctx, w, h, dpr, dim);
  }

  _drawComet(ctx, w, h, dpr, dim) {
    const c = this.comet;
    const side = Math.max(w, h);
    const d = side * COMET_SPEED * c.age; // distance flown
    const life = c.age / c.dur;
    const fade = Math.min(1, life * 8, (1 - life) * 8); // in and out at the ends of the flight
    const seg = c.len / TAIL_SEGMENTS;
    ctx.lineCap = 'butt';
    for (let k = 0; k < TAIL_SEGMENTS; k++) {
      // segment k runs from k*seg to (k+1)*seg behind the head, fainter and thinner the further back
      const f0 = k / TAIL_SEGMENTS;
      const ax = c.x0 + c.dx * (d - k * seg);
      const ay = c.y0 + c.dy * (d - k * seg);
      const bx = c.x0 + c.dx * (d - (k + 1) * seg);
      const by = c.y0 + c.dy * (d - (k + 1) * seg);
      if ((ax < -50 && bx < -50) || (ax > w + 50 && bx > w + 50) || (ay > h + 50 && by > h + 50)) continue;
      const mx = (ax + bx) / (2 * w);
      const my = (ay + by) / (2 * h);
      const inLyrics = mx > LYRIC_AREA.x0 && mx < LYRIC_AREA.x1 && my > LYRIC_AREA.y0 && my < LYRIC_AREA.y1;
      const alpha = (0.75 * (1 - f0) ** 1.6 + 0.04) * fade * dim * (inLyrics ? LYRIC_DIM : 1);
      ctx.strokeStyle = GREY[Math.max(0, Math.min(LEVELS, Math.round(alpha * LEVELS)))];
      ctx.lineWidth = Math.max(1 / dpr, 1.6 - f0 * 0.9);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    // the head: a small bright square, whole device pixels
    const hx = c.x0 + c.dx * d;
    const hy = c.y0 + c.dy * d;
    const hmx = hx / w;
    const hmy = hy / h;
    const hIn = hmx > LYRIC_AREA.x0 && hmx < LYRIC_AREA.x1 && hmy > LYRIC_AREA.y0 && hmy < LYRIC_AREA.y1;
    const ha = fade * dim * (hIn ? LYRIC_DIM : 1);
    ctx.fillStyle = GREY[Math.round(Math.min(1, ha) * LEVELS)];
    const hs = 3;
    ctx.fillRect(Math.round((hx - hs / 2) * dpr) / dpr, Math.round((hy - hs / 2) * dpr) / dpr, hs, hs);
  }
}
