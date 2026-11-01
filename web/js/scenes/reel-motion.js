// The maths of the Reel scene: which word is the hero, how a line is laid out, how words enter, which effects a line may
// use, and the background grading. Everything here is a pure function of its inputs (no canvas, no clock), so it is
// unit-tested in Node. The scene (reel.js) only draws what these functions decide.
//
// Rules this file enforces (each has a test in test/reel.test.js):
//  * every non-hero word's box stays inside the 5% safe margin; the hero may bleed at most 15% of its width over an
//    edge, and only when at least 70% of its letters stay fully on screen (so never for words under 4 letters)
//  * the hero of a line is never in the same screen area as the hero of the line before
//  * a word is fully visible on its start frame: entrances only use room that exists around the word
//  * at most 3 effects per line; RGB split and distortion on at most 1 line in 3
//  * flicker: at most 2 per line, never in a word's first 150 ms, never closer than 700 ms to another one, and never within
//    400 ms of a line change, so nothing ever flickers faster than 3 times a second
//  * the cover mask is used on every 4th line at most, never on two lines in a row
import { clamp, easeOut, hash } from './motion.js';
import { loudestIndex, wordScores } from './kinetic-layout.js';
import { sizeFor, splitRuns } from './reel-fonts.js';

export const SAFE = 0.05; // every word but the hero stays this far (of the screen) from every edge
export const HERO_MAX = 0.45; // the hero's cap height is at most this much of the screen height
export const MAX_CROP = 0.15; // the hero may be cropped by the screen edge by this much of its width...
export const MIN_VISIBLE = 0.7; // ...but at least this share of its letters stay fully visible
export const MIN_CAP = 20; // the smallest cap height (px) of any word but the hero
export const HOLD = 1.05; // room kept for a held word's stretch
export const ENTER_FULL = 150; // ms until an entrance is over (no flicker before this)
// The bottom of the screen belongs to the playback controls: no text is laid out below this line. (The controls take about
// 130 px at 1920x1080 and 175 px in a narrow window, so 185 px, but never more than 22% of the height.)
export const bottomLimit = (h) => h - Math.max(h * SAFE, Math.min(185, h * 0.22));
export const MAX_LETTER_CUT = 0.3;
const ACCENTED = /[À-ÖØ-ÞĀ-ſ]/; // no letter of the hero may be cut by the screen edge by more than this share of its width
export const KINDS = ['stacked', 'diagonal', 'rot90'];
const PAD = 0.12; // outline and jitter room around a word, as a share of its cap height

export const lettersOf = (text) => (String(text).match(/[\p{L}\p{N}]/gu) || []).length;
export const heroIndex = (words) => loudestIndex(words);

// ---------------------------------------------------------------------------------------------------------------------
// Letters: each letter of a word gets its own small rotation, baseline shift and size, fixed for the word (seeded).
// metricsOf() lays the letters out: { width, letters: [{ ch, font, x, adv, size, rot, dy }] } at a given cap height.
// charW(fontId, ch) is the advance of ch in em (the scene measures it with measureText; the tests use a table).
export const JITTER_ROT = 0.0524; // 3 degrees
export function metricsOf(text, fontId, cap, charW, key) {
  const letters = [];
  let x = 0;
  let k = 0;
  for (const run of splitRuns(text, fontId)) {
    for (const ch of run.t) {
      const size = sizeFor(run.font, cap) * (1 + (hash(k, key * 7 + 1) - 0.5) * 0.12);
      const adv = charW(run.font, ch) * size;
      letters.push({ ch, font: run.font, x, adv, size, rot: (hash(k, key * 7 + 2) - 0.5) * 2 * JITTER_ROT, dy: (hash(k, key * 7 + 3) - 0.5) * 0.08 * cap });
      x += adv + size * 0.012;
      k++;
    }
  }
  return { width: Math.max(0, x - (letters.length ? letters[letters.length - 1].size * 0.012 : 0)), letters };
}

// The key that seeds a word's jitter: stable for a word of a song, different for every word.
export const wordKey = (seed, li, wi) => (Math.imul(seed | 0, 31) + li * 131 + wi * 17 + 7) | 0;

