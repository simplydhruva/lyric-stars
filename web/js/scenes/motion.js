// Small pure helpers shared by the new scenes: colour mixing, a stable pseudo-random number, easing, and
// the maths of each scene's motion (how far a word has fallen, risen, been typed...). No canvas in here,
// so it is all unit-tested. Everything is a function of the playback position, never of the wall clock.

export const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lift = ([r, g, b], k) => [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k].map(Math.round);
export const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn = (t) => Math.pow(clamp(t, 0, 1), 2);
export const easeInOut = (t) => {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
};

// The same two numbers always give the same value in [0, 1): a seed for a word's own sway, tilt or speed.
export function hash(a, b = 0) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// When a word shows: at its own start, or with its whole line in line mode (M).
export const shownAt = (word, line, mode) => (mode === 'line' ? line.time : word.start);

// How much of a word has been written 0..1 (a pen moving over it). With reduce motion it is all there at its start.
export function written(word, pos, still, mode, line) {
  const start = shownAt(word, line, mode);
  if (pos < start) return 0;
  if (mode === 'line') return 1;
  const span = word.end - word.start;
  if (still || !(span > 0)) return 1;
  return clamp((pos - start) / span, 0, 1);
}

// The pen on one word. frac is written() (0..1), width the word's width, font its size in px. Returns how wide the ink
// has filled (fillW), how far the outline has been traced ahead of it (traceW, always a little past the fill so the first
// letter's outline is on screen on the very frame the word starts), and how long the traced dash is (dash). The pen
// leads, the ink follows. With reduce motion, or once the word is done, it is all ink and no outline.
export function penState(frac, width, font, still = false) {
  if (still || frac >= 1) return { fillW: width, traceW: width, dash: 0, tracing: false };
  const lag = font * 0.55;
  const fillW = clamp(frac * width - lag * (1 - frac), 0, width);
  const traceW = clamp(frac * width + font * 0.3, 0, width);
  return { fillW, traceW, dash: font * (0.6 + 5 * clamp(frac, 0, 1)), tracing: true };
}

// Ink fades after the line is done: held for a while, then dimmer before the next line is long under way.
export const inkAlpha = (sinceLineStart) => 1 - clamp((sinceLineStart - 3000) / 2500, 0, 1) * 0.55;

// Rain: how far a word has fallen. 0 at the top when it starts, 1 once it has landed. Each word has its own speed.
export function fallDuration(lineIndex, wordIndex) {
  return 900 + hash(lineIndex, wordIndex) * 600;
}
export const fallProgress = (sinceStart, duration, still) => (still ? 1 : easeIn(sinceStart / duration));

// A little rebound when a word lands: 0 to -0.5 of a bounce height, over 260 ms after landing.
export function landBounce(sinceLanding) {
  if (sinceLanding < 0 || sinceLanding > 260) return 0;
  const t = sinceLanding / 260;
  return -Math.sin(t * Math.PI) * (1 - t) * 0.5;
}

// Lanterns: how far up the screen a lantern is, 0 at the bottom when it is born, 1 at the top when it burns out.
export const LANTERN_LIFE_MS = 7500;
export const lanternRise = (sinceStart) => clamp(sinceStart / LANTERN_LIFE_MS, 0, 1);
export const lanternAlpha = (sinceStart) => {
  const p = lanternRise(sinceStart);
  return p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1;
};

// Neon: a tube flickers when it first lights. The first moment is always lit, so a word shows at its start.
export function neonFlicker(sinceStart, seed, still) {
  if (still || sinceStart >= 420) return 1;
  const bucket = Math.floor(sinceStart / 45);
  return bucket === 0 || hash(bucket, seed) > 0.3 ? 1 : 0.3;
}

// Typewriter: how many characters of a word are typed. At least one the moment it starts.
export function typedChars(length, start, end, pos, still, whole = false) {
  if (pos < start) return 0;
  if (still || whole) return length;
  const span = Math.min(Math.max(end - start, 1), length * 70);
  return clamp(Math.floor((length * (pos - start)) / span) + 1, 1, length);
}

// The cursor: solid while typing, then blinking twice a second, on the song clock.
export const cursorOn = (sinceTyping, pos) => sinceTyping < 600 || Math.floor(pos / 520) % 2 === 0;

// Ribbon: how lively a line is, 0..1, from how fast it is sung (words per second); a chorus line gets a lift.
export function lineEnergy(line, isChorus) {
  const n = line.words.length;
  if (!n) return 0;
  const dur = Math.max(line.words[n - 1].end - line.words[0].start, 600);
  return clamp(((n / dur) * 1000) / 4 + (isChorus ? 0.25 : 0), 0, 1);
}

// Ribbon height at x (0..1 across) and time pos: two slow waves that drift with the song.
export function waveY(x, pos, amplitude) {
  return amplitude * (Math.sin(x * 7 + pos * 0.0016) + 0.5 * Math.sin(x * 13 - pos * 0.0011));
}

// Where a word sits on the orbit: angle 0 is the front. x in -1..1, y in -1..1 (front is positive),
// depth 0 (far side) to 1 (front).
// Pass `into` (an old result) to reuse its object instead of allocating a new one every frame.
export function orbitSpot(i, c, n, into = {}) {
  const theta = ((i - c) * 2 * Math.PI) / Math.max(n, 1);
  into.x = Math.sin(theta);
  into.y = Math.cos(theta);
  into.depth = (Math.cos(theta) + 1) / 2;
  return into;
}

// A card sliding in or out: 0 settled, 1 fully away.
export const SLIDE_MS = 450;
export const slideIn = (sinceStart, still) => (still ? 0 : 1 - easeOut(sinceStart / SLIDE_MS));
export const slideOut = (sinceNext, still) => (still ? 1 : easeOut(sinceNext / SLIDE_MS));
