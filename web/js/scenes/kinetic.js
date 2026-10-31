// Kinetic typography: big words slam onto the screen exactly when they are sung. The loudest word of a
// line is the biggest, and lines that repeat in the song (the chorus) are drawn bigger. A word is fully
// visible on its start frame; only its size and position settle afterwards. Line mode (M) brings the whole
// line in at once. When the next line starts, the old one fades out. Pure function of the playback position.
import { exitAlpha, layoutKinetic, loudestIndex, repeatCounts, revealedEnd, tilt, wordEntrance, wordScales } from './kinetic-layout.js';

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lift = ([r, g, b], k) => [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k].map(Math.round);
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

export function createKinetic() {
  let ctx = null;
  let layouts = new Map();
  let layoutKey = null;
  let repeats = null; // repeat counts for the current lines
  let repeatsFor = null;

  const measureAt = (frame) => (text, font) => {
    ctx.font = `800 ${font}px ${frame.fontFamily}`;
    return ctx.measureText(text).width;
  };

  function layoutOf(frame, index, baseFont, maxW) {
    const key = [frame.w, frame.h, frame.fontFamily, baseFont, maxW];
    if (!layoutKey || layoutKey.lines !== frame.lines || layoutKey.values.some((v, i) => v !== key[i])) {
      layouts = new Map();
      layoutKey = { lines: frame.lines, values: key };
    }
    if (repeatsFor !== frame.lines) {
      repeats = repeatCounts(frame.lines);
      repeatsFor = frame.lines;
    }
    let l = layouts.get(index);
    if (!l) {
      const words = frame.lines[index].words;
      const scales = wordScales(words, repeats[index] >= 2);
      l = { scales, loudest: loudestIndex(words), fit: layoutKinetic(words.map((x) => x.text), scales, measureAt(frame), { maxW, baseFont }) };
      layouts.set(index, l);
    }
    return l;
  }

  // Draws one line. `alpha` fades the whole line; `entering` is false for the line that is fading out.
  function drawLine(frame, index, baseFont, maxW, alpha, entering) {
    const { pos, theme, reduceMotion, mode } = frame;
    const line = frame.lines[index];
    if (!line.words.length || alpha <= 0.004) return;
    const { scales, loudest, fit: f } = layoutOf(frame, index, baseFont, maxW);
    const star = lift(theme.star, 0.18);
    const hot = theme.core || lift(theme.star, 0.6);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let y = frame.h / 2 - f.height / 2;
    f.rows.forEach((row, r) => {
      const cy = y + row.height / 2;
      y += row.height;
      // Centre on the words showing so far, so a half-sung line isn't pushed to the left by words still to come.
      const starts = line.words.map((x) => (mode === 'line' ? line.time : x.start));
      const shown = revealedEnd(row, f.offsets, f.widths, starts, pos, reduceMotion || mode === 'line' || !entering);
      const left = frame.w / 2 - (shown ?? row.width) / 2;
      for (let i = row.from; i < row.to; i++) {
        const word = line.words[i];
        // Line mode shows the whole line from the moment it starts; word mode shows each word at its own start.
        const start = mode === 'line' ? line.time : word.start;
        const e = entering ? wordEntrance(start, pos, reduceMotion) : { visible: true, grow: 1, drop: 0 };
        if (!e.visible) continue;
        const size = f.font * scales[i] * e.grow;
        const cx = left + f.offsets[i] + f.widths[i] / 2;
        const slide = (r % 2 ? 1 : -1) * size * 0.35 * e.drop; // rows alternate: in from the left, in from the right
        ctx.save();
        ctx.translate(cx + slide, cy - size * 0.18 * e.drop);
        if (!reduceMotion) ctx.rotate(tilt(index, i));
        ctx.font = `800 ${size}px ${frame.fontFamily}`;
        const strength = i === loudest ? 1 : clamp((scales[i] - 0.85) / 0.8, 0, 0.7);
        ctx.fillStyle = rgba(mix(star, hot, strength), alpha * (frame.quiet ? 0.35 : 1));
        ctx.fillText(word.text, 0, 0);
        ctx.restore();
      }
    });
    ctx.restore();
  }

  return {
    id: 'kinetic',
    name: 'Kinetic',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      layouts = new Map();
      layoutKey = null;
    },
    draw(frame) {
      const { lines, index, w, h, pos } = frame;
      if (index < 0) return;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.085, 28, 120);
      const maxW = w * 0.88;
      // The line that just ended fades out while the new one slams in.
      if (index > 0 && !frame.reduceMotion) {
        const a = exitAlpha(pos - lines[index].time, frame.reduceMotion);
        if (a > 0) drawLine(frame, index - 1, baseFont, maxW, a * 0.5, false);
      }
      drawLine(frame, index, baseFont, maxW, 1, true);
    },
  };
}
