// Pure maths for the kinetic typography scene: which words are big, how a line is laid out with words
// of different sizes, and how a word slams in. No canvas in here, so it is all unit-tested.
import { LINE_HEIGHT, MIN_FONT_SCALE, easeOut, wrapRows } from './karaoke-layout.js';

export const ENTER_MS = 160; // how long a word takes to land
export const EXIT_MS = 220; // how long the previous line takes to fade after the next one starts
export const MAX_ROWS = 4;
export const ENTER_GROW = 1.45; // the biggest a word gets while it lands (see wordEntrance)
export const WORD_ROOM = 0.95;
export const MARGIN = 0.05; // every word stays this far (of the screen) from every edge
export const CHORUS_BOOST = 1.2; // lines that repeat in the song are drawn this much bigger
const MIN_SCALE = 0.85; // the smallest word, relative to the base font
const SPAN = 0.65; // the loudest word is MIN_SCALE + SPAN

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// "Loudness" guess for each word, 0..1. We have no audio, so a long word and a word held for a long time
// count as stressed, and short words ("a", "to") don't. Words with no known duration are judged on length alone.
export function wordScores(words) {
  const len = words.map((w) => w.text.replace(/[^\p{L}\p{N}]/gu, '').length);
  const dur = words.map((w) => (w.end > w.start ? w.end - w.start : 0));
  const maxLen = Math.max(1, ...len);
  const maxDur = Math.max(...dur);
  return words.map((_, i) => (maxDur > 0 ? 0.5 * len[i] / maxLen + 0.5 * dur[i] / maxDur : len[i] / maxLen));
}

// Size of each word relative to the base font. The loudest word of the line is always the biggest of it.
// `chorus` makes the whole line bigger (the line is still shrunk to fit afterwards).
export function wordScales(words, chorus = false) {
  const scores = wordScores(words);
  const boost = chorus ? CHORUS_BOOST : 1;
  return scores.map((s) => (MIN_SCALE + SPAN * s) * boost);
}

// Index of the loudest word (the first one if tied), or -1 for an empty line.
export function loudestIndex(words) {
  const scores = wordScores(words);
  let best = -1;
  scores.forEach((s, i) => {
    if (best < 0 || s > scores[best]) best = i;
  });
  return best;
}

// Lays a line out in centred rows. Each word has its own size: font * scales[i] * fit[i]. Measure with the final font.
//  1. A single word that would be wider than maxW even before its slam (grow = the biggest it gets while landing)
//     is shrunk on its own (fit[i]); only that word.
//  2. The whole line is shrunk until it fits in maxRows rows (down to MIN_FONT_SCALE of baseFont).
//  3. If it is still taller than maxH, the whole line is scaled down evenly (below that floor if it has to be).
// measure(text, font) gives a width in px. Returns { font, rows: [{ from, to, width, height }], offsets, widths,
// sizes (the font size of each word), height }; offsets[i] is the word's left edge from the start of its row.
export function layoutKinetic(texts, scales, measure, { maxW, maxH = Infinity, baseFont, maxRows = MAX_ROWS, grow = 1 }) {
  if (!texts.length) return { font: baseFont, rows: [], offsets: [], widths: [], sizes: [], height: 0 };
  const floor = baseFont * MIN_FONT_SCALE;
  const place = (font) => {
    const sizes = texts.map((t, i) => {
      const own = font * scales[i];
      const peak = measure(t, own) * grow;
      const room = maxW * WORD_ROOM; // a little is kept back for the tilt and for ink that overhangs the measured width
      return peak > room ? own * (room / peak) : own;
    });
    const widths = texts.map((t, i) => measure(t, sizes[i]));
    const space = measure(' ', font * 0.7);
    const wrapped = wrapRows(widths, space, maxW);
    const offsets = new Array(texts.length);
    const rows = wrapped.map((row) => {
      let x = 0;
      let tallest = 0;
      for (let i = row.from; i < row.to; i++) {
        offsets[i] = x;
        x += widths[i] + space;
        tallest = Math.max(tallest, sizes[i]);
      }
      return { ...row, height: tallest * LINE_HEIGHT * 0.9 };
    });
    return { font, rows, offsets, widths, sizes, height: rows.reduce((sum, r) => sum + r.height, 0) };
  };
  let font = baseFont;
  let out = place(font);
  while (out.rows.length > maxRows && font > floor) {
    font = Math.max(floor, font * 0.92);
    out = place(font);
  }
  for (let pass = 0; pass < 12 && out.height > maxH && font > 4; pass++) {
    font = Math.max(4, font * Math.min(0.97, (maxH / out.height) * 0.98));
    out = place(font);
  }
  return out;
}

// How a word looks at time `pos`. Before its start it is not there. At its start it is already fully
// visible (nothing delays it) but bigger and offset, and it settles over ENTER_MS. `still` skips the motion.
// Returns { visible, grow (size multiplier, 1 when settled), drop (0..1: how far it still has to travel) }.
export function wordEntrance(start, pos, still) {
  if (pos < start) return { visible: false, grow: 1, drop: 0 };
  if (still) return { visible: true, grow: 1, drop: 0 };
  const t = clamp((pos - start) / ENTER_MS, 0, 1);
  const left = 1 - easeOut(t);
  return { visible: true, grow: 1 + (ENTER_GROW - 1) * left, drop: left };
}

// Opacity of the line that just ended, fading over EXIT_MS from the moment the next line starts.
export function exitAlpha(sinceNextStart, still) {
  if (still || !Number.isFinite(sinceNextStart)) return 0;
  return clamp(1 - sinceNextStart / EXIT_MS, 0, 1);
}

// A small steady tilt for a word, from its place in the song, so it never changes between frames.
export function tilt(lineIndex, wordIndex) {
  const h = (lineIndex * 31 + wordIndex * 17 + 7) % 7;
  return (h - 3) * 0.012; // radians, about ±2°
}

// Where a row's revealed words end (px from the row's left edge) at `pos`, easing to each new word's end
// over ENTER_MS so centring on what is showing never makes a word jump. null while nothing in the row shows.
// starts[i] is when word i appears; offsets and widths come from layoutKinetic.
export function revealedEnd(row, offsets, widths, starts, pos, still) {
  let k = -1;
  for (let i = row.from; i < row.to; i++) if (pos >= starts[i]) k = i;
  if (k < 0) return null;
  const end = offsets[k] + widths[k];
  if (still || k === row.from) return end;
  const prev = offsets[k - 1] + widths[k - 1];
  return prev + (end - prev) * easeOut(clamp((pos - starts[k]) / ENTER_MS, 0, 1));
}
