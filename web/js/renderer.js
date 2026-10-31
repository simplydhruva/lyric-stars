// Constellation renderer. Everything drawn is a pure function of the playback
// position, so seeking, pausing and resuming never leave stale animation behind.
import { lineIndexAt } from './lyrics/lrc.js';

const GOLD = [244, 199, 107];
const LABEL = [241, 217, 160];
const FADE_OUT_MS = 700;
const LINK_MS = 250;
const QUIET_AFTER_MS = 3500; // silence after a line before the sky starts to quiet
const QUIET_FADE_MS = 2000;
const QUIET_ALPHA = 0.12;
const EMPHASIS_DECAY_MS = 450;
const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 7), 61 | s) ^ s;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    this.glow = makeGlowSprite(GOLD);
    this.timeline = null;
    this.layouts = new Map();
    this.size = { w: 0, h: 0, dpr: 0 };
    this.lastFrameKey = '';
  }

  setTimeline(timeline) {
    this.timeline = timeline;
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

  // Stable layout for one line: same text and size always give the same sky.
  _layout(index) {
    let layout = this.layouts.get(index);
    if (layout) return layout;
    const line = this.timeline[index];
    const { w, h } = this.size;
    const ctx = this.ctx;
    const n = line.words.length;
    let font = clamp(Math.min(w, h * 1.6) * 0.03, 14, 34);
    const marginX = Math.max(24, w * 0.06);
    const maxRow = w - marginX * 2;

    let widths, rows;
    for (let attempt = 0; attempt < 6; attempt++) {
      ctx.font = `600 ${font}px ${FONT}`;
      widths = line.words.map((wd) => ctx.measureText(wd.text).width);
      const gap = font * 1.5;
      const rowWidth = (from, to) =>
        widths.slice(from, to).reduce((a, b) => a + b, 0) + gap * Math.max(0, to - from - 1);
      const total = rowWidth(0, n);
      if (total <= maxRow && n <= 9) {
        rows = [[0, n]];
      } else {
        // Two rows, split where the wider row is narrowest.
        let best = 1;
        let bestW = Infinity;
        for (let s = 1; s < n; s++) {
          const m = Math.max(rowWidth(0, s), rowWidth(s, n));
          if (m < bestW) {
            bestW = m;
            best = s;
          }
        }
        rows = n > 1 ? [[0, best], [best, n]] : [[0, n]];
      }
      const widest = Math.max(...rows.map(([a, b]) => rowWidth(a, b)));
      if (widest <= maxRow || font <= 10 || attempt === 5) {
        layout = { font, gap, rows, rowWidth };
        break;
      }
      font = Math.max(10, font * (maxRow / widest) * 0.97);
    }

    const rand = rng(hash(line.text));
    const rowGap = rows.length === 2 ? clamp(h * 0.16, font * 5, font * 8) : 0;
    const ampMax = rows.length === 2 ? Math.max(font * 0.3, (rowGap - font * 4.2) / 2) : h * 0.09;
    const amp = Math.min(ampMax, h * 0.09, font * 3);
    const stars = [];
    rows.forEach(([a, b], r) => {
      const rowY = h / 2 + (rows.length === 2 ? (r === 0 ? -rowGap / 2 : rowGap / 2) : 0);
      const phase = rand() * Math.PI * 2;
      const freq = 0.9 + rand() * 0.9;
      let x = (w - layout.rowWidth(a, b)) / 2;
      for (let k = a; k < b; k++) {
        const cx = x + widths[k] / 2;
        const dy = amp * (0.75 * Math.sin(phase + (k - a) * freq) + 0.25 * (rand() * 2 - 1));
        const y = clamp(rowY + dy, font * 3, h - font * 3);
        stars.push({ x: cx, y, row: r, labelBelow: dy > 0 });
        x += widths[k] + layout.gap;
      }
    });
    layout = { ...layout, stars };
    this.layouts.set(index, layout);
    return layout;
  }

  // Returns false when nothing changed and the frame was skipped.
  draw(pos, { mode = 'word', playing = true, quiet = false } = {}) {
    const resized = this._resize();
    const { w, h, dpr } = this.size;
    const frameKey = `${Math.round(pos)}|${mode}|${quiet}|${w}x${h}@${dpr}`;
    if (!resized && !playing && frameKey === this.lastFrameKey) return false;
    this.lastFrameKey = frameKey;

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
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
    const { stars, font } = this._layout(index);
    const ctx = this.ctx;
    const words = line.words;
    const appear = (k) => (mode === 'line' ? line.time : words[k].start);

    let visible = 0;
    while (visible < words.length && (leaving || appear(visible) <= pos)) visible++;
    if (!visible) return;

    // Links first, so stars sit on top of them.
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (let k = 1; k < visible; k++) {
      const a = stars[k - 1];
      const b = stars[k];
      if (a.row !== b.row) continue;
      const start = mode === 'line' ? line.time + k * 35 : appear(k);
      const p = leaving ? 1 : easeOut(clamp((pos - start) / LINK_MS, 0, 1));
      if (p <= 0) continue;
      ctx.strokeStyle = rgba(GOLD, 0.38 * alpha);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p);
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
      const pop = leaving ? 1 : 1 + 0.55 * Math.exp(-Math.max(0, t) / 90);
      const r = font * (0.22 + 0.38 * e) * pop;
      const bright = (0.5 + 0.5 * e) * alpha;

      const gs = r * (5 + 4 * e);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(bright * (0.45 + 0.55 * e), 0, 1);
      ctx.drawImage(this.glow, s.x - gs / 2, s.y - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = rgba([255, 236, 190], bright);
      sparklePath(ctx, s.x, s.y, r * 1.6);
      ctx.fill();
      ctx.fillStyle = rgba([255, 250, 235], bright);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.8, r * 0.22), 0, Math.PI * 2);
      ctx.fill();

      const bold = e > 0.5;
      ctx.font = `${bold ? 600 : 400} ${font * (0.9 + 0.12 * e)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = s.labelBelow ? 'top' : 'bottom';
      ctx.fillStyle = rgba(LABEL, (0.45 + 0.55 * e) * alpha);
      const off = font * 0.9;
      ctx.fillText(words[k].text, s.x, s.labelBelow ? s.y + off : s.y - off);
    }
  }
}
