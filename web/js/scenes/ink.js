// Shared by the handwriting and paper scenes: one line written by a pen. Each word is written between its start and
// end times, left to right: the pen traces the letters' outlines (a dash that grows along each outline), and the ink
// fills in just behind it. The fonts on a PC have no pen-centre stroke paths, so this traces outlines, which works for
// every font and script. A glowing pen tip rides the traced edge; the outline and tip are there from the first instant
// of the word, so the word shows up exactly when it is sung.
import { LINE_HEIGHT } from './karaoke-layout.js';
import { penState, rgba, shownAt, written } from './motion.js';

// f: the line's fit { font, rows, offsets, widths, height }. fontOf(px) gives the CSS font for a size.
// ink, glow, pen: [r, g, b] colours (glow and pen may be null).
export function drawInkLine(ctx, frame, index, f, { y, scale = 1, alpha = 1, ink, glow = null, pen = null, fontOf }) {
  if (alpha <= 0.004 || !f.rows.length) return;
  const { pos, mode, reduceMotion } = frame;
  const line = frame.lines[index];
  ctx.save();
  ctx.translate(frame.w / 2, y);
  ctx.scale(scale, scale);
  ctx.font = fontOf(f.font);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const rowH = f.font * LINE_HEIGHT;
  const top = -f.height / 2;
  const pad = f.font * 0.18; // slanted and swashy letters reach past their measured box
  const tips = [];
  f.rows.forEach((row, r) => {
    const cy = top + (r + 0.5) * rowH;
    const left = -row.width / 2;
    for (let i = row.from; i < row.to; i++) {
      const word = line.words[i];
      const x = left + f.offsets[i];
      let frac;
      if (index < frame.index) frac = 1;
      else if (index > frame.index) frac = 0;
      else frac = written(word, pos, reduceMotion, mode, line);
      const start = shownAt(word, line, mode);
      const live = index === frame.index && pos >= start && frac < 1;
      const pen_ = penState(frac, f.widths[i], f.font, reduceMotion || mode === 'line' || !live);
      if (frac > 0 || live) {
        // the ink, filled up to where the pen has been (a little behind the tip)
        if (pen_.fillW > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - pad, cy - rowH / 2, pen_.fillW + pad * (pen_.fillW >= f.widths[i] ? 2 : 1), rowH);
          ctx.clip();
          if (glow) {
            ctx.shadowColor = rgba(glow, 0.75 * alpha);
            ctx.shadowBlur = f.font * 0.3 * ((frame.glow ?? 0.25) * 2);
          }
          ctx.fillStyle = rgba(ink, alpha);
          ctx.fillText(word.text, x, cy);
          ctx.restore();
        }
        // the outline, traced by the pen just ahead of the ink: a dash that grows along each letter's outline
        if (pen_.tracing && pen_.traceW > pen_.fillW) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + pen_.fillW - f.font * 0.12, cy - rowH / 2, pen_.traceW - pen_.fillW + f.font * 0.12, rowH);
          ctx.clip();
          ctx.lineWidth = Math.max(1, f.font * 0.028);
          ctx.lineJoin = 'round';
          ctx.setLineDash([pen_.dash, f.font * 24]);
          ctx.strokeStyle = rgba(pen || ink, 0.9 * alpha);
          ctx.strokeText(word.text, x, cy);
          ctx.restore();
        }
      }
      if (pen && live && mode !== 'line' && !reduceMotion) {
        // the pen tip rides the traced edge and dips and rises a little, like a hand writing
        const tx = x + pen_.traceW;
        tips.push({ x: tx, y: cy + f.font * 0.1 + Math.sin(tx / (f.font * 0.35)) * f.font * 0.12 });
      }
    }
  });
  for (const tip of tips) {
    const r = f.font * 0.34;
    const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r);
    g.addColorStop(0, rgba(pen, 0.95 * alpha));
    g.addColorStop(1, rgba(pen, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
