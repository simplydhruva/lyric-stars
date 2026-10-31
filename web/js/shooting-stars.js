// Shooting stars: a short streak crosses the sky in the gap after a line ends. Which gaps get one, and where it
// flies, come only from the line number and the playback position (never the wall clock), so seeking and pausing
// can't leave one behind. It is drawn behind the lyrics, dim and short, and never in a gap shorter than MIN_GAP_MS.
import { clamp, hash, lift, rgba } from './scenes/motion.js';

export const STAR_MS = 1100; // how long one streak lasts
export const MIN_GAP_MS = 400; // no streak when the next line follows this closely
const LONG_GAP_MS = 2500; // a gap this long always gets one; shorter ones get one about every other time
const DELAY_MS = 120; // after the line ends

// The streaks to draw at `pos`: [{ x0, y0, x1, y1, head, tail, alpha }]. `index` is the current line.
export function streaksAt(lines, index, pos, w, h) {
  const out = [];
  for (let i = Math.max(0, index - 1); i <= index && i < lines.length - 1; i++) {
    const line = lines[i];
    if (!line.words.length) continue;
    const gap = lines[i + 1].time - line.end;
    if (!(gap >= MIN_GAP_MS) || (gap < LONG_GAP_MS && hash(i, 11) >= 0.5)) continue;
    const p = (pos - (line.end + DELAY_MS)) / STAR_MS;
    if (p < 0 || p > 1) continue;
    const dir = hash(i, 3) < 0.5 ? 1 : -1;
    const slope = 0.3 + 0.3 * hash(i, 4);
    const x0 = w * (dir > 0 ? 0.04 + 0.4 * hash(i, 5) : 0.56 + 0.4 * hash(i, 5));
    const y0 = h * (0.04 + 0.3 * hash(i, 6));
    const reach = w * (0.3 + 0.25 * hash(i, 7));
    const head = Math.pow(p, 0.8);
    out.push({
      x0,
      y0,
      x1: x0 + dir * Math.cos(slope) * reach,
      y1: y0 + Math.sin(slope) * reach,
      head,
      tail: Math.max(0, head - 0.28),
      alpha: Math.pow(Math.sin(Math.PI * p), 0.8) * 0.85,
    });
  }
  return out;
}

export function drawShootingStars(ctx, streaks, theme, quiet) {
  for (const s of streaks) {
    const hx = s.x0 + (s.x1 - s.x0) * s.head;
    const hy = s.y0 + (s.y1 - s.y0) * s.head;
    const tx = s.x0 + (s.x1 - s.x0) * s.tail;
    const ty = s.y0 + (s.y1 - s.y0) * s.tail;
    const a = clamp(s.alpha, 0, 1) * (quiet ? 0.4 : 1);
    const g = ctx.createLinearGradient(tx, ty, hx, hy);
    g.addColorStop(0, rgba(theme.star, 0));
    g.addColorStop(1, rgba(lift(theme.star, 0.6), a));
    ctx.save();
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = rgba(lift(theme.star, 0.85), a);
    ctx.beginPath();
    ctx.arc(hx, hy, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