// ---------------------------------------------------------------------------------------------------------------------
// Which layout a line gets: stacked, diagonal or rotated-90. Never the same kind twice in a row (so never the same
// screen area either), but otherwise random for the song.
export function kindOf(seed, li) {
  let k = Math.floor(hash(0, seed + 5) * 3);
  for (let j = 1; j <= li; j++) k = (k + 1 + Math.floor(hash(j, seed + 5) * 2)) % 3;
  return KINDS[k];
}

// Effects: a line gets at most 3 of rgb, distort, trail, ghost, flicker. The strong ones (rgb, distort) belong to one line
// in three; the others share what is left. The trail only lasts 120 ms of each entrance.
export function effectsOf(li, seed) {
  const strong = (li + Math.floor(hash(3, seed) * 3)) % 3 === 0;
  if (strong) return { strong: true, rgb: true, distort: hash(li, seed + 61) < 0.6, trail: true, ghost: false, flicker: false, count: 0 };
  const ghost = hash(li, seed + 62) < 0.7;
  const flicker = hash(li, seed + 63) < 0.4;
  return { strong: false, rgb: false, distort: false, trail: true, ghost, flicker, count: 0 };
}
export const effectCount = (e) => (e.rgb ? 1 : 0) + (e.distort ? 1 : 0) + (e.trail ? 1 : 0) + (e.ghost ? 1 : 0) + (e.flicker ? 1 : 0);

// Flickers of one line: [{ t, word, dur }] with t in ms from the line's start. Only words that have finished entering
// can flicker; two flickers are at least 700 ms apart; none within 400 ms of either end of the line.
// starts[i]: when word i shows, relative to the line's start.
export function flickersOf(li, seed, starts, lineMs, hero) {
  const out = [];
  if (!(lineMs >= 1400)) return out;
  const last = lineMs - 400;
  let t = 400 + hash(li, seed + 71) * Math.max(0, last - 400 - 700) * 0.5;
  for (let n = 0; n < 2 && t <= last; n++) {
    const ok = [];
    starts.forEach((s, i) => {
      if (i !== hero && s + ENTER_FULL <= t) ok.push(i);
    });
    if (ok.length) out.push({ t, word: ok[Math.floor(hash(li * 3 + n, seed + 72) * ok.length)], dur: 34 + Math.floor(hash(li + n, seed + 73) * 2) * 16 });
    t += 700 + hash(li + n, seed + 74) * 500;
  }
  return out;
}

// Alpha of a flickering word at `since` ms after the flicker began (1 when none): dips for 2 to 3 frames.
export const flickerAlpha = (since, dur) => (since >= 0 && since < dur ? 0.35 : 1);

// ---------------------------------------------------------------------------------------------------------------------
// The cover mask: every `every`th line the hero word shows the album cover instead of a colour. A line must have a hero of
// at least 4 letters and not be extremely long, and not use the rotated layout (the cover would turn with the word);
// otherwise the next eligible line takes it. Returns an array of booleans, one per line; never two in a row.
export function pickMaskLines(n, eligible, every = 4) {
  const out = new Array(n).fill(false);
  let li = every - 1;
  while (li < n) {
    let j = li;
    while (j < n && !eligible(j)) j++;
    if (j >= n) break;
    out[j] = true;
    li = j + every;
  }
  return out;
}
export const LONG_LINE_CHARS = 48;
export const LONG_LINE_WORDS = 9;
export function maskEligible(words, kind) {
  if (!words.length || kind === 'rot90') return false;
  const h = heroIndex(words);
  const chars = words.reduce((a, w) => a + w.text.length + 1, 0);
  return h >= 0 && lettersOf(words[h].text) >= 4 && chars <= LONG_LINE_CHARS && words.length <= LONG_LINE_WORDS;
}

// ---------------------------------------------------------------------------------------------------------------------
// The cover: how dark the scrim must be, and whether the mask would be readable.
// data: RGBA bytes of the cover drawn at screen aspect into a small canvas of size cw x ch.
export const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
export function regionStats(data, cw, ch, x0, y0, x1, y1) {
  const ax = clamp(Math.floor(x0 * cw), 0, cw - 1);
  const bx = clamp(Math.ceil(x1 * cw), ax + 1, cw);
  const ay = clamp(Math.floor(y0 * ch), 0, ch - 1);
  const by = clamp(Math.ceil(y1 * ch), ay + 1, ch);
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = ay; y < by; y++) {
    for (let x = ax; x < bx; x++) {
      const i = (y * cw + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      sum += l;
      sq += l * l;
      n++;
    }
  }
  const mean = n ? sum / n : 0.3;
  return { mean, sd: n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0 };
}
// The black scrim over the cover: 25% over a dark cover, up to 45% over a bright one.
export const scrimFor = (meanLuma) => 0.25 + 0.2 * clamp(meanLuma / 0.6, 0, 1);
// The cover under a masked word is shown unscrimmed. It is only used when it is not very bright (the cream colour would
// read better) and not nearly the same as the (scrimmed) cover around it, or the word would melt into the background.
export function maskUsable(inner, ring, scrim) {
  const bg = ring * (1 - scrim);
  if (inner.mean > 0.78) return false;
  if (Math.abs(inner.mean - bg) < 0.06 && inner.sd < 0.1) return false;
  return true;
}

