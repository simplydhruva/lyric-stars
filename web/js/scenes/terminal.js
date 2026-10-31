// Terminal: phosphor text on black, in the theme colour (amber with the gold theme). Earlier lines scroll up
// with a "> " prompt, the line being sung appears word by word, and a block cursor blinks on the song clock.
// Faint scanlines run across the screen. Pure function of the playback position.
import { createFitCache } from './line-draw.js';
import { LINE_HEIGHT } from './karaoke-layout.js';
import { clamp, cursorOn, lift, rgba, shownAt } from './motion.js';

const FAMILY = '"Cascadia Mono", Consolas, "Courier New", monospace';
const HISTORY = 4;

export function createTerminal() {
  let ctx = null;
  const cache = createFitCache(() => ctx, { weight: 500, family: () => FAMILY, maxRows: 3 });

  return {
    id: 'terminal',
    name: 'Terminal',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos, theme, mode, reduceMotion } = frame;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
      if (index < 0) return;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.04, 14, 44);
      const maxW = w * 0.78;
      cache.check(frame, baseFont, maxW);
      const quiet = frame.quiet ? 0.35 : 1;
      const left = w * 0.11;
      const phosphor = lift(theme.star, 0.2);
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Work upward from the current line: each earlier line sits above, dimmer.
      const first = Math.max(0, index - HISTORY);
      const fits = [];
      for (let li = first; li <= index; li++) fits.push(lines[li].words.length ? cache.fit(frame, li, baseFont, maxW) : null);
      const gap = baseFont * 0.5;
      let total = 0;
      for (const f of fits) total += (f ? f.height : baseFont * LINE_HEIGHT) + gap;
      let y = h / 2 - total / 2 + (fits[fits.length - 1] ? 0 : 0);
      let tip = null;
      fits.forEach((f, k) => {
        const li = first + k;
        const age = index - li;
        const height = f ? f.height : baseFont * LINE_HEIGHT;
        if (f) {
          const rowH = f.font * LINE_HEIGHT;
          ctx.font = `500 ${f.font}px ${FAMILY}`;
          const a = (age === 0 ? 1 : 0.62 - age * 0.1) * quiet;
          ctx.shadowColor = rgba(theme.star, 0.7 * a);
          ctx.shadowBlur = f.font * 0.35 * ((frame.glow ?? 0.25) * 2);
          f.rows.forEach((row, r) => {
            const cy = y + (r + 0.5) * rowH;
            if (r === 0) {
              ctx.fillStyle = rgba(phosphor, a * 0.7);
              ctx.fillText('>', left - f.font * 1.3, cy);
            }
            for (let i = row.from; i < row.to; i++) {
              const word = lines[li].words[i];
              if (li === index && shownAt(word, lines[li], mode) > pos) continue;
              const x = left + f.offsets[i];
              ctx.fillStyle = rgba(phosphor, a);
              ctx.fillText(word.text, x, cy);
              if (li === index) tip = { x: x + f.widths[i], y: cy, font: f.font, since: pos - shownAt(word, lines[li], mode) };
            }
          });
        }
        y += height + gap;
      });
      if (!tip) {
        const f = fits[fits.length - 1];
        if (f) tip = { x: left, y: y - gap - f.height + (f.font * LINE_HEIGHT) / 2, font: f.font, since: 99999 };
      }
      if (tip && (reduceMotion || cursorOn(tip.since, pos))) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = rgba(phosphor, 0.85 * quiet);
        ctx.fillRect(tip.x + tip.font * 0.35, tip.y - tip.font * 0.5, tip.font * 0.55, tip.font);
      }
      ctx.restore();
    },
  };
}
