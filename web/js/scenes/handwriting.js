// Handwriting: each word is written by a glowing pen as it is sung, then the line rests like ink that slowly
// dims. The line before it hangs above, smaller, and dissolves. Pure function of the playback position.
import { createFitCache } from './line-draw.js';
import { drawInkLine } from './ink.js';
import { clamp, inkAlpha, lift } from './motion.js';

const FAMILY = '"Segoe Script", "Ink Free", "Lucida Handwriting", "Segoe UI", cursive';
const fontOf = (px) => `400 ${px}px ${FAMILY}`;

export function createHandwriting() {
  let ctx = null;
  const cache = createFitCache(() => ctx, { weight: 400, family: () => FAMILY });

  return {
    id: 'handwriting',
    name: 'Handwriting',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos, theme } = frame;
      if (index < 0) return;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.07, 24, 84);
      const maxW = w * 0.84;
      cache.check(frame, baseFont, maxW);
      const quiet = frame.quiet ? 0.35 : 1;
      const since = pos - lines[index].time;
      const ink = lift(theme.star, 0.3);
      const cur = lines[index].words.length ? cache.fit(frame, index, baseFont, maxW) : null;
      const midY = h * 0.48;

      // The previous line, smaller, above; it dissolves over the first 2.5 s of the new line.
      if (index > 0 && lines[index - 1].words.length) {
        const a = (frame.reduceMotion ? 0.3 : (1 - clamp(since / 2500, 0, 1)) * 0.35) * quiet;
        if (a > 0.004) {
          const f = cache.fit(frame, index - 1, baseFont, maxW);
          const y = midY - ((cur ? cur.height : baseFont) / 2 + f.height * 0.31 + baseFont * 0.5);
          drawInkLine(ctx, frame, index - 1, f, { y, scale: 0.62, alpha: a, ink, fontOf });
        }
      }
      if (cur) drawInkLine(ctx, frame, index, cur, { y: midY, alpha: inkAlpha(since) * quiet, ink, glow: theme.star, pen: theme.core || lift(theme.star, 0.7), fontOf });
    },
  };
}
