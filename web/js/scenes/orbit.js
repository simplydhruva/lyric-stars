// Orbit: the words of the line circle the album cover like moons. The ring turns to bring the word being sung to
// the front; words on the far side are smaller and dimmer and pass behind the cover. With no cover (or before it
// loads) a glowing disc takes its place. The ring is driven by the smoothed song clock (frame.pos) and turns with
// delta time: it eases toward the word being sung, so fast words make it chase smoothly and never snap. When paused
// (or with reduce motion) it simply sits on the current word, so a given position always looks the same.
import { artImage, drawCover } from './art.js';
import { clamp, lift, mix, orbitSpot, rgba, shownAt } from './motion.js';

export const FOLLOW_MS = 110; // the ring closes about 63% of the way to the sung word in this time

// The word the ring should have at the front: the one being sung (the first before any starts; always the first in line mode).
export function orbitTarget(words, pos, mode) {
  if (mode === 'line') return 0;
  let cur = 0;
  for (let i = 0; i < words.length && words[i].start <= pos; i++) cur = i;
  return cur;
}

// One step of the ring. Exponential easing by delta time, so it does not depend on the frame rate.
export function followStep(c, target, dtMs) {
  return c + (target - c) * (1 - Math.exp(-Math.max(0, dtMs) / FOLLOW_MS));
}

export function createOrbit() {
  let ctx = null;
  let c = 0; // where the ring is, as a fractional word index
  let lastNow = 0;
  let lastPos = 0;
  let lastIndex = -1;
  let lastLines = null;
  const spots = []; // reused every frame
  const fonts = new Map(); // whole-pixel font sizes -> css font string (glyphs of a size are cached by the browser)
  let sprite = null; // the soft light behind the cover, drawn once
  let spriteKey = '';

  const fontOf = (px, family) => {
    const key = px + family;
    let f = fonts.get(key);
    if (!f) {
      if (fonts.size > 200) fonts.clear();
      f = `600 ${px}px ${family}`;
      fonts.set(key, f);
    }
    return f;
  };

  function light(frame, r) {
    const level = (frame.glow ?? 0.25) * 2;
    const key = [Math.round(r), frame.theme.star.join(), level.toFixed(2)].join('|');
    if (key !== spriteKey) {
      const size = Math.ceil(r * 4);
      sprite = document.createElement('canvas');
      sprite.width = sprite.height = size;
      const g = sprite.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, r * 0.6, size / 2, size / 2, r * 1.8);
      grad.addColorStop(0, rgba(frame.theme.star, 0.3 * level));
      grad.addColorStop(1, rgba(frame.theme.star, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      spriteKey = key;
    }
    return sprite;
  }

  function cover(frame, cx, cy, r) {
    const { theme } = frame;
    const sp = light(frame, r);
    ctx.drawImage(sp, cx - sp.width / 2, cy - sp.height / 2);
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

  function words(frame, n, cx, cy, rx, ry, size, front) {
    const { theme, mode, pos, quiet } = frame;
    const line = frame.lines[frame.index];
    const glow = (frame.glow ?? 0.25) * 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const s = spots[i];
      if ((s.depth >= 0.5) !== front) continue;
      const word = line.words[i];
      const sung = shownAt(word, line, mode) <= pos;
      const k = 0.55 + 0.45 * s.depth;
      const px = Math.max(8, Math.round(size * k));
      const a = (0.25 + 0.75 * s.depth) * (sung ? 1 : 0.55) * (quiet ? 0.35 : 1);
      const x = cx + s.x * rx;
      const y = cy + s.y * ry * 0.5 + ry * 0.35;
      ctx.font = fontOf(px, frame.fontFamily);
      // A halo of a wider, faint outline instead of shadowBlur (blur is the slow part of canvas text).
      if (sung && glow > 0 && s.depth > 0.6) {
        ctx.lineWidth = px * 0.22;
        ctx.strokeStyle = rgba(theme.star, 0.07 * a * glow * s.depth);
        ctx.strokeText(word.text, x, y);
      }
      ctx.fillStyle = rgba(sung ? lift(theme.star, 0.35) : mix(theme.label, [0, 0, 0], 0.3), a);
      ctx.fillText(word.text, x, y);
    }
  }

  return {
    id: 'orbit',
    name: 'Orbit',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      sprite = null;
      spriteKey = '';
      fonts.clear();
    },
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
      // Move the ring: ease toward the sung word by the time since the last frame. Jump straight there when
      // nothing is playing, with reduce motion, on a new line, a new lyrics list, or after a seek (pos jumped).
      const target = orbitTarget(line.words, pos, mode);
      const dt = frame.now - lastNow;
      const jumped = Math.abs(pos - lastPos) > 1500 || dt > 250 || dt < 0;
      if (!frame.playing || reduceMotion || mode === 'line' || index !== lastIndex || lines !== lastLines || jumped) c = target;
      else c = followStep(c, target, Math.min(dt, 64));
      lastNow = frame.now;
      lastPos = pos;
      lastIndex = index;
      lastLines = lines;
      const rx = Math.min(w * 0.4, r * 3.1);
      const ry = r * 1.5;
      for (let i = 0; i < n; i++) spots[i] = orbitSpot(i, c, n, spots[i]);
      words(frame, n, cx, cy, rx, ry, size, false);
      cover(frame, cx, cy, r);
      words(frame, n, cx, cy, rx, ry, size, true);
    },
  };
}
