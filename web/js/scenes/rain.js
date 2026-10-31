// Rain: every word falls from the top of the screen when it is sung and lands in its place in the line, with a
// small rebound and a glow. When the next line starts, the old words fall on through the floor. A few faint
// streaks of rain keep the sky busy. Pure function of the playback position.
import { createFitCache } from './line-draw.js';
import { LINE_HEIGHT } from './karaoke-layout.js';
import { clamp, easeIn, fallDuration, fallProgress, hash, landBounce, lift, mix, rgba, shownAt } from './motion.js';

const STREAKS = 36;

export function createRain() {
  let ctx = null;
  const cache = createFitCache(() => ctx);

  function streaks(frame) {
    const { w, h, pos, theme } = frame;
    ctx.save();
    ctx.lineWidth = 1;
    for (let k = 0; k < STREAKS; k++) {
      const speed = 0.16 + hash(k, 1) * 0.2; // px per ms
      const len = 14 + hash(k, 2) * 26;
      const y = (((pos * speed + hash(k, 3) * (h + 80)) % (h + 80)) + h + 80) % (h + 80) - 40;
      const x = hash(k, 4) * w;
      ctx.strokeStyle = rgba(theme.star, 0.05 + hash(k, 5) * 0.07);
      ctx.beginPath();
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLine(frame, li, f, ground, exit) {
    const { pos, theme, reduceMotion, mode, h, w } = frame;
    const line = frame.lines[li];
    const rowH = f.font * LINE_HEIGHT;
    const topY = h * 0.06;
    const lit = lift(theme.star, 0.25);
    ctx.save();
    ctx.font = `600 ${f.font}px ${frame.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    f.rows.forEach((row, r) => {
      const cy = ground - f.height / 2 + (r + 0.5) * rowH;
      for (let i = row.from; i < row.to; i++) {
        const word = line.words[i];
        const dt = pos - shownAt(word, line, mode);
        if (dt < 0) continue;
        const dur = fallDuration(li, i);
        const p = fallProgress(dt, dur, reduceMotion);
        const since = dt - dur; // time since landing
        let y = topY + (cy - topY) * p;
        if (!reduceMotion) y += landBounce(since) * f.font;
        let x = w / 2 - row.width / 2 + f.offsets[i] + (reduceMotion ? 0 : (hash(li, i + 50) - 0.5) * f.font * 0.4 * (1 - p));
        let alpha = 0.6 + 0.4 * p;
        if (exit > 0) {
          y += easeIn(exit) * (h - cy + f.font * 2);
          alpha *= 1 - clamp(exit, 0, 1) * 0.8;
        }
        if (!reduceMotion && p < 1) {
          // a faint trail above a falling word
          ctx.strokeStyle = rgba(theme.star, 0.22 * (1 - p));
          ctx.lineWidth = Math.max(1, f.font * 0.05);
          ctx.beginPath();
          ctx.moveTo(x + f.widths[i] / 2, y - f.font * (0.8 + 1.6 * (1 - p)));
          ctx.lineTo(x + f.widths[i] / 2, y - f.font * 0.55);
          ctx.stroke();
        }
        const glow = p >= 1 && !reduceMotion ? clamp(1 - since / 900, 0, 1) : p >= 1 ? 0 : 0;
        ctx.shadowColor = rgba(theme.star, 0.9 * alpha);
        ctx.shadowBlur = f.font * 0.7 * glow * ((frame.glow ?? 0.25) * 2);
        ctx.fillStyle = rgba(mix(theme.label, lit, p >= 1 ? 0.7 + 0.3 * glow : p * 0.5), alpha);
        ctx.fillText(word.text, x, y);
      }
    });
    ctx.restore();
  }

  return {
    id: 'rain',
    name: 'Rain',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos } = frame;
      if (!frame.reduceMotion) streaks(frame);
      if (index < 0) return;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.06, 22, 72);
      const maxW = w * 0.86;
      cache.check(frame, baseFont, maxW);
      const ground = h * 0.56;
      // The line before, falling away through the floor as the new line begins.
      if (index > 0 && lines[index - 1].words.length) {
        const exit = frame.reduceMotion ? 1 : clamp((pos - lines[index].time) / 1500, 0, 1);
        if (exit < 1) drawLine(frame, index - 1, cache.fit(frame, index - 1, baseFont, maxW), ground, Math.max(exit, 0.0001));
      }
      if (lines[index].words.length) drawLine(frame, index, cache.fit(frame, index, baseFont, maxW), ground, 0);
    },
  };
}
