// Pixel scene, the maths: no canvas in here, so all of it is unit-tested. The logical screen and its integer scale, the three
// fixed 16-colour palettes, ordered (Bayer) dithering for the line dissolve and the sky, line wrapping with the pixel font's
// metrics, the marquee, the cover downsample, and which lyric line is on screen when. Everything is a function of its inputs.
import { PIXEL_FONT_DATA } from './pixel-font-data.js';

// ---- the logical screen ----------------------------------------------------------------------------------------------

export const SIZES = { fine: 480, normal: 320, chunky: 240 }; // the logical screen's height, per "Pixel size" setting
export const SCREENS = ['fill', 'portrait'];

// Fits the logical screen into a window of dw x dh DEVICE pixels. Returns the integer scale (device pixels per logical pixel),
// the logical size lw x lh, and where it sits (ox, oy, device pixels). 'fill' uses the window's own aspect ratio: the scale is the
// whole number that gets the logical height nearest to the target, and the logical size is whatever fits (the few device pixels
// that are left over, fewer than one logical pixel on each side, stay black). 'portrait' is a 9:16 screen at the largest integer
// scale that fits, centred.
export function fitScreen(dw, dh, { screen = 'fill', target = SIZES.normal } = {}) {
  dw = Math.max(1, Math.floor(dw));
  dh = Math.max(1, Math.floor(dh));
  let scale;
  let lw;
  let lh;
  if (screen === 'portrait') {
    lh = target;
    lw = Math.round((target * 9) / 16);
    scale = Math.max(1, Math.min(Math.floor(dh / lh), Math.floor(dw / lw)));
  } else {
    // a narrow window gets a smaller scale, so the logical screen stays wide enough for text
    const minW = Math.round(target * 0.9);
    scale = Math.max(1, Math.min(Math.round(dh / target), Math.floor(dw / minW)));
    lw = Math.floor(dw / scale);
    lh = Math.floor(dh / scale);
  }
  const ox = Math.floor((dw - lw * scale) / 2);
  const oy = Math.floor((dh - lh * scale) / 2);
  return { scale, lw, lh, ox, oy, coverage: (lw * scale * lh * scale) / (dw * dh) };
}

// ---- palettes ----------------------------------------------------------------------------------------------------------

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export const hexToRgb = hex;
const lerp = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const toHex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

// Each palette: exactly 16 colours, plus which colour plays which part. Parts are indices into the 16.
//   ramp: the sky from top to bottom (8 steps, dithered into each other)   outline/dim/mid/bright: lyric text
//   ui/uiDim: handheld interface   star/starBright, cloudLight/cloudShade, far (hills), near (skyline), glow (lit windows), moon, accent
export const PALETTES = {
  dreamy: {
    name: 'Dreamy',
    colors: ['#0b0818', '#161c40', '#222e66', '#3a5a96', '#5f86b8', '#e6d9b8', '#6e5c9e', '#a38fcb', '#d0c2e8', '#c9607a', '#f08e8c', '#f9bda8', '#bfb3a0', '#fff1cf', '#fffbee', '#ff7aa8'],
    ramp: [1, 2, 3, 4, 6, 7, 10, 11],
    outline: 1, dim: 12, mid: 5, bright: 13, ui: 12, uiDim: 8, star: 8, starBright: 14,
    cloudLight: 8, cloudShade: 7, far: 6, near: 2, glow: 11, moon: 12, accent: 15,
  },
  sunset: {
    name: 'Sunset',
    colors: ['#e8d3b0', '#2c1042', '#4d1b61', '#7c2b6d', '#aa386b', '#d44d5c', '#e8664a', '#f58b3c', '#fcb14a', '#fdd36c', '#8c3a5c', '#ffdca4', '#c9ab92', '#fff0d2', '#ffffff', '#ff5a7a'],
    ramp: [1, 2, 3, 4, 5, 6, 7, 8],
    outline: 1, dim: 12, mid: 0, bright: 13, ui: 12, uiDim: 11, star: 11, starBright: 14,
    cloudLight: 10, cloudShade: 3, far: 3, near: 1, glow: 9, moon: 11, accent: 15,
  },
  // The four greens of an old handheld, with twelve steps between them (all still green) to make 16.
  green: {
    name: 'Classic green',
    colors: (() => {
      const core = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'].map(hex);
      const out = [];
      for (let i = 0; i < 16; i++) {
        const f = (i / 15) * 3;
        const j = Math.min(2, Math.floor(f));
        out.push(toHex(lerp(core[j], core[j + 1], f - j)));
      }
      return out;
    })(),
    ramp: [2, 3, 4, 5, 6, 7, 8, 9],
    outline: 0, dim: 8, mid: 11, bright: 15, ui: 9, uiDim: 6, star: 9, starBright: 15,
    cloudLight: 10, cloudShade: 7, far: 4, near: 1, glow: 13, moon: 11, accent: 13,
  },
};
export const PALETTE_IDS = Object.keys(PALETTES);
export const paletteOf = (id) => PALETTES[id] || PALETTES.dreamy;

