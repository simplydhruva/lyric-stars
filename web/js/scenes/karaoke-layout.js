// Pure maths for the karaoke scene: word wrapping, the gold sweep and the stack of lines.
// No canvas in here, so it is all unit-tested.

export const LINE_HEIGHT = 1.28; // row height as a multiple of the font size
export const MAX_ROWS = 3; // a line is shrunk until it fits in this many rows (down to MIN_FONT_SCALE)
export const MIN_FONT_SCALE = 0.5;
export const SLOT_PAD = 0.5; // gap between stacked lines, in font sizes
export const TRANSITION_MS = 350; // how long the stack takes to move up one line

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// Greedy wrap. widths: one per word; space: width of a space; maxW: widest a row may be.
// A word wider than maxW gets a row of its own. Returns [{ from, to, width }] (to is exclusive).
export function wrapRows(widths, space, maxW) {
  const rows = [];
  let from = 0;
  let width = 0;
  for (let i = 0; i < widths.length; i++) {
    const next = i === from ? widths[i] : width + space + widths[i];
    if (i > from && next > maxW) {
      rows.push({ from, to: i, width });
      from = i;
      width = widths[i];
    } else width = next;
  }
  if (from < widths.length) rows.push({ from, to: widths.length, width });
  return rows;
}

// Shrinks the font until the line fits in maxRows rows, or reaches baseFont * MIN_FONT_SCALE.
// measure(text, font) gives a width in px. Returns { font, rows, offsets, height } where offsets[i] is
// word i's left edge from the start of its row.
export function fitLine(texts, measure, { maxW, baseFont, maxRows = MAX_ROWS }) {
  if (!texts.length) return { font: baseFont, rows: [], offsets: [], widths: [], height: 0 };
  const floor = baseFont * MIN_FONT_SCALE;
  let font = baseFont;
  for (;;) {
    const widths = texts.map((t) => measure(t, font));
    const space = measure(' ', font);
    const rows = wrapRows(widths, space, maxW);
    if (rows.length <= maxRows || font <= floor) {
      const offsets = new Array(texts.length);
      for (const row of rows) {
        let x = 0;
        for (let i = row.from; i < row.to; i++) {
          offsets[i] = x;
          x += widths[i] + space;
        }
      }
      return { font, rows, offsets, widths, height: rows.length * font * LINE_HEIGHT };
    }
    font = Math.max(floor, font * 0.92);
  }
}

// How much of a word is filled, 0..1. Sweeps from its start to its end; with `still` (reduce motion)
// or no usable duration it lights up all at once when it starts.
export function sweepFraction(word, pos, still = false) {
  if (pos <= word.start) return 0;
  const span = word.end - word.start;
  if (still || !(span > 0)) return 1;
  return clamp((pos - word.start) / span, 0, 1);
}

// A line's place in the stack as a fractional slot s: 0 is the middle, -1 the line above, +1 the line below.
// `lineOffset` is how far the line is from the current one (-2..+1); `t` is the slide progress 0..1.
export const slotOf = (lineOffset, t) => lineOffset + (1 - t);

// Slide progress: 1 when settled. With no slide (reduce motion, or nothing to slide from) it is always 1.
export function slideProgress(sinceLineStart, still) {
  if (still || !Number.isFinite(sinceLineStart)) return 1;
  return easeOut(clamp(sinceLineStart / TRANSITION_MS, 0, 1));
}

// Opacity of a line at slot s: full in the middle, faint beside it, gone two slots away.
export function slotAlpha(s) {
  const d = Math.abs(s);
  if (d <= 1) return 1 - 0.7 * d;
  return clamp(0.3 * (2 - d), 0, 0.3);
}

// Size of a line at slot s, relative to the middle line.
export function slotScale(s) {
  return 1 - 0.36 * Math.min(1, Math.abs(s));
}

// Where each slot's centre sits, in px from the middle of the screen. heights: scaled heights of the
// lines at slots -2..+1 (0 for a line that doesn't exist or has no words). Returns y for slots -2..+2.
export function slotCentres(heights, pad) {
  const [h2, h1, h0, n1] = heights; // slots -2, -1, 0, +1
  const y = {};
  y[0] = 0;
  y[1] = h0 / 2 + pad + n1 / 2;
  y[2] = y[1] + n1 + pad; // only ever drawn invisibly
  y[-1] = -(h0 / 2 + pad + h1 / 2);
  y[-2] = y[-1] - (h1 / 2 + pad + h2 / 2);
  return y;
}

// Linear position between the integer slots.
export function slotY(s, centres) {
  const lo = Math.floor(s);
  const hi = Math.ceil(s);
  if (lo === hi) return centres[lo];
  return centres[lo] + (centres[hi] - centres[lo]) * (s - lo);
}
