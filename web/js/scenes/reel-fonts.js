// The ten display fonts of the Reel scene: which fonts there are, how big each must be set so capitals look equally tall,
// which characters each one has (so a missing character is drawn in Anton and never as a box), and how a song gets its own
// random picks. Pure functions, no canvas: all of it is unit-tested.
//
// Every font is bundled (web/fonts, licences next to the files) and is heavy. `ink` is the measured share of the box of
// the letter H that is ink (in headless Chromium, tools/font-probe.mjs); a font under MIN_INK gets a faux-bold stroke
// (`bolden`, a fraction of the font size) so no font in the mix is thin. `cap` is the measured cap height as a fraction of
// the font size: the scene sets every font so its CAP HEIGHT is the same, not its font size.
import { hash } from './motion.js';
import { FONT_DATA } from './reel-fonts-data.js';

export const FALLBACK = 'Anton'; // draws any character the chosen font does not have
export const SYSTEM = 'sys'; // the last resort for a character not even Anton has (emoji, other scripts): the system's bold sans
export const MIN_INK = 0.5; // the thinnest a font may look, as ink share of an H after the faux-bold (see inkOf)

export const FONTS = [
  { id: 'Anton', family: 'Anton', data: 'Anton', cap: 0.86, ink: 0.826, bolden: 0, upper: true, mood: 'condensed' },
  { id: 'BebasNeue', family: 'Bebas Neue', data: 'BebasNeue', cap: 0.7, ink: 0.678, bolden: 0, upper: true, mood: 'condensed' },
  { id: 'ArchivoBlack', family: 'Archivo Black', data: 'ArchivoBlack', cap: 0.69, ink: 0.723, bolden: 0, upper: true, mood: 'poster' },
  { id: 'RubikMonoOne', family: 'Rubik Mono One', data: 'RubikMonoOne', cap: 0.7, ink: 0.8, bolden: 0, upper: true, mood: 'poster' },
  { id: 'BowlbyOne', family: 'Bowlby One', data: 'BowlbyOne', cap: 0.745, ink: 0.863, bolden: 0, upper: true, mood: 'poster' },
  { id: 'AlfaSlabOne', family: 'Alfa Slab One', data: 'AlfaSlabOne', cap: 0.78, ink: 0.826, bolden: 0, upper: true, mood: 'slab' },
  { id: 'PermanentMarker', family: 'Permanent Marker', data: 'PermanentMarker', cap: 0.74, ink: 0.532, bolden: 0.02, upper: true, mood: 'marker' },
  { id: 'Bangers', family: 'Bangers', data: 'Bangers', cap: 0.735, ink: 0.551, bolden: 0.018, upper: true, mood: 'comic' },
  { id: 'SpecialElite', family: 'Special Elite', data: 'SpecialElite', cap: 0.69, ink: 0.392, bolden: 0.04, upper: true, mood: 'typewriter' },
  { id: 'Bungee', family: 'Bungee', data: 'Bungee', cap: 0.72, ink: 0.788, bolden: 0, upper: true, mood: 'quirky' },
];

export const FONT_IDS = FONTS.map((f) => f.id);
const BY_ID = new Map(FONTS.map((f) => [f.id, f]));
export const fontOf = (id) => BY_ID.get(id) ?? BY_ID.get(FALLBACK);
// The quoted family for ctx.font. The system fallback is a plain bold sans stack.
export const familyOf = (id) => (id === SYSTEM ? 'sans-serif' : `"${fontOf(id).family}"`);
// The weight and style words of ctx.font ('bold' only for the system fallback: the display fonts have one weight).
export const weightOf = (id) => (id === SYSTEM ? '700' : '400');

// The cap height of a font as a fraction of its size; sizeFor() is the font size that gives a wanted cap height.
export const capRatio = (id) => (id === SYSTEM ? 0.72 : fontOf(id).cap);
export const sizeFor = (id, capPx) => capPx / capRatio(id);

// How heavy a font looks: ink share plus what the faux-bold adds (a stroke of bolden * size on both sides of every stem).
// Roughly, each 0.01 of bolden is worth 0.055 of ink on these fonts' stems.
export const inkOf = (id) => {
  const f = fontOf(id);
  return f.ink + f.bolden * 5.5;
};

// ---- glyph coverage: which characters a font has (from its cmap, see tools/font-metrics.mjs) ----
const RANGES = new Map(FONTS.map((f) => [f.id, FONT_DATA[f.data].ranges]));

export function hasGlyph(id, cp) {
  const r = RANGES.get(id);
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
}

