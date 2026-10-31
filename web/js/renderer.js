// Constellation renderer. Everything drawn is a pure function of the playback
// position, so seeking, pausing and resuming never leave stale animation behind.
import { lineIndexAt } from './lyrics/lrc.js';
import { Background } from './background.js';
import { makeTheme, THEMES, fontCss } from './theme.js';
import { placeLine, hash } from './sky-layout.js';

const CENTER = [255, 250, 235];
const FADE_OUT_MS = 700;
const LINK_MS = 250;
const QUIET_AFTER_MS = 3500; // silence after a line before the sky starts to quiet
const QUIET_FADE_MS = 2000;
const QUIET_ALPHA = 0.12;
const EMPHASIS_DECAY_MS = 450;
const IDLE_FRAME_MS = 50; // when only the background moves, 20 frames a second is plenty

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function makeGlowSprite(color) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, rgba(color, 0.9));
  grad.addColorStop(0.18, rgba(color, 0.35));
  grad.addColorStop(0.5, rgba(color, 0.08));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function sparklePath(ctx, x, y, r) {
  const k = r * 0.14;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + k, y - k, x + r, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + r);
  ctx.quadraticCurveTo(x - k, y + k, x - r, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - r);
  ctx.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = makeTheme(THEMES.gold.base);
    this.fontFamily = fontCss('segoe');
    this.glow = makeGlowSprite(this.theme.star);
    this.background = new Background();
    this.opts = { reduceMotion: false, backgroundStars: true, transparent: false };
    this.lastDrawAt = 0;
    this.timeline = null;
    this.layouts = new Map();
    this.seed = '';
    this.spread = 100;
    this.chaos = 50;
    this.size = { w: 0, h: 0, dpr: 0 };
    this.lastFrameKey = '';
  }

  // theme: from theme.js; font: a FONTS key; transparent: for the overlay (no black, no background);
  // spread, chaos: 0..100.
  configure({ theme, font, spread, chaos, ...opts }) {
    if (spread != null && chaos != null && (Number(spread) !== this.spread || Number(chaos) !== this.chaos)) {
      this.spread = Number(spread);
      this.chaos = Number(chaos);
      this.layouts.clear();
    }
    if (theme && theme !== this.theme) {
      if (theme.star.join() !== this.theme.star.join()) this.glow = makeGlowSprite(theme.star);
      this.theme = theme;
    }
    if (font && fontCss(font) !== this.fontFamily) {
      this.fontFamily = fontCss(font);
      this.layouts.clear(); // word widths change
    }
    Object.assign(this.opts, opts);
    this.lastFrameKey = '';
  }

  // seed: track and play, so each play of a song gets its own sky.
  setTimeline(timeline, seed = '') {
    this.timeline = timeline;
    this.seed = seed;
    this.layouts.clear();
    this.lastFrameKey = '';
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return false;
    this.size = { w, h, dpr };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.layouts.clear();
    return true;
  }

  // Each line's sky depends on the line before it (fading stars, regions used),
  // so layouts are built in order from the last one cached.
  _layout(index) {
    let i = index;
    while (i > 0 && !this.layouts.has(i - 1)) i--;
    for (; i <= index; i++) if (!this.layouts.has(i)) this.layouts.set(i, this._place(i, this.layouts.get(i - 1)));
    return this.layouts.get(index);
  }

  _place(index, prev) {
    const { w, h } = this.size;
    const ctx = this.ctx;
    return placeLine({
      words: this.timeline[index].words,
      w,
      h,
      seed: hash(`${this.seed}|${index}`),
      prev: prev || null,
      baseFont: clamp(Math.min(w, h * 1.6) * 0.03, 14, 34),
      spread: this.spread / 100,
      chaos: this.chaos / 100,
      measure: (text, font) => {
        ctx.font = `600 ${font}px ${this.fontFamily}`;
        return ctx.measureText(text).width;
      },
    });
  }

  // Returns false when nothing changed and the frame was skipped.
  draw(pos, { mode = 'word', playing = true, quiet = false, now = performance.now() } = {}) {
    const resized = this._resize();
    const { w, h, dpr } = this.size;
    const { reduceMotion, backgroundStars, transparent } = this.opts;
    const sky = backgroundStars && !transparent;
    const frameKey = `${Math.round(pos)}|${mode}|${quiet}|${w}x${h}@${dpr}`;
    if (!resized && !playing && frameKey === this.lastFrameKey) {
      const moving = sky && this.background.animating(now, reduceMotion);
      if (!moving || now - this.lastDrawAt < IDLE_FRAME_MS) return false;
    }
    this.lastFrameKey = frameKey;
    this.lastDrawAt = now;

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (transparent) ctx.clearRect(0, 0, w, h);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
    if (sky && w && h) {
      this.background.prepare(w, h, dpr, this.theme, now);
      this.background.draw(ctx, w, h, now, reduceMotion);
    }
    if (!this.timeline || !this.timeline.length || !w || !h) return true;

    const lines = this.timeline;
    const idx = lineIndexAt(lines, pos);
    if (idx < 0) return true;

    const cur = lines[idx];
    // The sky for the current line, quieting during long silences.
    let curAlpha = 1;
    const nextTime = idx + 1 < lines.length ? lines[idx + 1].time : Infinity;
    if (!cur.words.length) curAlpha = 0;
    else if (pos > cur.end + QUIET_AFTER_MS && nextTime - pos > 1500) {
      curAlpha = 1 - (1 - QUIET_ALPHA) * clamp((pos - cur.end - QUIET_AFTER_MS) / QUIET_FADE_MS, 0, 1);
    }
    if (quiet) curAlpha = Math.min(curAlpha, 0.35);

    // The previous sky fades out while the new one forms.
    const since = pos - cur.time;
    if (since < FADE_OUT_MS && idx > 0 && lines[idx - 1].words.length) {
      const prev = lines[idx - 1];
      const prevGapAlpha = cur.time - prev.end > QUIET_AFTER_MS + QUIET_FADE_MS ? QUIET_ALPHA : 1;
      this._drawSky(idx - 1, pos, prevGapAlpha * (1 - easeOut(since / FADE_OUT_MS)), mode, true);
    }
    if (curAlpha > 0) this._drawSky(idx, pos, curAlpha, mode, false);
    return true;
  }

  _drawSky(index, pos, alpha, mode, leaving) {
    const line = this.timeline[index];
    const { stars, links, font } = this._layout(index);
    const ctx = this.ctx;
    const { star: STAR, core: CORE, label: LABEL } = this.theme;
    const still = this.opts.reduceMotion;
    const words = line.words;
    const appear = (k) => (mode === 'line' ? line.time : words[k].start);

    let visible = 0;
    while (visible < words.length && (leaving || appear(visible) <= pos)) visible++;
    if (!visible) return;

    // Links first, so stars sit on top of them.
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    // Each link draws from the older star to the new one as the new word appears.
    for (const { from, to } of links) {
      if (to >= visible) continue;
      const a = stars[from];
      const b = stars[to];
      const start = mode === 'line' ? line.time + to * 35 : appear(to);
      const p = leaving ? 1 : easeOut(clamp((pos - start) / LINK_MS, 0, 1));
      if (p <= 0) continue;
      // Reduce motion: links fade in place instead of drawing across.
      const reach = still ? 1 : p;
      ctx.strokeStyle = rgba(STAR, 0.38 * alpha * (still ? p : 1));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * reach, a.y + (b.y - a.y) * reach);
      ctx.stroke();
    }

    for (let k = 0; k < visible; k++) {
      const s = stars[k];
      const t = pos - appear(k);
      // Emphasis: 1 while the word is being sung, decaying once the next word starts.
      let e;
      if (mode === 'line') e = 0.45;
      else {
        const handoff = k + 1 < words.length ? words[k + 1].start : Math.max(words[k].end, words[k].start + 600);
        e = pos < handoff ? 1 : clamp(1 - (pos - handoff) / EMPHASIS_DECAY_MS, 0, 1);
      }
      if (leaving) e *= 0.5;
      const pop = leaving || still ? 1 : 1 + 0.55 * Math.exp(-Math.max(0, t) / 90);
      const r = font * (0.22 + 0.38 * e) * pop;
      const bright = (0.5 + 0.5 * e) * alpha;

      const gs = r * (5 + 4 * e);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(bright * (0.45 + 0.55 * e), 0, 1);
      ctx.drawImage(this.glow, s.x - gs / 2, s.y - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = rgba(CORE, bright);
      sparklePath(ctx, s.x, s.y, r * 1.6);
      ctx.fill();
      ctx.fillStyle = rgba(CENTER, bright);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.8, r * 0.22), 0, Math.PI * 2);
      ctx.fill();

      const bold = e > 0.5;
      ctx.font = `${bold ? 600 : 400} ${font * (0.9 + 0.12 * e)}px ${this.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = s.labelBelow ? 'top' : 'bottom';
      ctx.fillStyle = rgba(LABEL, (0.45 + 0.55 * e) * alpha);
      const off = font * 0.9;
      ctx.fillText(words[k].text, s.x, s.labelBelow ? s.y + off : s.y - off);
    }
  }
}