// Ken Burns drift and zoom of the cover, a pure function of the song's position and seed: a triangle wave over 80 s, in a
// direction that depends on the song. The cover is drawn at least 1.08x so the drift never shows an edge. out: { z, ox, oy }
export function kenBurns(pos, seed, out) {
  const p = (pos / 80000) % 1;
  const tri = p < 0.5 ? p * 2 : 2 - p * 2; // 0..1..0
  const a = hash(1, seed + 81) * Math.PI * 2;
  out.z = 1.08 + 0.05 * tri;
  out.ox = Math.cos(a) * 0.03 * (tri * 2 - 1);
  out.oy = Math.sin(a) * 0.03 * (tri * 2 - 1);
  return out;
}

// A quick punch-in of the cover at the start of some lines, 3 to 5%, rising in 70 ms and settling in about half a
// second. A line only punches when it is at least 500 ms after the previous punching line, so never more than twice a second.
export function punchLine(lines, li, seed) {
  if (li < 0 || hash(li, seed + 91) >= 0.5) return false;
  for (let j = li - 1, steps = 0; j >= 0 && steps < 6; j--, steps++) {
    if (lines[li].time - lines[j].time >= 500) return true;
    if (hash(j, seed + 91) < 0.5) return false;
  }
  return true;
}
export function punchAmount(lines, li, pos, seed, intensity) {
  if (!punchLine(lines, li, seed)) return 0;
  const since = pos - lines[li].time;
  if (!(since >= 0)) return 0;
  const a = (0.03 + 0.02 * hash(li, seed + 92)) * clamp(intensity, 0.3, 1.5);
  return since < 70 ? a * (since / 70) : a * Math.exp(-(since - 70) / 160);
}