// The palette with the album's colour mapped onto the accent (and a touch of it into the sky's middle), keeping the style:
// the hue is the album's, the lightness and saturation stay in the palette's range. The green handheld has one hue only, so it
// is returned unchanged. Returns a fresh palette object; the originals are never changed.
export function withAlbumAccent(pal, rgb) {
  if (!rgb || pal === PALETTES.green || pal.colors === PALETTES.green.colors) return pal;
  const [h, s] = rgbToHsl(rgb);
  const accent = hslToRgb(h, Math.min(0.85, Math.max(0.45, s)), 0.68);
  const colors = pal.colors.slice();
  colors[pal.accent] = toHex(accent);
  const mixIn = (i, k) => (colors[i] = toHex(lerp(hex(colors[i]), hslToRgb(h, 0.45, rgbToHsl(hex(colors[i]))[2]), k)));
  for (const i of pal.ramp.slice(3, 6)) mixIn(i, 0.45);
  return { ...pal, colors };
}

export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

// The palette index nearest to a colour (weighted so green counts most, as the eye does).
export function nearestIndex(colorsRgb, r, g, b) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < colorsRgb.length; i++) {
    const c = colorsRgb[i];
    const dr = c[0] - r;
    const dg = c[1] - g;
    const db = c[2] - b;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

// ---- ordered dithering -------------------------------------------------------------------------------------------------

// The n x n Bayer matrix (n a power of two) as a flat array of the numbers 0..n*n-1.
export function bayerMatrix(n) {
  let m = [0];
  for (let size = 1; size < n; size *= 2) {
    const next = new Array(size * size * 4);
    const w = size * 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = m[y * size + x] * 4;
        next[y * w + x] = v;
        next[y * w + x + size] = v + 2;
        next[(y + size) * w + x] = v + 3;
        next[(y + size) * w + x + size] = v + 1;
      }
    }
    m = next;
  }
  return m;
}
const B4 = bayerMatrix(4);
const B8 = bayerMatrix(8);
// The threshold of pixel (x, y), in (0, 1): never 0 and never 1, so progress 0 shows nothing and progress 1 shows everything.
export const bayerThreshold = (x, y, n = 4) => ((n === 8 ? B8 : B4)[(y & (n - 1)) * n + (x & (n - 1))] + 0.5) / (n * n);

export const DISSOLVE_STEPS = 16;
// The dissolve level 0..16 for a progress 0..1 (the line's dither mask has this many steps).
export const dissolveLevel = (progress) => Math.round(Math.min(1, Math.max(0, progress)) * DISSOLVE_STEPS);
// Is pixel (x, y) shown at this level? Monotonic: a pixel shown at one level is shown at every higher one.
export const dissolveVisible = (x, y, level) => bayerThreshold(x, y, 4) < level / DISSOLVE_STEPS;

// ---- the album cover as a sprite ---------------------------------------------------------------------------------------

// rgba: n x n pixels of the cover already scaled down. Returns n*n palette indices, ordered-dithered, plus the dominant colour
// (the average, weighted towards the vivid pixels) for "Use album colors".
export function coverToIndices(rgba, n, palette) {
  const rgb = palette.colors.map(hex);
  const out = new Uint8Array(n * n);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sw = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const t = (bayerThreshold(x, y, 4) - 0.5) * 56;
      out[y * n + x] = nearestIndex(rgb, clamp8(rgba[i] + t), clamp8(rgba[i + 1] + t), clamp8(rgba[i + 2] + t));
      const mx = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
      const mn = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
      const w = 1 + (mx - mn) * 0.1;
      sr += rgba[i] * w;
      sg += rgba[i + 1] * w;
      sb += rgba[i + 2] * w;
      sw += w;
    }
  }
  const dominant = sw ? [Math.round(sr / sw), Math.round(sg / sw), Math.round(sb / sw)] : null;
  return { indices: out, dominant };
}
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---- text ----------------------------------------------------------------------------------------------------------------

export const FONT_IDS = ['press', 'silk'];
export const FONT_FAMILY = { press: '"Press Start 2P"', silk: '"Silkscreen"' };
export const FONT_FILE = { press: 'PressStart2P', silk: 'Silkscreen' };

