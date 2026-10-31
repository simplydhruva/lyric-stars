// Neon sign: the line is a row of glass tubes. Unlit tubes are a faint outline; each word buzzes on with a short
// flicker when it is sung and then burns steady, with a soft glow on the wall behind. The previous line stays up
// above, switched off. Pure function of the playback position.
import { createFitCache } from './line-draw.js';
import { drawEmotion } from './emotion.js';
import { LINE_HEIGHT } from './karaoke-layout.js';
import { clamp, lift, neonFlicker, rgba, shownAt } from './motion.js';

export function createNeon() {
  let ctx = null;
  const cache = createFitCache(() => ctx, { weight: 700 });

  function tubes(frame, li, f, y, scale, switchedOn, alpha) {
    const { pos, theme, reduceMotion, mode } = frame;
    const line = frame.lines[li];
    const rowH = f.font * LINE_HEIGHT;
    ctx.save();
    ctx.translate(frame.w / 2, y);
    ctx.scale(scale, scale);
    ctx.font = `700 ${f.font}px ${frame.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    f.rows.forEach((row, r) => {
      const cy = -f.height / 2 + (r + 0.5) * rowH;
      for (let i = row.from; i < row.to; i++) {
        const word = line.words[i];
        const x = -row.width / 2 + f.offsets[i];
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(1, f.font * 0.035);
        ctx.strokeStyle = rgba(theme.label, 0.16 * alpha);
        ctx.strokeText(word.text, x, cy);
        if (!switchedOn(word)) continue;
        const dt = pos - shownAt(word, line, mode);
        const on = neonFlicker(dt, li * 31 + i, reduceMotion || li !== frame.index) * alpha;
        ctx.shadowColor = rgba(theme.star, 0.95 * on);
        ctx.shadowBlur = f.font * 0.55;
        ctx.lineWidth = f.font * 0.075;
        ctx.strokeStyle = rgba(theme.star, 0.9 * on);
        ctx.strokeText(word.text, x, cy);
        ctx.shadowBlur = 0;
        ctx.lineWidth = f.font * 0.03;
        ctx.strokeStyle = rgba(lift(theme.star, 0.8), on);
        ctx.strokeText(word.text, x, cy);
        drawEmotion(ctx, frame, word.text, dt, li * 31 + i, f.font, on, () => {
          ctx.lineWidth = f.font * 0.05;
          ctx.strokeText(word.text, x, cy);
        });
      }
    });
    ctx.restore();
  }

  return {
    id: 'neon',
    name: 'Neon sign',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos, theme, mode } = frame;
      if (index < 0) return;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.075, 26, 92);
      const maxW = w * 0.84;
      cache.check(frame, baseFont, maxW);
      const quiet = frame.quiet ? 0.35 : 1;
      const line = lines[index];
      const midY = h * 0.5;
      const cur = line.words.length ? cache.fit(frame, index, baseFont, maxW) : null;
      const sung = cur ? line.words.filter((x) => shownAt(x, line, mode) <= pos).length / line.words.length : 0;
      // the glow on the wall grows as more of the line lights up
      const wall = ctx.createRadialGradient(w / 2, midY, 0, w / 2, midY, Math.max(w, h) * 0.6);
      wall.addColorStop(0, rgba(theme.star, (0.06 + 0.08 * sung) * quiet));
      wall.addColorStop(1, rgba(theme.star, 0));
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, w, h);

      if (index > 0 && lines[index - 1].words.length) {
        const f = cache.fit(frame, index - 1, baseFont, maxW);
        const y = midY - ((cur ? cur.height : baseFont) / 2 + f.height * 0.3 + baseFont * 0.5);
        tubes(frame, index - 1, f, y, 0.6, () => false, 0.7 * quiet);
      }
      if (cur) tubes(frame, index, cur, midY, 1, (word) => shownAt(word, line, mode) <= pos, quiet);
    },
  };
}
