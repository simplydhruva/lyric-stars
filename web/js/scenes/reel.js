// Reel: kinetic typography in the style of an edited social-media reel. The album cover fills the screen (dimmed, with a
// vignette, film grain and a slow drift); every line is a hard cut to a fresh composition of oversized, outlined, textured
// capitals in a few different display fonts; the stressed word is huge, and now and then it is filled with the cover itself.
//
// The timing rule, as in every scene: a word is fully readable on its start frame, at full strength. Only things around
// it (a trail, a colour fringe, a ghost of the last line, the zoom it settles from) move. The maths lives in
// reel-motion.js (layout, entrances, effects) and reel-fonts.js (fonts, glyph coverage); both are unit-tested. This file
// only paints. Nothing is allocated per frame, and no shadowBlur or filter is used while drawing: every word is baked
// once into its own small canvas (outline, shadow, fill and print texture) and drawn from there.
import { artImage, pokeRedraw } from './art.js';
import { emotionOf } from './emotion.js';
import { clamp, hash, shownAt } from './motion.js';
import { loudestIndex } from './kinetic-layout.js';
import { seedInt } from './polaroid-motion.js';
import { FONTS, FONT_IDS, FALLBACK, caseOf, createFontPicker, familyOf, fontOf, weightOf } from './reel-fonts.js';
import {
  INTENSITY,
  effectsOf, entranceOf, flickerAlpha, flickersOf, holdStretch, kenBurns, kindOf, maskEligible, maskUsable, metricsOf, pickMaskLines,
  planLine, punchAmount, regionStats, rgbOffset, scrimFor, shakeOf, sliceShift,
} from './reel-motion.js';

const CREAM = 'rgb(246,238,216)';
const ORANGE = 'rgb(255,138,34)';
const RED = 'rgb(236,48,44)';
const PINK = 'rgb(255,102,158)';
const MAX_SPRITE_PIXELS = 9e6; // a baked word is never bigger than this many device pixels
const MAX_POOL = 24;
const COVER_FADE_MS = 300;
const SAMPLE_W = 64; // the cover is sampled at this width (screen aspect) to measure its brightness

