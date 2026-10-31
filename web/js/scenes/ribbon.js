// Ribbon: the line rides a flowing wave. The wave is livelier for fast lines and for choruses (the pace of the
// words, not the audio: Lyric Stars has no access to the sound). Words up to the one being sung are lit; the rest
// are dim. Pure function of the playback position.
import { createFitCache } from './line-draw.js';
import { LINE_HEIGHT } from './karaoke-layout.js';
import { clamp, lift, lineEnergy, mix, rgba, shownAt, waveY } from './motion.js';

export function createRibbon() {
  let ctx = null;
  const cache = createFitCache(() => ctx, { maxRows: 2 });

  function ribbonPath(w, midY, pos, amp) {
    ctx.beginPath();
    for (let k = 0; k <= 48; k++) {
      const t = k / 48;
      const px = t * w;
      const py = midY + waveY(t, pos, amp);
      if (k) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
  }

  return {
    id: 'ribbon',
    name: 'Ribbon',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos, theme, mode, reduceMotion } = frame;
      if (index < 0) return;
      const line = lines[index];
      const quiet = frame.quiet ? 0.35 : 1;
      const chorus = !!frame.songMap?.[index]?.chorus;
      const energy = line.words.length ? lineEnergy(line, chorus) : 0;
      const amp = (reduceMotion ? 0.3 : 1) * h * (0.03 + 0.07 * energy);
      const midY = h * 0.5;
      const at = reduceMotion ? 0 : pos;
      for (const [width, a] of [[h * 0.012, 0.1], [h * 0.004, 0.35]]) {
        ctx.lineWidth = width;
        ctx.strokeStyle = rgba(theme.star, a * quiet);
        ribbonPath(w, midY, at, amp);
        ctx.stroke();
      }
      if (!line.words.length) return;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.06, 22, 72);
      const maxW = w * 0.84;
      cache.check(frame, baseFont, maxW);
      const f = cache.fit(frame, index, baseFont, maxW);
      const rowH = f.font * LINE_HEIGHT;
      ctx.save();
      ctx.font = `600 ${f.font}px ${frame.fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const lit = lift(theme.star, 0.3);
      f.rows.forEach((row, r) => {
        const rowY = midY - f.height / 2 + (r + 0.5) * rowH + (f.rows.length > 1 ? 0 : -f.font * 1.1);
        for (let i = row.from; i < row.to; i++) {
          const word = line.words[i];
          const cx = w / 2 - row.width / 2 + f.offsets[i] + f.widths[i] / 2;
          const t = cx / w;
          const wy = waveY(t, at, amp);
          const slope = (waveY(t + 0.01, at, amp) - wy) / (w * 0.01);
          const on = shownAt(word, line, mode) <= pos;
          ctx.save();
          ctx.translate(cx, rowY + wy);
          ctx.rotate(Math.atan(slope) * 0.8);
          ctx.shadowColor = rgba(theme.star, 0.8);
          ctx.shadowBlur = on ? f.font * 0.35 : 0;
          ctx.fillStyle = rgba(on ? lit : mix(theme.label, [0, 0, 0], 0.35), (on ? 1 : 0.55) * quiet);
          ctx.textAlign = 'center';
          ctx.fillText(word.text, 0, 0);
          ctx.restore();
        }
      });
      ctx.restore();
    },
  };
}