// Characters that draw nothing or join the one before: never a reason to change font.
const joins = (cp) => cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1f3fb && cp <= 0x1f3ff);

// The text split into runs, each in a font that has all its characters: the chosen font where it can, else Anton, else
// the system font. [{ t, font }]. Most words are a single run.
export function splitRuns(text, id) {
  const runs = [];
  let cur = null;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    let f = id;
    if (!hasGlyph(id, cp) && !joins(cp)) f = hasGlyph(FALLBACK, cp) ? FALLBACK : SYSTEM;
    if (joins(cp) && cur) f = cur.font;
    if (cur && cur.font === f) cur.t += ch;
    else {
      cur = { t: ch, font: f };
      runs.push(cur);
    }
  }
  return runs;
}

// What is actually drawn for a word: UPPERCASE for the fonts that look better that way (all of them here).
export const caseOf = (id, text) => (fontOf(id).upper ? text.toLocaleUpperCase() : text);

// ---- picking fonts: random, but the same for the same song, so a word keeps its font while it is on screen ----
export const MAX_FONTS_PER_LINE = 3;

// A deterministic order of the usable fonts for a song (a seeded shuffle): the song's own "palette of fonts".
export function fontOrder(seed, ids = FONT_IDS) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(hash(i, seed + 4001) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Picks fonts line by line. The hero word of a line never has the font of the previous line's hero word, because the hero
// font of line j steps forward through the song's order by 1..n-1 places from line j-1's. Re-rolling a line (the Shuffle
// key) changes its step, and so changes the hero font of every later line too, which is fine: they are not on screen.
export function createFontPicker() {
  let key = '';
  let order = FONT_IDS;
  let single = false;
  let seed = 0;
  let shuffles = null;
  let chain = [];

  const rolls = (j) => shuffles?.get(j) ?? 0;
  // 1..n-1 places forward from the previous hero's font; a re-roll moves the step on by one, so it always changes
  const step = (j) => 1 + ((Math.floor(hash(j * 31 + 7, seed + 101) * (order.length - 1)) + rolls(j)) % (order.length - 1));

  return {
    // seed: a number for the song; ids: fonts that loaded; singleMode: the "Single font (Anton)" setting;
    // shuffleMap: line index -> how many times that line was re-rolled
    configure(songSeed, ids, singleMode, shuffleMap) {
      const k = `${songSeed}|${ids.join(',')}|${singleMode}|${shuffleMap ? [...shuffleMap].join(';') : ''}`;
      if (k === key) return;
      key = k;
      seed = songSeed;
      single = singleMode;
      shuffles = shuffleMap;
      order = fontOrder(songSeed, ids.length ? ids : [FALLBACK]);
      chain = [];
    },
    // the font of line li's hero word (a font id)
    heroFont(li) {
      if (single || order.length < 2) return single ? FALLBACK : order[0];
      if (chain.length === 0) chain[0] = Math.floor(hash(0, seed + 9) * order.length);
      for (let j = chain.length; j <= li; j++) chain[j] = (chain[j - 1] + step(j)) % order.length;
      return order[chain[li]];
    },
    // a font for every word of line li. heroIdx: which word is the hero. At most 3 different fonts; a line of 3 or more words
    // that has three fonts really shows all three.
    lineFonts(li, count, heroIdx) {
      const out = new Array(count);
      if (single || order.length < 2) return out.fill(single ? FALLBACK : order[0]);
      const hero = this.heroFont(li);
      const hi = order.indexOf(hero);
      const sd = seed + rolls(li) * 977;
      const wantThree = count >= 3 && hash(li, sd + 3) < 0.55;
      const a = order[(hi + 1 + Math.floor(hash(li, sd + 11) * (order.length - 1))) % order.length];
      let b = a;
      if (wantThree) {
        for (let k = 1; k < order.length && b === a; k++) {
          const c = order[(hi + 1 + Math.floor(hash(li, sd + 17) * (order.length - 1)) + k) % order.length];
          if (c !== hero && c !== a) b = c;
        }
      }
      let n = 0;
      for (let i = 0; i < count; i++) {
        if (i === heroIdx) out[i] = hero;
        else {
          out[i] = b !== a ? (n % 2 === 0 ? a : b) : a;
          n++;
        }
      }
      // beyond the first two, which of the two other fonts a word gets is random (but fixed for the word)
      let m = 0;
      for (let i = 0; i < count; i++) {
        if (i === heroIdx) continue;
        if (m >= 2 && b !== a) out[i] = hash(li * 97 + i, sd + 13) < 0.5 ? a : b;
        m++;
      }
      return out;
    },
  };
}