let shuffleRequests = 0; // the T key: asks the scene to re-roll the fonts of the line on screen
export function requestFontShuffle() {
  shuffleRequests++;
  pokeRedraw();
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function createReel() {
  let ctx = null;

  // ---- canvases: every offscreen canvas comes from here and goes back here, so the count is known and bounded ----
  const pool = [];
  let live = 0;
  const stats = { canvases: 0, pooled: 0, sprites: 0, plans: 0, bytes: 0 };
  function acquire(w, h) {
    const c = pool.pop() || makeCanvas(1, 1);
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    live++;
    return c;
  }
  function release(c) {
    if (!c) return;
    live--;
    if (pool.length < MAX_POOL) {
      c.width = 1;
      c.height = 1;
      pool.push(c);
    } else {
      c.width = 0;
      c.height = 0;
    }
  }

  // ---- fonts ----
  let fontsReady = false;
  let fontsRequested = false;
  let okIds = FONT_IDS.slice();
  const picker = createFontPicker();
  const advances = new Map();
  const inks = new Map();
  function loadFonts() {
    fontsRequested = true;
    if (typeof document === 'undefined' || !document.fonts?.load) {
      fontsReady = true;
      return;
    }
    Promise.allSettled(FONTS.map((f) => document.fonts.load(`400 48px "${f.family}"`, 'AaHh'))).then(() => {
      const loaded = new Set();
      document.fonts.forEach((ff) => {
        if (ff.status === 'loaded') loaded.add(String(ff.family).replace(/["']/g, ''));
      });
      okIds = FONTS.filter((f) => loaded.has(f.family)).map((f) => f.id);
      if (!okIds.length) okIds = [FALLBACK];
      fontsReady = true;
      inks.clear();
      advances.clear(); // widths measured with a stand-in font are wrong
      resetAll();
      pokeRedraw();
    });
  }
  // The advance of one character in em, measured once per font and character.
  function advanceOf(fontId, ch) {
    const k = fontId + ch;
    let v = advances.get(k);
    if (v === undefined) {
      ctx.font = `${weightOf(fontId)} 100px ${familyOf(fontId)}`;
      v = ctx.measureText(ch).width / 100;
      advances.set(k, v);
    }
    return v;
  }
  // The real ink of one character per unit of font size: [left, right, ascent, descent] around its origin and baseline.
  function inkOf(fontId, ch) {
    const k = fontId + ch;
    let v = inks.get(k);
    if (v === undefined) {
      ctx.font = `${weightOf(fontId)} 400px ${familyOf(fontId)}`; // (measured big: the browser rounds these to whole pixels)
      const m = ctx.measureText(ch);
      v = [m.actualBoundingBoxLeft / 400, m.actualBoundingBoxRight / 400, m.actualBoundingBoxAscent / 400, m.actualBoundingBoxDescent / 400];
      inks.set(k, v);
    }
    return v;
  }
  const metrics = (text, fontId, cap, key) => metricsOf(text, fontId, cap, advanceOf, key);

  // ---- per-song state ----
  let seedKey = null;
  let seedI = 0;
  let shuffles = new Map(); // line -> how many times its fonts were re-rolled
  let seenShuffles = 0;
  let masks = null; // one boolean per line: this line's hero shows the cover
  let masksFor = null;
  const plans = new Map(); // line -> plan
  const runs = new Map(); // line -> { plan, sprites[], tints, fx, flickers, ... } (only the lines on or near the screen)
  let sizeKey = '';

  function resetAll() {
    for (const rt of runs.values()) freeRun(rt);
    runs.clear();
    plans.clear();
  }
  function freeRun(rt) {
    for (const s of rt.sprites) if (s) release(s.cv);
    if (rt.tints) for (const t of rt.tints) release(t);
    rt.sprites.length = 0;
    rt.tints = null;
  }

  // ---- the cover: baked background, brightness sample ----
  let bg = null; // { url, key, canvas, sample: {data,w,h}|null, scrim, since }
  function sampleCover(img, w, h) {
    try {
      const sw = SAMPLE_W;
      const sh = Math.max(8, Math.round((SAMPLE_W * h) / w));
      const c = acquire(sw, sh);
      const g = c.getContext('2d', { willReadFrequently: true });
      coverFit(g, img, 0, 0, sw, sh, 1);
      const data = g.getImageData(0, 0, sw, sh).data;
      release(c);
      return { data, w: sw, h: sh };
    } catch {
      return null;
    }
  }
  // cover-fit with a zoom: the image fills the box, centred, cropped (like object-fit: cover)
  function coverFit(g, img, x, y, w, h, z) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * z;
    const iw = w / s;
    const ih = h / s;
    g.drawImage(img, (img.naturalWidth - iw) / 2, (img.naturalHeight - ih) / 2, iw, ih, x, y, w, h);
  }
  function bakeBackground(frame, img) {
    const { w, h, dpr } = frame;
    const key = `${frame.art}|${w}x${h}@${dpr}|${frame.reelBackground}`;
    if (bg && bg.key === key) return bg;
    if (bg?.canvas) release(bg.canvas);
    const sample = sampleCover(img, w, h);
    let mean = 0.35;
    if (sample) mean = regionStats(sample.data, sample.w, sample.h, 0, 0, 1, 1).mean;
    const scrim = scrimFor(mean);
    const scale = Math.min(dpr, 2560 / w);
    const cw = Math.max(2, Math.round(w * scale));
    const ch = Math.max(2, Math.round(h * scale));
    const cv = acquire(cw, ch);
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (frame.reelBackground === 'blur') {
      // a soft blur without a filter: shrink the cover a lot, then stretch it back up smoothly
      const small = acquire(Math.max(8, Math.round(cw / 28)), Math.max(8, Math.round(ch / 28)));
      const sg = small.getContext('2d');
      sg.imageSmoothingQuality = 'high';
      coverFit(sg, img, 0, 0, small.width, small.height, 1);
      g.drawImage(small, 0, 0, cw, ch);
      release(small);
    } else {
      coverFit(g, img, 0, 0, cw, ch, 1);
    }
    // slightly desaturated: a grey layer in 'saturation' mode
    g.globalCompositeOperation = 'saturation';
    g.globalAlpha = 0.35;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, cw, ch);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    // the dark scrim, then the vignette
    g.fillStyle = `rgba(0,0,0,${scrim.toFixed(3)})`;
    g.fillRect(0, 0, cw, ch);
    const vg = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.hypot(cw, ch) * 0.55);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = vg;
    g.fillRect(0, 0, cw, ch);
    bg = { url: frame.art, key, canvas: cv, sample, scrim, since: frame.now, img };
    return bg;
  }

  // film grain: a tiny noise tile used as a pattern, shifted at random every other frame
  let grain = null;
  function grainPattern() {
    if (grain) return grain;
    const c = makeCanvas(192, 192);
    const g = c.getContext('2d');
    if (!g?.createImageData) return null;
    const d = g.createImageData(192, 192);
    let s = 9137;
    for (let i = 0; i < 192 * 192; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const v = s >>> 24;
      d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v;
      d.data[i * 4 + 3] = Math.abs(v - 128) * 0.55;
    }
    g.putImageData(d, 0, 0);
    grain = ctx.createPattern(c, 'repeat');
    return grain;
  }
  // the print texture of the letters: a halftone of dots with a few specks
  let halftone = null;
  function halftonePattern() {
    if (halftone) return halftone;
    const c = makeCanvas(48, 48);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.17)';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        g.beginPath();
        g.arc(x * 6 + (y % 2 ? 3 : 0), y * 6 + 3, 1.25, 0, 7);
        g.fill();
      }
    }
    let s = 4242;
    for (let i = 0; i < 70; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const x = (s >>> 8) % 48;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const y = (s >>> 8) % 48;
      g.fillStyle = i % 3 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)';
      g.fillRect(x, y, 2, 2);
    }
    halftone = ctx.createPattern(c, 'repeat');
    return halftone;
  }

  // ---- baking a word ----
  function colourOf(frame, plan, word) {
    const emo = emotionOf(word.text);
    if (emo === 'fire') return RED;
    if (emo === 'love' || emo === 'water' || emo === 'night') return PINK;
    if (emo === 'sun') return ORANGE;
    if (word.role === 'hero') return hash(plan.li, seedI + 31) < 0.5 ? ORANGE : CREAM;
    return CREAM;
  }

  function glyphs(g, word, mode) {
    // mode: 'fill' | 'stroke' | 'both'; letters turn individually about their centres
    const half = word.width / 2;
    const base = word.cap / 2;
    for (const l of word.letters) {
      g.save();
      g.translate(l.x - half + l.adv / 2, base - word.cap / 2 + l.dy);
      g.rotate(l.rot);
      g.font = `${weightOf(l.font)} ${l.size}px ${familyOf(l.font)}`;
      const bold = fontOf(l.font).bolden * l.size;
      if (mode !== 'stroke') {
        if (bold > 0) {
          g.lineWidth = bold * 2;
          g.strokeText(l.ch, -l.adv / 2, word.cap / 2);
        }
        g.fillText(l.ch, -l.adv / 2, word.cap / 2);
      } else {
        g.strokeText(l.ch, -l.adv / 2, word.cap / 2);
      }
      g.restore();
    }
  }

  // Bakes one word into a canvas: a hard drop shadow, a thick black outline, then the colour (or the cover) with the print
  // texture. Returns { cv, ox, oy, sw, sh, sc, masked }.
  function bake(frame, rt, word) {
    const cap = word.cap;
    const pad = cap * 0.24;
    const sw = word.width + 2 * pad + cap * 0.1;
    const sh = cap + 2 * pad + cap * 0.3;
    const ox = -sw / 2;
    const oy = -cap / 2 - pad;
    const sc = Math.min(frame.dpr, Math.sqrt(MAX_SPRITE_PIXELS / (sw * sh)));
    const pw = Math.ceil(sw * sc);
    const ph = Math.ceil(sh * sc);
    const cv = acquire(pw, ph);
    const g = cv.getContext('2d');
    g.setTransform(sc, 0, 0, sc, -ox * sc, -oy * sc);
    g.lineJoin = 'round';
    g.miterLimit = 2;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const outline = cap * 0.17;
    // 1. shadow: the outline shape again, shifted down and right, hard-edged
    g.save();
    g.translate(cap * 0.07, cap * 0.085);
    g.fillStyle = 'rgba(0,0,0,0.62)';
    g.strokeStyle = 'rgba(0,0,0,0.62)';
    g.lineWidth = outline;
    glyphs(g, word, 'stroke');
    glyphs(g, word, 'fill');
    g.restore();
    // 2. the thick black outline
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    g.lineWidth = outline;
    glyphs(g, word, 'stroke');
    glyphs(g, word, 'fill');
    // 3. the colour, with the halftone on it; or the cover itself for the masked hero
    const scratch = acquire(pw, ph);
    const s = scratch.getContext('2d');
    s.setTransform(sc, 0, 0, sc, -ox * sc, -oy * sc);
    s.textAlign = 'left';
    s.textBaseline = 'alphabetic';
    s.lineJoin = 'round';
    const masked = word.masked && bg?.img;
    const colour = word.colour;
    s.fillStyle = masked ? '#fff' : colour;
    s.strokeStyle = masked ? '#fff' : colour;
    glyphs(s, word, 'fill');
    s.save();
    s.globalCompositeOperation = masked ? 'source-in' : 'source-atop';
    if (masked) {
      // the unscrimmed cover as it lies on the screen under this word
      const W = frame.w;
      const H = frame.h;
      const k = Math.max(W / bg.img.naturalWidth, H / bg.img.naturalHeight);
      const offX = (W - bg.img.naturalWidth * k) / 2;
      const offY = (H - bg.img.naturalHeight * k) / 2;
      const X0 = word.cx + ox;
      const Y0 = word.cy + oy;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.drawImage(bg.img, (X0 - offX) / k, (Y0 - offY) / k, sw / k, sh / k, 0, 0, pw, ph);
    } else {
      const tex = halftonePattern();
      if (tex) {
        const t = clamp(cap / 170, 0.4, 1);
        s.scale(t, t);
        s.fillStyle = tex;
        s.fillRect(ox / t - 2, oy / t - 2, sw / t + 4, sh / t + 4);
      }
    }
    s.restore();
    if (masked) {
      // a light inner edge so the cover stays a letter
      s.save();
      s.globalCompositeOperation = 'source-atop';
      s.strokeStyle = 'rgba(255,255,255,0.7)';
      s.lineWidth = cap * 0.045;
      glyphs(s, word, 'stroke');
      s.restore();
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(scratch, 0, 0);
    g.restore();
    release(scratch);
    return { cv, ox, oy, sw, sh, sc, masked: !!masked };
  }

  // The red, green and blue copies of the hero for the colour fringe: its fill shape at half resolution.
  function bakeTints(frame, rt, word) {
    const spr = rt.sprites[word.i];
    const k = 0.5;
    const pw = Math.max(1, Math.ceil(spr.sw * spr.sc * k));
    const ph = Math.max(1, Math.ceil(spr.sh * spr.sc * k));
    const out = [];
    for (const col of ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)']) {
      const c = acquire(pw, ph);
      const g = c.getContext('2d');
      g.setTransform(spr.sc * k, 0, 0, spr.sc * k, -spr.ox * spr.sc * k, -spr.oy * spr.sc * k);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.lineJoin = 'round';
      g.fillStyle = col;
      g.strokeStyle = col;
      glyphs(g, word, 'fill');
      out.push(c);
    }
    rt.tints = out;
  }

  // ---- planning and the per-line runtime ----
  function planOf(frame, li) {
    let p = plans.get(li);
    if (p) return p;
    let from = li;
    while (from > 0 && !plans.has(from - 1)) from--;
    for (let j = from; j <= li; j++) {
      const words = frame.lines[j].words;
      const kind = kindOf(seedI, j);
      const texts = [];
      const fonts = [];
      const heroIdx = words.length ? loudestIndex(words) : -1;
      const picks = picker.lineFonts(j, words.length, heroIdx);
      words.forEach((wd, i) => {
        fonts.push(picks[i]);
        texts.push(caseOf(picks[i], wd.text));
      });
      const prev = j > 0 ? plans.get(j - 1) : null;
      const plan = planLine({ w: frame.w, h: frame.h, li: j, seed: seedI, words, texts, fonts, prevCenter: prev && prev.words.length ? prev.heroCenter : null, prevKind: prev ? prev.kind : null, kind, metrics, ink: inkOf });
      plans.set(j, plan);
    }
    return plans.get(li);
  }
  function runOf(frame, li) {
    let rt = runs.get(li);
    if (rt) return rt;
    const plan = planOf(frame, li);
    const line = frame.lines[li];
    const words = line.words;
    plan.words.forEach((w, i) => {
      w.dur = words[i].end > words[i].start ? words[i].end - words[i].start : 0;
    });
    const fx = effectsOf(li, seedI);
    const starts = words.map((w) => shownAt(w, line, frame.mode) - line.time);
    const next = frame.lines[li + 1];
    const lastEnd = words.length ? words[words.length - 1].end : line.time;
    const lineMs = (next ? next.time : lastEnd + 1500) - line.time;
    const iv = INTENSITY[frame.reelIntensity] ?? 1;
    rt = {
      li,
      plan,
      fx,
      starts,
      lineMs,
      sprites: [],
      tints: null,
      flickers: fx.flicker && iv >= 0.6 ? flickersOf(li, seedI, starts, lineMs, plan.hero) : [],
      masked: false,
      maskChecked: false,
    };
    runs.set(li, rt);
    return rt;
  }

  // Is this line's hero shown as the cover? (every 4th line, when the cover under the word is dark and different enough)
  function decideMask(frame, rt) {
    if (rt.maskChecked) return;
    rt.maskChecked = true;
    if (!masks[rt.li] || !bg?.img || !rt.plan.words.length) return;
    const hw = rt.plan.words[rt.plan.hero];
    if (!bg.sample) return;
    const { w, h } = frame;
    const x0 = (hw.cx - hw.bw / 2) / w;
    const x1 = (hw.cx + hw.bw / 2) / w;
    const y0 = (hw.cy - hw.bh / 2) / h;
    const y1 = (hw.cy + hw.bh / 2) / h;
    const inner = regionStats(bg.sample.data, bg.sample.w, bg.sample.h, x0, y0, x1, y1);
    const ring = regionStats(bg.sample.data, bg.sample.w, bg.sample.h, x0 - 0.06, y0 - 0.06, x1 + 0.06, y1 + 0.06).mean;
    rt.masked = maskUsable(inner, ring, bg.scrim);
  }

  function spriteOf(frame, rt, i) {
    let s = rt.sprites[i];
    if (s) return s;
    const word = rt.plan.words[i];
    if (word.colour === undefined) {
      word.colour = colourOf(frame, rt.plan, word);
      decideMask(frame, rt);
      word.masked = i === rt.plan.hero && rt.masked;
    }
    s = bake(frame, rt, word);
    rt.sprites[i] = s;
    if (i === rt.plan.hero && rt.fx.strong && rt.fx.rgb && !rt.tints) bakeTints(frame, rt, word);
    return s;
  }

  // Bakes the next line's words ahead of time, one per frame, so a hard cut never has to bake.
  function prebake(frame) {
    const li = frame.index + 1;
    if (li >= frame.lines.length || !frame.lines[li].words.length) return;
    if (frame.lines[li].time - frame.pos > 6000) return;
    const rt = runOf(frame, li);
    const order = rt.plan.words;
    for (let k = 0; k < order.length; k++) {
      const i = k === 0 ? rt.plan.hero : k <= rt.plan.hero ? k - 1 : k;
      if (!rt.sprites[i]) {
        spriteOf(frame, rt, i);
        return;
      }
    }
  }

  function trim(index) {
    for (const [li, rt] of runs) {
      if (li < index - 1 || li > index + 1) {
        freeRun(rt);
        runs.delete(li);
      }
    }
  }

  // ---- drawing ----
  const E = { s: 1, dx: 0, dy: 0, rot: 0, trail: 0 };
  const TR = { s: 1, dx: 0, dy: 0, rot: 0, trail: 0 };
  const KB = { z: 1.08, ox: 0, oy: 0 };
  const SH = { x: 0, y: 0 };
  let frameNo = 0;

  function drawBackground(frame) {
    const { w, h, pos, lines, index } = frame;
    if (frame.reelBackground === 'off') return false;
    const img = artImage(frame.art);
    if (!img) return false;
    const b = bakeBackground(frame, img);
    const still = frame.reduceMotion;
    const iv = INTENSITY[frame.reelIntensity] ?? 1;
    let z = 1.08;
    let ox = 0;
    let oy = 0;
    if (!still) {
      kenBurns(pos, seedI, KB);
      z = KB.z;
      ox = KB.ox * w;
      oy = KB.oy * h;
      if (index >= 0) z *= 1 + punchAmount(lines, index, pos, seedI, iv);
    }
    const fade = clamp((frame.now - b.since) / COVER_FADE_MS, 0, 1);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(w / 2 + ox, h / 2 + oy);
    ctx.scale(z, z);
    ctx.drawImage(b.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
    const gp = grainPattern();
    if (gp) {
      ctx.save();
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = gp;
      if (!still && (frameNo & 1) === 0) ctx.translate(Math.floor(hash(frameNo, 3) * 192), Math.floor(hash(frameNo, 4) * 192));
      ctx.fillRect(-192, -192, w + 384, h + 384);
      ctx.restore();
    }
    return true;
  }

  // Draws a baked word at its place with the given extra transform. a: alpha.
  function put(sp, word, dx, dy, rot, sx, sy, a) {
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(word.cx + dx, word.cy + dy);
    ctx.rotate(word.rot + rot);
    ctx.scale(sx, sy);
    ctx.drawImage(sp.cv, sp.ox, sp.oy, sp.sw, sp.sh);
    ctx.restore();
  }

  function drawLineWords(frame, rt, pos, alpha) {
    const still = frame.reduceMotion;
    const iv = INTENSITY[frame.reelIntensity] ?? 1;
    const line = frame.lines[rt.li];
    const plan = rt.plan;
    const q = frame.quiet ? 0.35 : 1;
    const order = plan.words;
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < order.length; k++) {
        const word = order[k];
        const isHero = word.i === plan.hero;
        const start = shownAt(frame.lines[rt.li].words[word.i], line, frame.mode);
        const since = pos - start;
        if (since < 0) continue;
        // the hero is drawn over the older words, but a word that has just started is drawn over the hero, so it is never
        // hidden on its start frame
        const fresh = !isHero && since < 450;
        if (pass !== (isHero ? 1 : fresh ? 2 : 0)) continue;
        const sp = spriteOf(frame, rt, word.i);
        let a = alpha * q;
        const fl = rt.flickers;
        for (let f = 0; f < fl.length; f++) if (fl[f].word === word.i) a *= flickerAlpha(pos - line.time - fl[f].t, fl[f].dur);
        entranceOf(word, since, still, E);
        const stretch = holdStretch(word, since, still);
        // the trail: older states of the entrance, fainter, behind the word (only the first ~120 ms)
        if (E.trail > 0 && rt.fx.trail && !still && iv >= 0.6) {
          for (let c = 3; c >= 1; c--) {
            const t = since - c * 22;
            if (t < 0) continue;
            entranceOf(word, t, false, TR);
            put(sp, word, TR.dx, TR.dy, TR.rot, TR.s, TR.s, a * E.trail * 0.22 * Math.min(1, iv));
          }
        }
        const hero = isHero && rt.fx.strong;
        const off = hero && rt.fx.rgb ? rgbOffset(since, rt.li, seedI, iv, still) : 0;
        if (hero && rt.fx.distort && !still && iv >= 0.6 && since < 50) {
          drawSliced(sp, word, E, stretch, a, since, iv, rt);
        } else {
          put(sp, word, E.dx, E.dy, E.rot, E.s * stretch, E.s, a);
        }
        if (off > 0.2 && rt.tints) {
          ctx.globalCompositeOperation = 'screen';
          const cols = [-1, 0, 1];
          for (let c = 0; c < 3; c++) {
            const T = rt.tints[c];
            ctx.globalAlpha = a * 0.75;
            ctx.save();
            ctx.translate(word.cx + E.dx + cols[c] * off, word.cy + E.dy);
            ctx.rotate(word.rot + E.rot);
            ctx.scale(E.s * stretch, E.s);
            ctx.drawImage(T, sp.ox, sp.oy, sp.sw, sp.sh);
            ctx.restore();
          }
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  const SLICES = 8;
  function drawSliced(sp, word, e, stretch, a, since, iv, rt) {
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(word.cx + e.dx, word.cy + e.dy);
    ctx.rotate(word.rot + e.rot);
    ctx.scale(e.s * stretch, e.s);
    const sliceH = sp.cv.height / SLICES;
    for (let s = 0; s < SLICES; s++) {
      const shift = sliceShift(s, since, word.cap, rt.li, seedI, iv, false);
      ctx.drawImage(sp.cv, 0, s * sliceH, sp.cv.width, sliceH, sp.ox + shift, sp.oy + (s * sp.sh) / SLICES, sp.sw, sp.sh / SLICES);
    }
    ctx.restore();
  }

  function drawGhost(frame, rt, prevRt, since) {
    const hero = prevRt.plan.words[prevRt.plan.hero];
    if (!hero) return;
    let sp = prevRt.sprites[hero.i];
    if (!sp) sp = spriteOf(frame, prevRt, hero.i);
    const fade = 1 - clamp(since / 700, 0, 1);
    if (fade <= 0) return;
    put(sp, hero, 0, 0, 0, 1.18, 1.18, 0.15 * fade * (frame.quiet ? 0.35 : 1));
    ctx.globalAlpha = 1;
  }

  return {
    id: 'reel',
    name: 'Reel',
    init(_canvas, context) {
      ctx = context;
      loadFonts();
    },
    resize() {
      resetAll();
      if (bg?.canvas) release(bg.canvas);
      bg = null;
    },
    draw(frame) {
      frameNo++;
      if (!fontsRequested) loadFonts();
      const { w, h, dpr, pos, lines, index } = frame;
      // a new song (or a new play): fresh plans, fresh fonts, fresh shuffles
      const key = String(frame.seed);
      if (key !== seedKey || frame.lines !== masksFor) {
        seedKey = key;
        seedI = seedInt(key);
        shuffles = new Map();
        resetAll();
        masksFor = frame.lines;
        masks = null;
        if (bg?.canvas) release(bg.canvas);
        bg = null;
      }
      const covered = drawBackground(frame);
      const sk = `${w}x${h}@${dpr}|${frame.reelFonts}|${frame.art}|${frame.reelBackground}|${covered}`;
      if (sk !== sizeKey) {
        sizeKey = sk;
        resetAll();
      }
      const readyNow = fontsReady;
      if (!readyNow || index < 0) return;
      picker.configure(seedI, okIds, frame.reelFonts === 'single', shuffles);
      if (shuffleRequests !== seenShuffles) {
        seenShuffles = shuffleRequests;
        if (frame.reelFonts !== 'single') {
          shuffles = new Map(shuffles);
          shuffles.set(index, (shuffles.get(index) || 0) + 1);
          picker.configure(seedI, okIds, false, shuffles);
          resetAll();
        }
      }
      if (!masks) masks = pickMaskLines(lines.length, (j) => lines[j].words.length > 0 && maskEligible(lines[j].words, kindOf(seedI, j)));
      const line = lines[index];
      if (!line.words.length) return;
      trim(index);
      const rt = runOf(frame, index);
      const still = frame.reduceMotion;
      const iv = INTENSITY[frame.reelIntensity] ?? 1;
      const sinceLine = pos - line.time;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // hard cut: the previous line is gone (reduce motion: it fades in 120 ms)
      const prevRt = index > 0 && lines[index - 1].words.length ? runs.get(index - 1) || null : null;
      if (prevRt && !still && rt.fx.ghost && iv >= 0.6 && sinceLine < 700) drawGhost(frame, rt, prevRt, sinceLine);
      if (prevRt && still && sinceLine < 120) drawLineWords(frame, prevRt, pos, 1 - sinceLine / 120);
      shakeOf(sinceLine, index, seedI, iv, still || !rt.fx.strong, SH);
      if (SH.x !== 0 || SH.y !== 0) ctx.translate(SH.x, SH.y);
      drawLineWords(frame, rt, pos, still && sinceLine < 120 ? sinceLine / 120 : 1);
      ctx.restore();
      ctx.globalAlpha = 1;
      prebake(frame);
      stats.canvases = live;
      stats.pooled = pool.length;
      stats.plans = plans.size;
      stats.sprites = 0;
      for (const r of runs.values()) stats.sprites += r.sprites.filter(Boolean).length;
      stats.cover = covered;
      // what the line on screen uses (read by the tests and the screenshot tool)
      stats.li = index;
      stats.kind = rt.plan.kind;
      stats.strong = rt.fx.strong;
      stats.rgb = rt.fx.rgb;
      stats.distort = rt.fx.distort;
      stats.ghost = rt.fx.ghost;
      stats.flicker = rt.flickers.length;
      stats.masked = rt.masked;
      stats.hero = rt.plan.hero;
      stats.heroStart = rt.plan.hero >= 0 ? shownAt(line.words[rt.plan.hero], line, frame.mode) : 0;
      stats.fonts = [...new Set(rt.plan.words.map((x) => x.font))].join(',');
      globalThis.__reelStats = stats;
    },
  };
}

