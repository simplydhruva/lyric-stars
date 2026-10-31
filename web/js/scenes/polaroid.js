// Polaroid: every line is a white photo card, slightly tilted, with the album cover (or a colour wash from the
// cover's palette) as the picture and the lyric written on the white strip below as it is sung. When the next
// line starts the old card slides away and the new one slides in. Pure function of the playback position.
import { artImage, drawCover } from './art.js';
import { createFitCache } from './line-draw.js';
import { LINE_HEIGHT } from './karaoke-layout.js';
import { clamp, hash, rgba, shownAt, slideIn, slideOut } from './motion.js';

const FAMILY = '"Segoe Script", "Ink Free", "Segoe UI", cursive';

export function createPolaroid() {
  let ctx = null;
  const cache = createFitCache(() => ctx, { weight: 400, family: () => FAMILY, maxRows: 2 });

  function card(frame, li, off, side) {
    const { w, h, pos, theme, mode, reduceMotion, palette } = frame;
    const line = frame.lines[li];
    const cw = clamp(Math.min(w * 0.7, h * 0.52), 160, 560);
    const photo = cw * 0.86;
    const strip = cw * 0.4;
    const ch = photo + strip + cw * 0.07;
    const tilt = (hash(li, 7) - 0.5) * 0.14;
    const x = w / 2 + side * off * w * 0.75;
    const y = h * 0.46 + off * h * 0.06;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(reduceMotion ? 0 : tilt + side * off * 0.3);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = cw * 0.06;
    ctx.fillStyle = '#f6f2e8';
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
    ctx.shadowBlur = 0;
    const px = -photo / 2;
    const py = -ch / 2 + cw * 0.07;
    const img = artImage(frame.art);
    if (img) drawCover(ctx, img, px, py, photo, photo);
    else {
      const c1 = palette?.[0] || theme.star;
      const c2 = palette?.[1] || theme.label;
      const g = ctx.createRadialGradient(px + photo * 0.3, py + photo * 0.3, 0, px + photo / 2, py + photo / 2, photo * 0.8);
      g.addColorStop(0, rgba(c1, 1));
      g.addColorStop(1, rgba(c2, 1));
      ctx.fillStyle = g;
      ctx.fillRect(px, py, photo, photo);
    }
    // the caption, written as sung
    if (line.words.length) {
      const f = cache.fit(frame, li, cw * 0.1, cw * 0.88);
      const rowH = f.font * LINE_HEIGHT;
      ctx.font = `400 ${f.font}px ${FAMILY}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(40,36,50,0.92)';
      const top = py + photo + (strip - cw * 0.04 - f.height) / 2;
      f.rows.forEach((row, r) => {
        const cy = top + (r + 0.5) * rowH;
        for (let i = row.from; i < row.to; i++) {
          if (li === frame.index && shownAt(line.words[i], line, mode) > pos) continue;
          if (li > frame.index) continue;
          ctx.fillText(line.words[i].text, -row.width / 2 + f.offsets[i], cy);
        }
      });
    }
    ctx.restore();
  }

  return {
    id: 'polaroid',
    name: 'Polaroid',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos, reduceMotion } = frame;
      if (index < 0) return;
      const cw = clamp(Math.min(w * 0.7, h * 0.52), 160, 560);
      cache.check(frame, cw * 0.1, cw * 0.88);
      const since = pos - lines[index].time;
      if (index > 0) {
        const away = slideOut(since, reduceMotion);
        if (away < 1) card(frame, index - 1, away, -1);
      }
      card(frame, index, slideIn(since, reduceMotion), 1);
    },
  };
}
