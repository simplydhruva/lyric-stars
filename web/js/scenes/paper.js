// Paper: a light scene. A cream sheet (full screen; in the overlay only a card, so the desktop shows around it)
// and dark ink written by the pen as each word is sung. Older lines go greyer. The page chrome is switched to
// light-on-cream colours in styles.css while this scene is active. Pure function of the playback position.
import { createFitCache } from './line-draw.js';
import { drawInkLine } from './ink.js';
import { clamp, inkAlpha, rgba } from './motion.js';

const FAMILY = '"Segoe Script", "Ink Free", "Lucida Handwriting", "Segoe UI", cursive';
const fontOf = (px) => `400 ${px}px ${FAMILY}`;
const PAPER = [244, 236, 217];
const INK = [38, 34, 52];

export function createPaper() {
  let ctx = null;
  const cache = createFitCache(() => ctx, { weight: 400, family: () => FAMILY });

  return {
    id: 'paper',
    name: 'Paper',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos, displayMode } = frame;
      const quiet = frame.quiet ? 0.5 : 1;
      let x = 0;
      let y = 0;
      let pw = w;
      let ph = h;
      if (displayMode === 'overlay') {
        pw = w * 0.94;
        ph = h * 0.9;
        x = (w - pw) / 2;
        y = (h - ph) / 2;
      }
      ctx.save();
      ctx.globalAlpha = quiet;
      ctx.fillStyle = rgba(PAPER, 1);
      ctx.fillRect(x, y, pw, ph);
      // ruled lines and a margin
      ctx.strokeStyle = 'rgba(96,120,170,0.16)';
      ctx.lineWidth = 1;
      const step = clamp(h * 0.075, 26, 70);
      ctx.beginPath();
      for (let ly = y + step * 1.5; ly < y + ph; ly += step) {
        ctx.moveTo(x, ly);
        ctx.lineTo(x + pw, ly);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190,80,80,0.2)';
      ctx.beginPath();
      ctx.moveTo(x + pw * 0.07, y);
      ctx.lineTo(x + pw * 0.07, y + ph);
      ctx.stroke();
      ctx.restore();
      if (index < 0) return;

      const baseFont = clamp(Math.min(pw, ph * 1.6) * 0.066, 22, 80);
      const maxW = pw * 0.78;
      cache.check(frame, baseFont, maxW);
      const since = pos - lines[index].time;
      const midY = y + ph * 0.5;
      const cur = lines[index].words.length ? cache.fit(frame, index, baseFont, maxW) : null;
      if (index > 0 && lines[index - 1].words.length) {
        const f = cache.fit(frame, index - 1, baseFont, maxW);
        const yy = midY - ((cur ? cur.height : baseFont) / 2 + f.height * 0.31 + baseFont * 0.5);
        drawInkLine(ctx, frame, index - 1, f, { y: yy, scale: 0.62, alpha: 0.42 * quiet, ink: INK, fontOf });
      }
      if (cur) drawInkLine(ctx, frame, index, cur, { y: midY, alpha: Math.max(inkAlpha(since), 0.55) * quiet, ink: INK, pen: [160, 60, 60], fontOf });
    },
  };
}
