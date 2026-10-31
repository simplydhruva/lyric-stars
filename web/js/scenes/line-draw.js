// Shared by the scenes that show whole lines of text (karaoke and the scrolling stack):
// a cache of how each line wraps, and the drawing of one line with its gold fill.
import { fitLine, LINE_HEIGHT, sweepFraction } from './karaoke-layout.js';
import { drawEmotion } from './emotion.js';

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lift = ([r, g, b], k) => [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k].map(Math.round);

// Wrapping a line means measuring text, which is slow, so it is done once per line and kept until
// the lines, the size or the font change. getCtx() gives the context to measure with.
// opts: { weight, family(frame), maxRows } to wrap in another font (a typewriter face, say).
export function createFitCache(getCtx, opts = {}) {
  const fits = new Map();
  let key = null;
  return {
    clear() {
      fits.clear();
      key = null;
    },
    // Call once per frame before fit(): drops everything if anything the wrapping depends on changed.
    check(frame, baseFont, maxW) {
      const next = [frame.w, frame.h, frame.fontFamily, baseFont, maxW];
      if (key && key.lines === frame.lines && key.values.every((v, i) => v === next[i])) return;
      fits.clear();
      key = { lines: frame.lines, values: next };
    },
    fit(frame, index, baseFont, maxW) {
      let f = fits.get(index);
      if (!f) {
        const ctx = getCtx();
        f = fitLine(
          frame.lines[index].words.map((x) => x.text),
          (text, font) => {
            ctx.font = `${opts.weight ?? 600} ${font}px ${opts.family ? opts.family(frame) : frame.fontFamily}`;
            return ctx.measureText(text).width;
          },
          { maxW, baseFont, maxRows: opts.maxRows }
        );
        fits.set(index, f);
      }
      return f;
    },
  };
}

// Draws line `index` centred at (w/2, y). `scale` and `alpha` come from its place in the stack; `near` is
// 1 in the middle and 0 a slot away. The current line fills word by word (or all at once in line mode);
// earlier lines are fully filled and later ones not at all. Fills of non-current lines fade with `near`.
export function drawFilledLine(ctx, frame, index, f, { y, scale, alpha, near, current }) {
  const { pos, theme, reduceMotion } = frame;
  if (alpha <= 0.004 || !f.rows.length) return;
  const line = frame.lines[index];
  const fillColor = lift(theme.star, 0.18);
  const baseAlpha = alpha * (0.9 - 0.35 * clamp(near, 0, 1)); // unsung text, dimmer in the middle so the fill stands out

  ctx.save();
  ctx.translate(frame.w / 2, y);
  ctx.scale(scale, scale);
  ctx.font = `600 ${f.font}px ${frame.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const rowH = f.font * LINE_HEIGHT;
  const top = -f.height / 2;
  f.rows.forEach((row, r) => {
    const cy = top + (r + 0.5) * rowH;
    const left = -row.width / 2;
    for (let i = row.from; i < row.to; i++) {
      const word = line.words[i];
      const x = left + f.offsets[i];
      ctx.fillStyle = rgba(theme.label, baseAlpha);
      ctx.fillText(word.text, x, cy);

      let fraction;
      if (index > frame.index) fraction = 0;
      else if (index < frame.index) fraction = 1;
      else fraction = frame.mode === 'line' ? 1 : sweepFraction(word, pos, reduceMotion);
      const fillAlpha = current ? alpha : alpha * clamp(near, 0, 1);
      if (fraction > 0 && fillAlpha > 0.004) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, cy - rowH / 2, f.widths[i] * fraction, rowH);
        ctx.clip();
        ctx.fillStyle = rgba(fillColor, fillAlpha);
        ctx.fillText(word.text, x, cy);
        ctx.restore();
      }
      // a coloured glow on emotion words, from the word's own start (the sweep may still be partway across it)
      if (fraction > 0 && fillAlpha > 0.004) {
        const since = pos - (frame.mode === 'line' ? line.time : word.start);
        drawEmotion(ctx, frame, word.text, since, index * 31 + i, f.font, fillAlpha, () => ctx.fillText(word.text, x, cy));
      }
    }
  });
  ctx.restore();
}
