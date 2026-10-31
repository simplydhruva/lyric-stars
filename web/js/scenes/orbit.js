// Orbit: the words of the line circle the album cover like moons. The ring turns to bring the word being sung to
// the front; words on the far side are smaller and dimmer and pass behind the cover. With no cover (or before it
// loads) a glowing disc takes its place. Pure function of the playback position.
import { artImage, drawCover } from './art.js';
import { clamp, lift, mix, orbitCentre, orbitSpot, rgba, shownAt } from './motion.js';

export function createOrbit() {
  let ctx = null;

  function cover(frame, cx, cy, r) {
    const { theme } = frame;
    const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.8);
    glow.addColorStop(0, rgba(theme.star, 0.3));
    glow.addColorStop(1, rgba(theme.star, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
    const img = artImage(frame.art);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (img) drawCover(ctx, img, cx - r, cy - r, r * 2, r * 2);
    else {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
      g.addColorStop(0, rgba(lift(theme.star, 0.5), 1));
      g.addColorStop(1, rgba(mix(theme.star, [0, 0, 0], 0.6), 1));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.strokeStyle = rgba(theme.star, 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function words(frame, spots, cx, cy, rx, ry, size, front) {
    const { theme, mode, pos, quiet } = frame;
    const line = frame.lines[frame.index];
    for (const s of spots) {
      if ((s.depth >= 0.5) !== front) continue;
      const word = line.words[s.i];
      const sung = shownAt(word, line, mode) <= pos;
      const k = 0.55 + 0.45 * s.depth;
      ctx.save();
      ctx.font = `600 ${size * k}px ${frame.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const a = (0.25 + 0.75 * s.depth) * (sung ? 1 : 0.55) * (quiet ? 0.35 : 1);
      ctx.shadowColor = rgba(theme.star, 0.8 * a);
      ctx.shadowBlur = sung ? size * 0.4 * s.depth : 0;
      ctx.fillStyle = rgba(sung ? lift(theme.star, 0.35) : mix(theme.label, [0, 0, 0], 0.3), a);
      ctx.fillText(word.text, cx + s.x * rx, cy + s.y * ry * 0.5 + ry * 0.35);
      ctx.restore();
    }
  }

  return {
    id: 'orbit',
    name: 'Orbit',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {},
    draw(frame) {
      const { lines, index, w, h, pos, reduceMotion, mode } = frame;
      const cx = w / 2;
      const cy = h * 0.46;
      const r = clamp(Math.min(w, h) * 0.17, 40, 220);
      if (index < 0) {
        cover(frame, cx, cy, r);
        return;
      }
      const line = lines[index];
      const n = line.words.length;
      const size = clamp(Math.min(w, h * 1.6) * 0.05, 18, 56);
      const c = orbitCentre(line.words, pos, reduceMotion, mode);
      const rx = Math.min(w * 0.4, r * 3.1);
      const ry = r * 1.5;
      const spots = line.words.map((_, i) => ({ i, ...orbitSpot(i, c, n) }));
      words(frame, spots, cx, cy, rx, ry, size, false);
      cover(frame, cx, cy, r);
      words(frame, spots, cx, cy, rx, ry, size, true);
    },
  };
}
