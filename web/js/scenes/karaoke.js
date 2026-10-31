// Karaoke scene: lines sit centered; a gold fill sweeps across each word between its start and end
// times. The line before and the line after are faint above and below. Like every scene, it is a pure
// function of the playback position, so seeking and pausing never leave anything stale behind.
import { fitLine, LINE_HEIGHT, SLOT_PAD, slideProgress, slotAlpha, slotCentres, slotOf, slotScale, slotY, sweepFraction } from './karaoke-layout.js';

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lift = ([r, g, b], k) => [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k].map(Math.round);

const OFFSETS = [-2, -1, 0, 1]; // lines drawn, relative to the current one

export function createKaraoke() {
  let ctx = null;
  const fits = new Map();
  let fitKey = null;

  function fit(frame, index, baseFont, maxW) {
    let f = fits.get(index);
    if (!f) {
      const line = frame.lines[index];
      f = fitLine(
        line.words.map((x) => x.text),
        (text, font) => {
          ctx.font = `600 ${font}px ${frame.fontFamily}`;
          return ctx.measureText(text).width;
        },
        { maxW, baseFont }
      );
      fits.set(index, f);
    }
    return f;
  }

  function checkCache(frame, baseFont, maxW) {
    const key = [frame.w, frame.h, frame.fontFamily, baseFont, maxW];
    if (fitKey && fitKey.lines === frame.lines && fitKey.key.every((v, i) => v === key[i])) return;
    fits.clear();
    fitKey = { lines: frame.lines, key };
  }

  // One line of the stack at fractional slot s. `current` lines fill word by word; the others are flat.
  function drawLine(frame, index, f, s, y, current) {
    const { pos, theme, reduceMotion } = frame;
    const line = frame.lines[index];
    const scale = slotScale(s);
    const a = slotAlpha(s) * (frame.quiet ? 0.35 : 1);
    if (a <= 0.004 || !f.rows.length) return;
    const near = clamp(1 - Math.abs(s), 0, 1); // 1 in the middle, 0 a slot away
    const fillColor = lift(theme.star, 0.18);
    const baseAlpha = a * (0.9 - 0.35 * near); // unsung text, dimmer in the middle so the fill stands out

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

        // The gold fill: lines before the current one are fully sung; the stack fades the fill out as they move away.
        let fraction;
        if (index > frame.index) fraction = 0;
        else if (index < frame.index) fraction = 1;
        else fraction = frame.mode === 'line' ? 1 : sweepFraction(word, pos, reduceMotion);
        const fillAlpha = current ? a : a * near;
        if (fraction > 0 && fillAlpha > 0.004) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, cy - rowH / 2, f.widths[i] * fraction, rowH);
          ctx.clip();
          ctx.fillStyle = rgba(fillColor, fillAlpha);
          ctx.fillText(word.text, x, cy);
          ctx.restore();
        }
      }
    });
    ctx.restore();
  }

  return {
    id: 'karaoke',
    name: 'Karaoke',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      fits.clear();
      fitKey = null;
    },
    draw(frame) {
      const { lines, index, w, h, pos } = frame;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.062, 22, 72);
      const maxW = w * 0.86;
      checkCache(frame, baseFont, maxW);

      const cur = index >= 0 ? lines[index] : null;
      // Before the first line there is nothing to slide from.
      const t = cur ? slideProgress(pos - cur.time, frame.reduceMotion) : 1;

      const items = OFFSETS.map((o) => {
        const i = index + o;
        if (i < 0 || i >= lines.length || !lines[i].words.length) return { i, f: null, height: 0 };
        const f = fit(frame, i, baseFont, maxW);
        return { i, f, height: f.height * slotScale(o) };
      });
      const centres = slotCentres(items.map((it) => it.height), baseFont * SLOT_PAD);
      const mid = h / 2;
      OFFSETS.forEach((o, k) => {
        const it = items[k];
        if (!it.f) return;
        const s = slotOf(o, t);
        drawLine(frame, it.i, it.f, s, mid + slotY(s, centres), o === 0);
      });
    },
  };
}