// Camera shake on a hard cut: a few pixels that die away in 180 ms. out: { x, y }
export function shakeOf(since, li, seed, intensity, still, out) {
  out.x = 0;
  out.y = 0;
  if (still || !(since >= 0) || since > 180) return out;
  const k = (1 - since / 180) * 3 * intensity;
  const f = Math.floor(since / 16);
  out.x = (hash(f, li + seed) - 0.5) * 2 * k;
  out.y = (hash(f + 50, li + seed) - 0.5) * 2 * k;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Boxes. A word of natural width W and cap height C, turned by rot: its axis-aligned box.
export function boxOf(W, C, rot, out) {
  const bw0 = (W + 2 * PAD * C) * HOLD;
  const bh0 = C * (1 + 2 * PAD);
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  out.bw = c * bw0 + s * bh0;
  out.bh = s * bw0 + c * bh0;
  return out;
}

// How many of the hero's letters are fully on screen (0..1), from the placed word. Handles the two orientations the hero
// has: along the x axis (rot ~ 0) or along the y axis (rot ~ +-90 degrees).
export function heroVisible(word, w, h) {
  const ls = word.letters;
  if (!ls.length) return 1;
  const vertical = Math.abs(Math.sin(word.rot)) > 0.7;
  const total = word.width;
  const dir = word.rot < 0 ? -1 : 1;
  let seen = 0;
  for (const l of ls) {
    const a = l.x - total / 2;
    const b = a + l.adv;
    let lo;
    let hi;
    if (!vertical) {
      lo = word.cx + a;
      hi = word.cx + b;
      if (lo >= -0.5 && hi <= w + 0.5) seen++;
    } else {
      lo = dir > 0 ? word.cy + a : word.cy - b;
      hi = dir > 0 ? word.cy + b : word.cy - a;
      if (lo >= -0.5 && hi <= h + 0.5) seen++;
    }
  }
  return seen / ls.length;
}

// The largest share of one letter's width that the screen edge cuts off (0 when every letter is whole), same geometry as
// heroVisible. A letter cut by more than MAX_LETTER_CUT is no longer recognisable.
export function maxLetterCut(word, w, h) {
  const vertical = Math.abs(Math.sin(word.rot)) > 0.7;
  const total = word.width;
  const dir = word.rot < 0 ? -1 : 1;
  let worst = 0;
  for (const l of word.letters) {
    const a = l.x - total / 2;
    const b = a + l.adv;
    let lo;
    let hi;
    let max;
    if (!vertical) {
      lo = word.cx + a;
      hi = word.cx + b;
      max = w;
    } else {
      lo = dir > 0 ? word.cy + a : word.cy - b;
      hi = dir > 0 ? word.cy + b : word.cy - a;
      max = h;
    }
    const cut = (Math.max(0, -lo) + Math.max(0, hi - max)) / Math.max(1e-6, hi - lo);
    if (cut > worst) worst = cut;
  }
  return Math.min(1, worst);
}

// ---------------------------------------------------------------------------------------------------------------------
// planLine: the whole composition of one line, computed once on the line's first frame.
//   o.words: the line's timed words [{ text, start, end }]; o.texts: what is drawn for each (UPPERCASE); o.fonts: font id per word
//   o.metrics(text, fontId, cap, key) -> { width, letters } (the scene or the test supplies it)
//   o.prevCenter: { x, y } of the previous line's hero, as shares of the screen, or null
// Returns { kind, hero, words: [word...], heroCenter }. Every word: { i, text, font, role, cap, width, letters, key, cx, cy,
// rot, bw, bh, grow, slackX, slackY, enter }.
export function planLine(o) {
  const { w, h, li, seed, words, texts, fonts, prevCenter } = o;
  const n = texts.length;
  const plan = { li, kind: o.kind, hero: -1, words: [], heroCenter: { x: 0.5, y: 0.5 }, bled: false };
  if (!n) return plan;
  const hero = heroIndex(words);
  plan.hero = hero;
  const scores = wordScores(words);
  const maxS = Math.max(1e-6, ...scores);
  const roles = scores.map((s, i) => (i === hero ? 'hero' : s >= 0.55 * maxS ? 'mid' : 'small'));
  const keys = texts.map((_, i) => wordKey(seed, li, i));
  const ref = texts.map((t, i) => o.metrics(t, fonts[i], 100, keys[i]));
  const widthAt = (i, cap) => (ref[i].width * cap) / 100;
  const usableW = w * (1 - 2 * SAFE);
  const botY = bottomLimit(h);
  const usableH = botY - h * SAFE;
  const heroLetters = lettersOf(texts[hero]);
  // The space kept under the hero so that nothing sits on its hard shadow: the shadow's reach plus what the hero's slight tilt adds
  // at its ends.
  const gapUnder = (cap, width) => 0.13 * cap + 0.03 * width;
  const roundCap = (v) => Math.round(v * 2) / 2;

  const heroBase = h * (n === 1 ? 0.38 + (HERO_MAX - 0.38) * hash(li, seed + 21) : 0.28 + 0.12 * hash(li, seed + 21));
  const midK = 0.3 + 0.12 * hash(li, seed + 22);
  const smallK = 0.15 + 0.05 * hash(li, seed + 23);

  function build(kind) {
    const vertical = kind === 'rot90';
    const caps = new Array(n);
    let f = 1;
    let rows = null;
    let regionW = usableW;
    let heroT = 0;
    for (let iter = 0; iter < 12; iter++) {
      for (let i = 0; i < n; i++) {
        const base = roles[i] === 'hero' ? heroBase : roles[i] === 'mid' ? heroBase * midK : heroBase * smallK;
        caps[i] = roles[i] === 'hero' ? Math.max(36, base * f) : Math.max(MIN_CAP, base * f);
      }
      // the hero must fit along its own axis
      const heroMax = vertical ? usableH : usableW;
      const hw = widthAt(hero, caps[hero]) * HOLD + 2 * PAD * caps[hero];
      if (hw > heroMax) caps[hero] *= heroMax / hw;
      heroT = caps[hero] * (1 + 2 * PAD);
      regionW = vertical ? w * (1 - 2 * SAFE) - heroT - (w * 0.03 + 0.14 * caps[hero]) : usableW; // (the gap beside a vertical hero clears its shadow)
      if (vertical && regionW < w * 0.3) return null;
      for (let i = 0; i < n; i++) {
        if (i === hero) continue;
        const ww = widthAt(i, caps[i]) * HOLD + 2 * PAD * caps[i];
        // 3% of room is kept for the small tilt each row gets
        if (ww > regionW * 0.97) caps[i] = Math.max(MIN_CAP * 0.8, (caps[i] * regionW * 0.97) / ww);
      }
      const wrap = (idxs) => {
        const out = [];
        let cur = null;
        for (const i of idxs) {
          const ww = widthAt(i, caps[i]);
          const gap = caps[i] * 0.3;
          if (cur && cur.width + gap + ww <= regionW - 2 * PAD * Math.max(cur.cap, caps[i])) {
            cur.idx.push(i);
            cur.width += gap + ww;
            cur.cap = Math.max(cur.cap, caps[i]);
          } else {
            cur = { idx: [i], width: ww, cap: caps[i] };
            out.push(cur);
          }
        }
        return out;
      };
      const pre = wrap(Array.from({ length: hero }, (_, i) => i));
      const post = wrap(Array.from({ length: n - hero - 1 }, (_, i) => hero + 1 + i));
      rows = { pre, post };
      const sumH = (rs) => rs.reduce((a, r) => a + r.cap * (1 + 2 * PAD), 0) + Math.max(0, rs.length - 1) * 0.04 * heroBase;
      const total = vertical ? sumH([...pre, ...post]) : sumH([...pre, ...post]) + heroT + (post.length ? gapUnder(caps[hero], widthAt(hero, caps[hero])) : 0); // the gap under the hero keeps the next row off its shadow
      if (total <= usableH || f < 0.3) {
        rows.total = total;
        break;
      }
      f *= clamp(usableH / total, 0.55, 0.96);
    }
    if (!rows.total) rows.total = usableH;
    return { kind, caps, rows, regionW, heroT, vertical };
  }

  // place one variant of a built layout: { zoneT: 0..1, flip: 0|1 }
  function place(b, v) {
    const { kind, caps, rows, vertical } = b;
    const items = new Array(n);
    const put = (i, cx, cy, rot) => {
      items[i] = { i, cx, cy, rot };
    };
    const rowPlace = (rs, x0, regionW, yTop, pitchScale, rowOffset) => {
      let y = yTop;
      rs.forEach((r, ri) => {
        const rh = r.cap * (1 + 2 * PAD);
        const a = vertical || kind === 'stacked'
          ? [0, 0.5, 1][Math.floor(hash(li * 13 + ri + rowOffset, seed + 41 + v.flip * 5) * 3)]
          : n === 1 ? 0.5 : 0.04 + 0.92 * (v.flip ? 1 - (ri + rowOffset) / Math.max(1, b.rowCount - 1) : (ri + rowOffset) / Math.max(1, b.rowCount - 1));
        const left = x0 + Math.max(0, regionW - r.width - 2 * PAD * r.cap) * a + PAD * r.cap;
        let x = left;
        for (const i of r.idx) {
          const ww = widthAt(i, caps[i]);
          put(i, x + ww / 2, y + rh / 2 + (r.cap - caps[i]) / 2 + (hash(li * 17 + i, seed + 52) - 0.5) * 0.08 * caps[i], (hash(li * 17 + i, seed + 51) - 0.5) * 0.07);
          x += ww + caps[i] * 0.3;
        }
        y += (rh + 0.04 * heroBase) * pitchScale;
      });
      return y;
    };
    b.rowCount = rows.pre.length + rows.post.length + (vertical ? 0 : 1);
    const free = Math.max(0, usableH - rows.total);
    const pitch = rows.total > usableH ? usableH / rows.total : 1;
    if (!vertical) {
      const top = h * SAFE + free * v.zoneT;
      const yAfterPre = rowPlace(rows.pre, w * SAFE, usableW, top, pitch, 0);
      const heroCap = caps[hero];
      const heroH = heroCap * (1 + 2 * PAD);
      const hy = yAfterPre + heroH / 2;
      const hw = widthAt(hero, heroCap);
      const ha = kind === 'stacked' ? [0.12, 0.5, 0.88][Math.floor(hash(li, seed + 42 + v.flip * 7) * 3)] : n === 1 ? 0.5 : 0.04 + 0.92 * (v.flip ? 1 - rows.pre.length / Math.max(1, b.rowCount - 1) : rows.pre.length / Math.max(1, b.rowCount - 1));
      const hleft = w * SAFE + Math.max(0, usableW - hw - 2 * PAD * heroCap) * ha + PAD * heroCap;
      put(hero, hleft + hw / 2, hy, (hash(li, seed + 53) - 0.5) * 0.04);
      rowPlace(rows.post, w * SAFE, usableW, hy + heroH / 2 + gapUnder(heroCap, hw), pitch, rows.pre.length + 1);
    } else {
      const heroCap = caps[hero];
      const hw = widthAt(hero, heroCap);
      const left = v.side === 0;
      const hx = left ? w * SAFE + b.heroT / 2 : w * (1 - SAFE) - b.heroT / 2;
      put(hero, hx, (h * SAFE + botY) / 2 + (v.zoneT - 0.5) * Math.max(0, usableH - hw - 2 * PAD * heroCap), left ? -Math.PI / 2 : Math.PI / 2);
      const x0 = left ? w * SAFE + b.heroT + w * 0.03 + 0.14 * heroCap : w * SAFE;
      const top = h * SAFE + free * (1 - v.zoneT);
      const all = [...rows.pre, ...rows.post];
      rowPlace(all, x0, b.regionW, top, pitch, 0);
    }
    return items;
  }

  // finalize: boxes, clamping, bleed, grow room, entrances
  const tmp = { bw: 0, bh: 0 };
  function finish(b, items, v) {
    const { caps } = b;
    const heroMainSlack = heroLetters >= 4 ? 0.12 : 0;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const cap = caps[i];
      const hero_ = i === hero;
      const rot = it.rot;
      const W = widthAt(i, cap);
      boxOf(W, cap, rot, tmp);
      it.cap = cap;
      it.width = W;
      it.bw = tmp.bw;
      it.bh = tmp.bh;
      it.text = texts[i];
      it.font = fonts[i];
      it.role = roles[i];
      it.key = keys[i];
      it.letters = ref[i].letters.map((l) => ({ ...l, x: (l.x * cap) / 100, adv: (l.adv * cap) / 100, size: (l.size * cap) / 100, dy: (l.dy * cap) / 100 }));
      const vert = Math.abs(Math.sin(rot)) > 0.7;
      if (!hero_) {
        // accented capitals (É, Ñ, Å...) carry marks that rise above the cap height, so they get extra room on every side
        const acc = ACCENTED.test(texts[i]) ? 0.3 * cap : 0;
        it.cx = clamp(it.cx, w * SAFE + it.bw / 2 + acc, Math.max(w * SAFE + it.bw / 2 + acc, w * (1 - SAFE) - it.bw / 2 - acc));
        it.cy = clamp(it.cy, h * SAFE + it.bh / 2 + acc, Math.max(h * SAFE + it.bh / 2 + acc, botY - it.bh / 2 - acc));
      } else {
        // the hero: inside the safe margin across its word, and along it at most MAX_CROP over an edge (bleed)
        const along = vert ? it.bh : it.bw;
        const across = vert ? it.bw : it.bh;
        const hacc = ACCENTED.test(texts[i]) ? 0.3 * cap : 0;
        const bleed = v.bleed ? Math.min(heroMainSlack, MAX_CROP) : 0;
        // (the bleed is added below, and only when the real letters stay recognisable)
        const lo = along * 0.5;
        const hi = (vert ? botY : w) - along * 0.5;
        if (vert) {
          it.cy = clamp(it.cy, lo, Math.max(lo, hi));
          it.cx = clamp(it.cx, w * SAFE + across / 2 + hacc, Math.max(w * SAFE + across / 2 + hacc, w * (1 - SAFE) - across / 2 - hacc));
        } else {
          it.cx = clamp(it.cx, lo, Math.max(lo, hi));
          it.cy = clamp(it.cy, h * SAFE * 0.6 + across / 2 + hacc, Math.max(h * SAFE * 0.6 + across / 2 + hacc, botY - across / 2 - hacc));
        }
        if (v.bleed && !vert && it.bw > 0) {
          // push toward the nearest edge by the bleed, if that keeps the rule
          const pos = vert ? it.cy / h : it.cx / w;
          const dirN = pos < 0.5 ? -1 : 1;
          const slack = bleed * along;
          const target = (vert ? it.cy : it.cx) + dirN * slack;
          if (vert) it.cy = target;
          else it.cx = target;
          const saved = vert ? it.cy : it.cx;
          const placed = { letters: it.letters, width: it.width, cx: it.cx, cy: it.cy, rot: it.rot };
          if (heroVisible(placed, w, h) < MIN_VISIBLE + 0.01 || maxLetterCut(placed, w, h) > MAX_LETTER_CUT - 0.12) {
            if (vert) it.cy = saved - dirN * slack;
            else it.cx = saved - dirN * slack;
          } else plan.bled = true;
        }
      }
    }
    return items;
  }

  // grow room and entrance, after the final positions are known
  function enterOf(it) {
    const hero_ = it.i === hero;
    const vert = Math.abs(Math.sin(it.rot)) > 0.7;
    const hx = it.bw / 2;
    const hy = it.bh / 2;
    let slackL;
    let slackR;
    let slackT;
    let slackB;
    if (hero_) {
      // along its axis it may use the bleed room that is left; across, the safe margin
      const af = heroLetters >= 6 ? 0.1 : 0;
      const alongHalf = vert ? hy : hx;
      const along = vert ? it.cy : it.cx;
      const dim = vert ? h : w;
      const room = Math.min(along, dim - along);
      const growAlong = room / (alongHalf * (1 - 2 * af));
      const acrossHalf = vert ? hx : hy;
      const ac = vert ? it.cx : it.cy;
      const adim = vert ? w : h;
      const growAcross = Math.min(ac - adim * SAFE * 0.6, (vert ? w * (1 - SAFE * 0.6) : botY) - ac) / acrossHalf;
      it.grow = Math.max(1, Math.min(growAlong, growAcross));
      slackL = it.cx - hx - w * SAFE * 0.3;
      slackR = w * (1 - SAFE * 0.3) - (it.cx + hx);
      slackT = it.cy - hy - h * SAFE * 0.3;
      slackB = botY - (it.cy + hy);
    } else {
      slackL = it.cx - hx - w * SAFE;
      slackR = w * (1 - SAFE) - (it.cx + hx);
      slackT = it.cy - hy - h * SAFE;
      slackB = botY - (it.cy + hy);
      it.grow = Math.max(1, Math.min((it.cx - w * SAFE) / hx, (w * (1 - SAFE) - it.cx) / hx, (it.cy - h * SAFE) / hy, (botY - it.cy) / hy));
    }
    it.slackX = Math.max(0, Math.min(slackL, slackR));
    it.slackY = Math.max(0, Math.min(slackT, slackB));
    // an entrance that stays inside the screen on the very first frame
    const r = hash(it.key, 99);
    const choices = [];
    if (hero_) {
      if (it.grow >= 1.2) choices.push('zoom', 'zoom', 'pop');
      else choices.push('pop');
    } else {
      if (it.grow >= 1.15) choices.push('zoom');
      if (it.slackX >= it.cap * 0.25) choices.push('slideX');
      if (it.slackY >= it.cap * 0.25) choices.push('slideY');
      choices.push('snap');
      if (it.cap * 0.75 >= MIN_CAP) choices.push('pop');
    }
    const type = choices[Math.floor(r * choices.length)];
    const e = { type, from: 1, dx: 0, dy: 0, rot: 0 };
    if (type === 'zoom') e.from = Math.min(1.6, it.grow);
    else if (type === 'pop') e.from = hero_ ? 0.7 : 0.78;
    else if (type === 'slideX') e.dx = (hash(it.key, 98) < 0.5 ? -1 : 1) * Math.min(it.cap * 0.6, it.slackX);
    else if (type === 'slideY') e.dy = (hash(it.key, 97) < 0.5 ? -1 : 1) * Math.min(it.cap * 0.5, it.slackY);
    else {
      let rr = (hash(it.key, 96) < 0.5 ? -1 : 1) * 0.14;
      for (let k = 0; k < 4; k++) {
        const c = Math.abs(Math.cos(it.rot + rr));
        const s = Math.abs(Math.sin(it.rot + rr));
        const bw = c * (it.width * HOLD + 2 * PAD * it.cap) + s * it.cap * (1 + 2 * PAD);
        const bh = s * (it.width * HOLD + 2 * PAD * it.cap) + c * it.cap * (1 + 2 * PAD);
        if (it.cx - bw / 2 >= (hero_ ? -it.width * 0.1 : w * SAFE) && it.cx + bw / 2 <= (hero_ ? w + it.width * 0.1 : w * (1 - SAFE)) && it.cy - bh / 2 >= (hero_ ? 0 : h * SAFE) && it.cy + bh / 2 <= botY) break;
        rr *= 0.5;
        if (k === 3) rr = 0;
      }
      e.rot = rr;
    }
    it.enter = e;
  }

  // try the variants in a seeded order; take the first whose hero is far enough from the previous hero
  // a rotated layout that does not fit falls back to another kind, but not the previous line's
  const others = ['stacked', 'diagonal'].filter((k) => k !== o.prevKind);
  const kinds = o.kind === 'rot90' ? (o.prevKind === 'rot90' ? others : ['rot90', ...others]) : o.kind === o.prevKind ? others : [o.kind];
  let chosen = null;
  for (const kind of kinds) {
    const b = build(kind);
    if (!b) continue;
    const variants = [];
    for (let z = 0; z < 3; z++) for (let s = 0; s < 2; s++) variants.push(kind === 'rot90' ? { zoneT: [0.15, 0.5, 0.85][z], side: s, flip: s, bleed: false } : { zoneT: [0, 0.5, 1][z], flip: s, side: 0, bleed: kind === 'diagonal' && heroLetters >= 5 && hash(li, seed + 43) < 0.6 });
    const start = Math.floor(hash(li, seed + 44) * variants.length);
    let best = null;
    for (let k = 0; k < variants.length; k++) {
      const v = variants[(start + k) % variants.length];
      const items = finish(b, place(b, v), v);
      const hc = { x: items[hero].cx / w, y: items[hero].cy / h };
      const d = prevCenter ? Math.hypot(hc.x - prevCenter.x, hc.y - prevCenter.y) : 1;
      if (!best || d > best.d) best = { b, items, hc, d, v };
      if (d >= 0.22) break;
    }
    chosen = best;
    break;
  }
  plan.kind = chosen.b.kind;
  plan.words = chosen.items;
  plan.words.forEach(enterOf);
  plan.heroCenter = chosen.hc;
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------
// An entrance at `since` ms after the word's start. out: { s, dx, dy, rot, trail } (trail 0..1: how strong the motion trail is).
// With reduce motion, or after ENTER_FULL, the word simply sits at rest.
export function entranceOf(word, since, still, out) {
  out.s = 1;
  out.dx = 0;
  out.dy = 0;
  out.rot = 0;
  out.trail = 0;
  if (still || !(since >= 0) || since >= ENTER_FULL) return out;
  const k = 1 - easeOut(since / ENTER_FULL);
  const e = word.enter;
  if (e.type === 'zoom' || e.type === 'pop') out.s = 1 + (e.from - 1) * k;
  else if (e.type === 'slideX') out.dx = e.dx * k;
  else if (e.type === 'slideY') out.dy = e.dy * k;
  else out.rot = e.rot * k;
  out.trail = since < 120 ? 1 - since / 120 : 0;
  return out;
}

// A held word stretches a little while it is sung: along its own width, up to 5%, and back after it ends.
export function holdStretch(word, since, still) {
  if (still || !(since >= 0)) return 1;
  const dur = word.dur;
  if (!(dur >= 600)) return 1;
  if (since < dur) return 1 + 0.05 * easeOut(since / (dur * 0.8));
  return 1 + 0.05 * Math.max(0, 1 - (since - dur) / 160);
}

// RGB split of the hero on a strong line: the offset in px, 2 to 6 at the cut, settling to 0 within 150 ms.
export function rgbOffset(since, li, seed, intensity, still) {
  if (still || !(since >= 0) || since >= 150) return 0;
  return (2 + 4 * hash(li, seed + 101)) * intensity * (1 - easeOut(since / 150));
}

// Slice distortion of the hero for about 3 frames after the cut: the shift in px of slice `s`.
export function sliceShift(s, since, cap, li, seed, intensity, still) {
  if (still || !(since >= 0) || since >= 50) return 0;
  const amp = Math.min(0.035 * cap, 14) * intensity;
  return (hash(s + Math.floor(since / 16.7) * 11, li + seed) - 0.5) * 2 * amp;
}

// Intensity: Calm, Normal, Wild
export const INTENSITY = { calm: 0.45, normal: 1, wild: 1.7 };
