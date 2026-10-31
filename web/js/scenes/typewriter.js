// Typewriter: letterbox bars like a film, a monospace line typed out as it is sung, a block cursor that stays
// solid while typing and then blinks on the song clock. Pure function of the playback position.
import { createFitCache } from './line-draw.js';
import { LINE_HEIGHT } from './karaoke-layout.js';
import { clamp, cursorOn, lift, rgba, shownAt, typedChars } from './motion.js';

const FAMILY = '"Cascadia Mono", Consolas, "Courier New", monospace';

export function createTypewriter() {
  let ctx = null;
  const cache = createFitCache(() => ctx, { weight: 500, family: () => FAMILY });

  return {
    id: 'typewriter',
    name: 'Typewriter',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos, theme, mode, reduceMotion } = frame;
      const bar = h * 0.12;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
      if (index < 0) return;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.05, 18, 64);
      const maxW = w * 0.82;
      cache.check(frame, baseFont, maxW);
      const quiet = frame.quiet ? 0.35 : 1;
      const line = lines[index];
      if (!line.words.length) return;
      const f = cache.fit(frame, index, baseFont, maxW);
      const rowH = f.font * LINE_HEIGHT;
      const midY = h / 2;
      ctx.save();
      ctx.font = `500 ${f.font}px ${FAMILY}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const ink = lift(theme.star, 0.3);
      let tip = null;
      f.rows.forEach((row, r) => {
        const cy = midY - f.height / 2 + (r + 0.5) * rowH;
        for (let i = row.from; i < row.to; i++) {
          const word = line.words[i];
          const n = typedChars(word.text.length, shownAt(word, line, mode), word.end, pos, reduceMotion, mode === 'line');
          if (n <= 0) continue;
          const x = w / 2 - row.width / 2 + f.offsets[i];
          ctx.fillStyle = rgba(ink, quiet);
          ctx.fillText(word.text.slice(0, n), x, cy);
          const ex = x + ctx.measureText(word.text.slice(0, n)).width;
          if (!tip || cy >= tip.y) tip = { x: ex, y: cy, since: pos - shownAt(word, line, mode) };
        }
      });
      if (tip) {
        const on = reduceMotion || cursorOn(tip.since, pos);
        if (on) {
          ctx.fillStyle = rgba(theme.star, 0.85 * quiet);
          ctx.fillRect(tip.x + f.font * 0.08, tip.y - f.font * 0.5, f.font * 0.55, f.font);
        }
      }
      ctx.restore();
    },
  };
}