const hasChar = (fontId, cp) => {
  const r = PIXEL_FONT_DATA[fontId]?.ranges;
  if (!r) return false;
  let lo = 0;
  let hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < r[mid][0]) hi = mid - 1;
    else if (cp > r[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
};
export const fontHas = hasChar;

const PUNCT = { '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', ' ': ' ' };

// Text as the pixel font can draw it: curly quotes and dashes made plain, accents taken off when the font lacks the accented
// letter (café -> cafe), runs of spaces collapsed. Anything the font still lacks (other scripts, emoji) is left as it is: the
// scene draws it with a system font and turns it into hard pixels.
export function pixelText(text, fontId = 'press') {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (PUNCT[ch]) {
      out += PUNCT[ch];
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp < 32 || hasChar(fontId, cp)) {
      if (cp >= 32) out += ch;
      continue;
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base !== ch && [...base].every((c) => hasChar(fontId, c.codePointAt(0))) ? base : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// A width function from the font's table (1/1000 em), for tests and for a scene with no canvas: Press Start 2P is monospaced.
export function tableMeasure(fontId) {
  const w = PIXEL_FONT_DATA[fontId].widths;
  return (text, size) => {
    let sum = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const v = cp >= 32 && cp < 127 ? w[cp - 32] : null;
      sum += v == null ? 1000 : v;
    }
    return Math.round((sum * size) / 1000);
  };
}

// Font sizes to try, largest first: whole multiples of 8 (the fonts are drawn on an 8-pixel grid, so a size like 12 would make
// uneven pixels). The biggest depends on the logical screen's height.
export function fontSizes(lh) {
  const top = lh >= 560 ? 32 : lh >= 420 ? 24 : 16;
  const out = [];
  for (let s = top; s >= 8; s -= 8) out.push(s);
  return out;
}

// Lays a line of words out in a box maxW wide, in at most maxRows rows, centred. measure(text, size) gives a width in logical
// pixels. Tries each size in `sizes` (largest first) and takes the first that fits; a word wider than the box is broken into
// pieces; if even the smallest size does not fit, the rest is cut and "..." is added (truncated: true).
// Returns { size, rowH, rows: [{ y, w, x, items: [{ wi, text, x, w }] }], width, height, truncated }, positions relative to the
// box's left and top. x of an item is within its row; row.x is the row's left edge in the box.
export function layoutLine(words, measure, { maxW, maxRows = 3, sizes = [16, 8] }) {
  let result = null;
  for (let si = 0; si < sizes.length; si++) {
    const size = sizes[si];
    const last = si === sizes.length - 1;
    const r = wrap(words, measure, size, maxW, last ? Infinity : maxRows);
    if (r.rows.length <= maxRows) {
      result = r;
      break;
    }
    if (last) result = truncate(r, measure, size, maxW, maxRows);
  }
  const rowH = rowHeight(result.size);
  let width = 0;
  result.rows.forEach((row, i) => {
    row.y = i * rowH;
    row.x = Math.floor((maxW - row.w) / 2);
    width = Math.max(width, row.w);
  });
  return { ...result, rowH, width, height: result.rows.length ? (result.rows.length - 1) * rowH + result.size : 0 };
}
export const rowHeight = (size) => size + Math.max(2, size >> 1);

function pieces(words, measure, size, maxW) {
  const out = [];
  words.forEach((text, wi) => {
    const w = measure(text, size);
    if (w <= maxW) {
      out.push({ wi, text, w, glue: false });
      return;
    }
    let cur = '';
    let first = true;
    for (const ch of text) {
      if (cur && measure(cur + ch, size) > maxW) {
        out.push({ wi, text: cur, w: measure(cur, size), glue: !first });
        first = false;
        cur = ch;
      } else cur += ch;
    }
    if (cur) out.push({ wi, text: cur, w: measure(cur, size), glue: !first });
  });
  return out;
}

function wrap(words, measure, size, maxW, maxRows) {
  const space = measure(' ', size);
  const rows = [];
  let row = null;
  for (const p of pieces(words, measure, size, maxW)) {
    const gap = row ? (p.glue ? 0 : space) : 0;
    if (row && row.w + gap + p.w <= maxW) {
      row.items.push({ wi: p.wi, text: p.text, x: row.w + gap, w: p.w });
      row.w += gap + p.w;
    } else {
      if (rows.length >= maxRows) {
        rows.push({ w: 0, items: [] }); // one past the limit marks "does not fit"
        return { size, rows };
      }
      row = { w: p.w, items: [{ wi: p.wi, text: p.text, x: 0, w: p.w }] };
      rows.push(row);
    }
  }
  return { size, rows };
}

function truncate(r, measure, size, maxW, maxRows) {
  const rows = r.rows.slice(0, maxRows).filter((x) => x.items.length);
  const row = rows[rows.length - 1];
  const space = measure(' ', size);
  const dots = measure('...', size);
  const tail = () => {
    const l = row.items[row.items.length - 1];
    row.w = l ? l.x + l.w : 0;
  };
  while (row.items.length && row.w + (row.items.length ? space : 0) + dots > maxW) {
    row.items.pop();
    tail();
  }
  row.items.push({ wi: -1, text: '...', x: row.items.length ? row.w + space : 0, w: dots });
  tail();
  return { size, rows, truncated: true };
}

// ---- the marquee -------------------------------------------------------------------------------------------------------

// How far (whole logical pixels, 0 <= off < textW + gap) a too-long text is scrolled left at time t. It rests at the start for
// pauseMs, scrolls speed px a second, and wraps seamlessly: draw the text at -off and again at -off + textW + gap. A text that
// fits does not move.
export function marqueeOffset(textW, boxW, tMs, { speed = 14, pauseMs = 2000, gap = 24 } = {}) {
  if (textW <= boxW) return 0;
  const cycle = textW + gap;
  const travel = (cycle / speed) * 1000;
  const phase = ((tMs % (pauseMs + travel)) + (pauseMs + travel)) % (pauseMs + travel);
  if (phase < pauseMs) return 0;
  return Math.min(cycle - 1, Math.floor(((phase - pauseMs) / 1000) * speed));
}

// ---- which line is on screen, and how bright each word is --------------------------------------------------------------

export const PREROLL_MS = 1700; // the next line appears (dim) this long before it is sung
export const SUB_MS = 7000; // the line after it shows, small, when it is at most this far away
const lastEnd = (line) => (line.words.length ? Math.max(line.words[line.words.length - 1].end, line.time) : line.time);
const norm = (line) => line.words.map((w) => w.text).join(' ').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();

// The indices of lines whose text occurs again elsewhere in the song (a repeated chorus line).
export function repeatedLines(lines) {
  const seen = new Map();
  lines.forEach((l, i) => {
    const k = norm(l);
    if (k.length >= 6) seen.set(k, (seen.get(k) || 0) + 1);
  });
  const out = new Set();
  lines.forEach((l, i) => {
    if ((seen.get(norm(l)) || 0) >= 2) out.add(i);
  });
  return out;
}

// When line i stops being shown. Ordinary lines stay a short while after the last word; a held line (longer than 4 s) or a
// repeated chorus line stays until just before the next line, but never longer than 6 s into an instrumental break.
export function showUntil(lines, i, repeated) {
  const line = lines[i];
  const end = lastEnd(line);
  const next = lines[i + 1];
  const nextTime = next ? next.time : Infinity;
  const important = end - line.time > 4000 || repeated.has(i);
  let until = important ? Math.min(nextTime - 300, end + 6000) : Math.min(nextTime - 300, end + 1800);
  until = Math.max(until, Math.min(line.time + 500, nextTime));
  return Math.min(until, nextTime);
}

const firstWithWords = (lines, from) => {
  for (let j = Math.max(0, from); j < lines.length; j++) if (lines[j].words.length) return j;
  return -1;
};

// Which line is the main one and which the small one under it, at position pos (ms) with the timeline's current index.
// main -1: nothing to sing right now (the idle screen).
export function visibleLines(lines, index, pos, repeated) {
  let main = -1;
  if (index >= 0 && lines[index]?.words.length && pos < showUntil(lines, index, repeated)) main = index;
  else {
    const n = firstWithWords(lines, index + 1);
    if (n >= 0 && lines[n].time - pos <= PREROLL_MS) main = n;
  }
  let sub = -1;
  if (main >= 0) {
    const n = firstWithWords(lines, main + 1);
    if (n >= 0 && lines[n].time - pos <= SUB_MS) sub = n;
  }
  return { main, sub };
}

export const TONE_DIM = 0;
export const TONE_BRIGHT = 1;
export const TONE_MID = 2;
export const SUNG_DIM_MS = 3200; // a sung word settles one step dimmer after this long

// The tone of a word at position pos: dim before its start frame; full bright from its start frame on; a little dimmer a few
// seconds after it ended. shown is the time the word shows (its own start, or the line's start in line mode).
export function wordTone(pos, shown, end) {
  if (pos < shown) return TONE_DIM;
  return pos > Math.max(end, shown) + SUNG_DIM_MS ? TONE_MID : TONE_BRIGHT;
}

// A fade that ends in `ms`: 0..1 from the moment it started.
export const progressOf = (now, t0, ms) => (ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - t0) / ms)));

// A whole-pixel offset that drifts back and forth: amp pixels either way over `periodS` seconds. Whole pixels only, so
// nothing shimmers.
export const panOffset = (tSec, amp, periodS, phase = 0) => Math.round(Math.sin((tSec / periodS) * Math.PI * 2 + phase) * amp);

// A cloud's x at time t: drifts left at `speed` px/s and wraps around the screen (whole pixels).
export function cloudX(x0, speed, tSec, lw, spriteW) {
  const span = lw + spriteW;
  const v = Math.floor(x0 - speed * tSec);
  return ((((v % span) + span) % span) - spriteW);
}

// mm:ss
export function clockText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
