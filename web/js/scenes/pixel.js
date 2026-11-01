// Pixel: a memory playing inside an old handheld game console. The whole scene is drawn into a small "logical screen" (about 320
// pixels tall) and then drawn to the window with a whole-number scale and no smoothing, so every logical pixel is a crisp
// square. Colours come from a fixed 16-colour palette; text is a bundled 8-bit pixel font baked once per line into hard-edged
// sprites (outline, dim, mid and bright layers); lines enter and leave with an ordered (Bayer) dither dissolve.
//
// The timing rule, as in every scene: a word is fully readable on its start frame. The whole line is on screen in dim cream
// before it is sung; on a word's start frame that word switches to bright cream and the underline moves to it. Only brightness
// and the cursor animate. The maths (screen fit, palettes, dither, wrapping, marquee, which line is shown when) is in
// pixel-core.js and unit-tested; this file only paints. Nothing is allocated per frame, and no shadowBlur or filter is used.
import { artImage, pokeRedraw } from './art.js';
import { shownAt, hash } from './motion.js';
import { seedInt } from './polaroid-motion.js';
import {
  DISSOLVE_STEPS, FONT_FAMILY, FONT_IDS, PALETTES, SIZES, TONE_BRIGHT, TONE_DIM, TONE_MID,
  bayerThreshold, clockText, cloudX, coverToIndices, dissolveLevel, fitScreen, fontSizes, hexToRgb, layoutLine, marqueeOffset, paletteOf,
  panOffset, pixelText, progressOf, repeatedLines, visibleLines, wordTone, withAlbumAccent,
} from './pixel-core.js';

const DUR = 420; // the dissolve, ms (the spec: about 300 to 500)
const FADE = 160; // reduce motion: a short fade instead
const PAN_FAR = 2; // how far each background layer may drift, in logical pixels either way
const PAN_MID = 4;
const PAN_NEAR = 6;
const COVER_N = 32;
const PAD = 1; // the outline around text sprites
const MAX_LINES = 10;
const MAX_TEXTS = 120;
const FALLBACK_FONTS = ', "MS Gothic", "Yu Gothic UI", "Malgun Gothic", "Microsoft YaHei UI", "Segoe UI Emoji", "Segoe UI Symbol", monospace';

const ICONS = {
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  note: ['..####', '..#..#', '..#..#', '..#...', '###...', '###...'],
  speaker: ['..#...', '.##.#.', '###..#', '###.#.', '###..#', '.##.#.', '..#...'],
  noteBig: ['....######', '....#....##', '....#.....#', '....#.....#', '....#......', '....#......', '....#......', '.####......', '######.....', '######.....', '.####......'],
};

function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}
function free(c) {
  if (c) {
    c.width = 0;
    c.height = 0;
  }
}

export function createPixel() {
  let ctx = null;
  let canRender = false;

  // ---- fonts ----
  let fontsRequested = false;
  let fontsReady = false;
  const fontCss = (fontId, size) => `${size}px ${FONT_FAMILY[fontId]}${FALLBACK_FONTS}`;
  function loadFonts() {
    fontsRequested = true;
    if (typeof document === 'undefined' || !document.fonts?.load) {
      fontsReady = true;
      return;
    }
    Promise.allSettled(FONT_IDS.map((id) => document.fonts.load(`16px ${FONT_FAMILY[id]}`, 'AaHh'))).then(() => {
      fontsReady = true;
      dropSprites();
      pokeRedraw();
    });
  }

  // ---- scratch canvases for baking text (read back once per sprite, never per frame) ----
  let bk = null;
  let bkg = null;
  function bakeCtx(w, h) {
    if (!bk) {
      bk = makeCanvas(w, h);
      bkg = bk.getContext('2d', { willReadFrequently: true });
    }
    if (bk.width < w || bk.height < h) {
      bk.width = Math.max(bk.width, w);
      bk.height = Math.max(bk.height, h);
    } else bkg.clearRect(0, 0, bk.width, bk.height);
    bkg.fillStyle = '#fff';
    bkg.textBaseline = 'alphabetic';
    bkg.textAlign = 'left';
    bkg.fontKerning = 'none';
    bkg.imageSmoothingEnabled = false;
    return bkg;
  }
  // The text as a hard 1-bit mask: every pixel is either ink or not (so even a system-font fallback has hard edges).
  // Drawn K times larger and read back at the centre of each logical pixel, so a half-pixel shift in the browser's text drawing
  // cannot blur or merge the font's 1-pixel strokes.
  function maskOf(w, h, draw) {
    const K = 4;
    const g = bakeCtx(w * K, h * K);
    draw(g, K);
    const W = w * K;
    const d = g.getImageData(0, 0, W, h * K).data;
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = d[((y * K + 2) * W + x * K + 2) * 4 + 3] >= 128 ? 1 : 0;
    return m;
  }
  function measure(fontId, text, size) {
    const g = bakeCtx(8, 8);
    g.font = fontCss(fontId, size);
    return Math.round(g.measureText(text).width);
  }

  // ---- state ----
  let fit = null; // the logical screen now
  let L = null; // the logical canvas
  let lg = null;
  let scratch = null; // for the dissolve
  let sg = null;
  let masks = null; // dither masks, by level
  let world = null;
  let crt = null;
  let palKey = '';
  let pal = null; // the palette in use (with the album accent when asked)
  let pal32 = null;
  let css = null;
  let layoutKey = '';
  let tStart = -1;
  let tAnim = 0;
  let lastNow = 0;
  let seedKey = '';
  let seedI = 0;
  let repeatedFor = null;
  let repeated = null;
  const sprites = new Map(); // `${kind}|${li}` -> baked line
  const texts = new Map(); // baked UI strings
  const icons = new Map();
  const slots = { main: slot(), sub: slot(), idle: slot() };
  const cover = { url: null, raw: null, dominant: null, canvas: null, canvasKey: '', tries: 0 };
  let battery = null;
  let audio = null;
  const stats = { canvases: 0, sprites: 0, texts: 0 };

  function slot() {
    return { key: null, t0: -1e9, prev: null, pt: -1e9 };
  }
  function setSlot(s, key, now) {
    if (key !== s.key) {
      s.prev = s.key;
      s.pt = now;
      s.key = key;
      s.t0 = now;
      return true;
    }
    return false;
  }

  function dropSprites() {
    for (const s of sprites.values()) freeSprite(s);
    sprites.clear();
    for (const t of texts.values()) free(t.cv);
    texts.clear();
    for (const c of icons.values()) free(c);
    icons.clear();
  }
  function freeSprite(s) {
    free(s.outline);
    free(s.dim);
    free(s.mid);
    free(s.bright);
  }
  function dropWorld() {
    if (world) {
      free(world.sky);
      free(world.hills);
      free(world.skyline);
      for (const c of world.clouds) free(c.cv);
    }
    world = null;
    free(crt);
    crt = null;
  }

  // ---- palette helpers ----
  function setPalette(p) {
    pal = p;
    pal32 = p.colors.map((h) => {
      const [r, g, b] = hexToRgb(h);
      return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    });
    css = p.colors.slice();
  }

  // ---- the cover as a 32 x 32 sprite ----
  function sampleCover(img) {
    try {
      const t = makeCanvas(COVER_N, COVER_N);
      const g = t.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, COVER_N, COVER_N);
      const raw = new Uint8ClampedArray(g.getImageData(0, 0, COVER_N, COVER_N).data);
      free(t);
      return raw;
    } catch {
      return null; // an unreadable (cross-origin) picture: the placeholder is used
    }
  }
  function updateCover(frame) {
    if (cover.url !== frame.art) {
      cover.url = frame.art || null;
      cover.raw = null;
      cover.dominant = null;
      cover.tries = 0;
      cover.canvasKey = '';
    }
    if (!cover.raw && cover.url && cover.tries < 3) {
      const img = artImage(cover.url);
      if (img) {
        cover.tries++;
        cover.raw = sampleCover(img);
        if (cover.raw) cover.dominant = coverToIndices(cover.raw, COVER_N, PALETTES.dreamy).dominant;
        cover.canvasKey = '';
      }
    }
  }
  function buildCoverCanvas() {
    free(cover.canvas);
    const c = makeCanvas(COVER_N, COVER_N);
    const g = c.getContext('2d');
    const img = g.createImageData(COVER_N, COVER_N);
    const p32 = new Uint32Array(img.data.buffer);
    if (cover.raw) {
      const { indices } = coverToIndices(cover.raw, COVER_N, pal);
      for (let i = 0; i < indices.length; i++) p32[i] = pal32[indices[i]];
    } else {
      // no cover: a music note on a dithered ground
      for (let y = 0; y < COVER_N; y++) for (let x = 0; x < COVER_N; x++) p32[y * COVER_N + x] = pal32[((x + y) & 1) === 0 ? pal.ramp[2] : pal.ramp[3]];
      const note = ICONS.noteBig;
      const ox = 11;
      const oy = 10;
      for (let y = 0; y < note.length; y++) for (let x = 0; x < note[y].length; x++) if (note[y][x] === '#') p32[(oy + y) * COVER_N + ox + x] = pal32[pal.mid];
    }
    g.putImageData(img, 0, 0);
    cover.canvas = c;
    cover.canvasKey = palKey;
  }

  // ---- the world: sky, stars, moon, clouds, hills, skyline (baked per size, palette and song) ----
  function bakeWorld(lw, lh) {
    const R = mulberry(seedI * 7919 + 13);
    // far layer: the dithered sky gradient, stars, the moon
    const skyW = lw + PAN_FAR * 2;
    const sky = makeCanvas(skyW, lh);
    const sgc = sky.getContext('2d');
    const simg = sgc.createImageData(skyW, lh);
    const sp = new Uint32Array(simg.data.buffer);
    const n = pal.ramp.length - 1;
    const horizon = lh * 0.8;
    for (let y = 0; y < lh; y++) {
      const f = Math.min(n, (y / horizon) * n);
      const i = Math.min(n - 1, Math.floor(f));
      const fr = f - i;
      for (let x = 0; x < skyW; x++) sp[y * skyW + x] = pal32[pal.ramp[fr > bayerThreshold(x, y, 8) ? i + 1 : i]];
    }
    const put = (x, y, ci) => {
      if (x >= 0 && y >= 0 && x < skyW && y < lh) sp[y * skyW + x] = pal32[ci];
    };
    const mr = Math.max(5, Math.round(lh * 0.05));
    const mx = Math.round(lw * 0.8) + PAN_FAR;
    const my = Math.round(lh * 0.2);
    for (let dy = -mr; dy <= mr; dy++) {
      for (let dx = -mr; dx <= mr; dx++) {
        const inA = dx * dx + dy * dy <= mr * mr;
        const bx = dx - mr * 0.45;
        const by = dy + mr * 0.2;
        const inB = bx * bx + by * by <= mr * mr * 0.82;
        if (inA && !inB) put(mx + dx, my + dy, pal.moon);
      }
    }
    const starCount = Math.floor((lw * lh) / 1100);
    const twinkles = [];
    for (let k = 0; k < starCount; k++) {
      const x = Math.floor(R() * lw) + PAN_FAR;
      const y = Math.floor(R() * lh * 0.58);
      const big = R() < 0.1;
      const col = R() < 0.3 ? pal.starBright : pal.star;
      put(x, y, col);
      if (big) {
        put(x - 1, y, pal.star);
        put(x + 1, y, pal.star);
        put(x, y - 1, pal.star);
        put(x, y + 1, pal.star);
      } else if (twinkles.length < 6 && y > lh * 0.04) twinkles.push({ x, y, phase: R(), period: 3 + R() * 3 });
    }
    sgc.putImageData(simg, 0, 0);

    // mid layer: distant hills, and the clouds
    const hillW = lw + PAN_MID * 2;
    const hillTop = Math.floor(lh * 0.46);
    const hills = makeCanvas(hillW, lh - hillTop);
    const hg = hills.getContext('2d');
    const himg = hg.createImageData(hillW, lh - hillTop);
    const hp = new Uint32Array(himg.data.buffer);
    const ph1 = R() * 6;
    const ph2 = R() * 6;
    const ph3 = R() * 6;
    for (let x = 0; x < hillW; x++) {
      const v = Math.sin(x * 0.011 + ph1) * 0.5 + Math.sin(x * 0.029 + ph2) * 0.28 + Math.sin(x * 0.0057 + ph3) * 0.5;
      const top = Math.round(lh * 0.7 - v * lh * 0.06) - hillTop;
      for (let y = Math.max(0, top); y < lh - hillTop; y++) {
        if (y === top && ((x + y) & 1) === 1) continue; // a dithered edge
        hp[y * hillW + x] = pal32[pal.far];
      }
    }
    hg.putImageData(himg, 0, 0);
    const clouds = [];
    const sprites4 = [];
    for (let k = 0; k < 4; k++) {
      const W = 28 + k * 8 + Math.floor(R() * 6);
      const H = Math.round(W * 0.36);
      const cv = makeCanvas(W, H);
      const cg = cv.getContext('2d');
      const cimg = cg.createImageData(W, H);
      const cp = new Uint32Array(cimg.data.buffer);
      const circles = [];
      for (let c = 0; c < 4; c++) circles.push([W * (0.2 + 0.6 * R()), H * 0.62, H * (0.3 + 0.28 * R())]);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let inside = false;
          for (const [cx, cy, r] of circles) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) inside = true;
          if (inside || (y >= H - 3 && x > W * 0.12 && x < W * 0.88)) cp[y * W + x] = pal32[y >= H - 3 ? pal.cloudShade : pal.cloudLight];
        }
      }
      cg.putImageData(cimg, 0, 0);
      sprites4.push(cv);
    }
    const cloudN = Math.max(3, Math.round(lw / 150));
    for (let k = 0; k < cloudN; k++) {
      const cv = sprites4[k % 4];
      clouds.push({ cv, w: cv.width, x0: Math.floor(R() * (lw + cv.width)), y: Math.round(lh * (0.1 + 0.34 * ((k + R() * 0.7) / cloudN))), speed: 1.5 + R() * 2.5 });
    }
    for (let k = 4; k < 4; k++) free(sprites4[k]);

    // near layer: the skyline, with a few lit windows (some of them blink slowly), and the ground
    const nearW = lw + PAN_NEAR * 2;
    const skyline = makeCanvas(nearW, lh);
    const kg = skyline.getContext('2d');
    const kimg = kg.createImageData(nearW, lh);
    const kp = new Uint32Array(kimg.data.buffer);
    const gh = Math.max(6, Math.round(lh * 0.06));
    const groundTop = lh - gh;
    const blinkers = [];
    const rectPx = (x, y, w, h, ci) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < nearW && yy < lh) kp[yy * nearW + xx] = pal32[ci];
    };
    for (let x = 0; x < nearW; ) {
      const bw = 8 + Math.floor(R() * 11);
      const bh = Math.round(lh * (0.05 + R() * 0.19));
      const top = groundTop - bh;
      rectPx(x, top, bw, bh + 1, pal.near);
      if (R() < 0.25) rectPx(x + (bw >> 1), top - 4 - Math.floor(R() * 3), 1, 6, pal.near);
      for (let wy = top + 3; wy < groundTop - 3; wy += 4) {
        for (let wx = x + 2; wx < x + bw - 2; wx += 4) {
          if (R() < 0.22) {
            rectPx(wx, wy, 2, 2, pal.glow);
            if (blinkers.length < 8 && R() < 0.2) blinkers.push({ x: wx, y: wy, period: 7 + R() * 8, phase: R() });
          }
        }
      }
      x += bw + (R() < 0.25 ? 1 + Math.floor(R() * 3) : 0);
    }
    rectPx(0, groundTop, nearW, gh, pal.near);
    kg.putImageData(kimg, 0, 0);

    // the CRT texture: scanlines on every other logical row, and a dithered vignette
    const tex = makeCanvas(lw, lh);
    const tg = tex.getContext('2d');
    const timg = tg.createImageData(lw, lh);
    const tp = new Uint32Array(timg.data.buffer);
    const scan = (0x24 << 24) | 0; // black at 14 %
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        let v = 0;
        if (y & 1) v = scan;
        const dx = (x - lw / 2) / (lw / 2);
        const dy = (y - lh / 2) / (lh / 2);
        const d = Math.sqrt(dx * dx * 0.7 + dy * dy * 0.9);
        const k = Math.max(0, (d - 0.62) * 0.75);
        if (k > bayerThreshold(x, y, 8)) v = 0x55000000;
        tp[y * lw + x] = v >>> 0;
      }
    }
    tg.putImageData(timg, 0, 0);
    crt = tex;
    return { sky, hills, skyline, clouds, twinkles, blinkers, groundTop, w: lw, h: lh };
  }

  // ---- baked text lines ----
  // A layer of the sprite: the mask painted in one palette colour (or the outline: the mask grown by one pixel).
  function layerOf(mask, w, h, colorIdx) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const p = new Uint32Array(img.data.buffer);
    const col = pal32[colorIdx];
    for (let i = 0; i < p.length; i++) if (mask[i]) p[i] = col;
    g.putImageData(img, 0, 0);
    return c;
  }
  function outlineOf(mask, w, h, colorIdx) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const p = new Uint32Array(img.data.buffer);
    const col = pal32[colorIdx];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) p[(y + dy) * w + x + dx] = col;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function buildLine(frame, li, kind) {
    const { lines } = frame;
    const line = lines[li];
    const fontId = fontOf(frame);
    const g = geometry(frame);
    const words = line.words.map((w) => pixelText(w.text, fontId));
    const idx = [];
    const strs = [];
    words.forEach((t, i) => {
      if (t) {
        idx.push(i);
        strs.push(t);
      }
    });
    const sizes = kind === 'sub' ? [8] : fontSizes(fit.lh);
    const lay = layoutLine(strs, (t, s) => measure(fontId, t, s), { maxW: g.maxW, maxRows: kind === 'sub' ? 2 : 3, sizes, maxH: kind === 'sub' ? Infinity : g.mainH });
    const w = g.maxW + PAD * 2;
    const h = lay.height + PAD * 2 + 2;
    const mask = maskOf(w, h, (c, K) => {
      c.font = fontCss(fontId, lay.size * K);
      for (const row of lay.rows) for (const it of row.items) c.fillText(it.text, (PAD + row.x + it.x) * K, (PAD + 1 + row.y + lay.size) * K);
    });
    const parts = words.map(() => []);
    for (const row of lay.rows) {
      for (const it of row.items) {
        if (it.wi < 0) continue;
        parts[idx[it.wi]].push({ x: PAD + row.x + it.x, y: PAD + 1 + row.y - 2, w: it.w, h: lay.size + 4 });
      }
    }
    const sp = {
      kind, li, w, h, size: lay.size, lay, parts, mask,
      outline: outlineOf(mask, w, h, pal.outline),
      dim: layerOf(mask, w, h, pal.dim),
      mid: kind === 'sub' ? null : layerOf(mask, w, h, pal.mid),
      bright: kind === 'sub' ? null : layerOf(mask, w, h, pal.bright),
      x: g.x0 - PAD,
      y: 0,
      rects: [],
    };
    sp.mask = null;
    if (kind === 'sub') sp.y = 0;
    else sp.y = g.cy - Math.floor(lay.height / 2) - PAD - 1;
    sp.rects = parts.map((ps) => ps.map((p) => ({ x: sp.x + p.x, y: sp.y + p.y + 2, w: p.w, h: lay.size })));
    return sp;
  }
  function lineSprite(frame, li, kind) {
    const key = `${kind}|${li}`;
    let sp = sprites.get(key);
    if (sp) {
      sprites.delete(key);
      sprites.set(key, sp);
      return sp;
    }
    sp = buildLine(frame, li, kind);
    sprites.set(key, sp);
    while (sprites.size > MAX_LINES) {
      const [k, old] = sprites.entries().next().value;
      sprites.delete(k);
      freeSprite(old);
    }
    return sp;
  }

  // Small UI strings (with the navy outline), baked once per string.
  function textSprite(frame, str, colorIdx, size = 8) {
    const fontId = fontOf(frame);
    const key = `${fontId}|${size}|${colorIdx}|${str}`;
    let t = texts.get(key);
    if (t) return t;
    const tw = measure(fontId, str, size);
    const w = tw + PAD * 2;
    const h = size + PAD * 2 + 2;
    const mask = maskOf(w, h, (c, K) => {
      c.font = fontCss(fontId, size * K);
      c.fillText(str, PAD * K, (PAD + 1 + size) * K);
    });
    const cv = makeCanvas(w, h);
    const g = cv.getContext('2d');
    g.drawImage(outlineOf(mask, w, h, pal.outline), 0, 0);
    const fill = layerOf(mask, w, h, colorIdx);
    g.drawImage(fill, 0, 0);
    free(fill);
    t = { cv, w, h, tw };
    texts.set(key, t);
    while (texts.size > MAX_TEXTS) {
      const [k, old] = texts.entries().next().value;
      texts.delete(k);
      free(old.cv);
    }
    return t;
  }
  function iconCanvas(name, colorIdx) {
    const key = `${name}|${colorIdx}`;
    let c = icons.get(key);
    if (c) return c;
    const rows = ICONS[name];
    c = makeCanvas(rows[0].length, rows.length);
    const g = c.getContext('2d');
    g.fillStyle = css[colorIdx];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === '#') g.fillRect(x, y, 1, 1);
    icons.set(key, c);
    return c;
  }

  // ---- layout numbers for the current logical screen ----
  const G = { cy: 0, maxW: 0, x0: 0, x1: 0, y0: 0, y1: 0, mainAreaH: 0, mainH: 0, hud: true, key: '' };
  function geometry(frame) {
    const { lw, lh } = fit;
    const hud = frame.pixelHud !== false;
    const key = `${lw}x${lh}|${hud}`;
    if (G.key === key) return G;
    const m = Math.max(8, Math.round(Math.min(lw, lh) * 0.05));
    G.hud = hud;
    G.x0 = hud ? 12 : m;
    G.x1 = lw - G.x0;
    G.y0 = hud ? 20 : m;
    G.y1 = hud ? lh - 34 : lh - Math.max(m, Math.round(lh * 0.12));
    G.maxW = G.x1 - G.x0;
    G.cy = Math.round(lh * 0.4); // the main line is centred here; the small next line sits under it
    G.mainAreaH = (G.cy - G.y0) * 2;
    G.mainH = G.mainAreaH;
    G.key = key;
    return G;
  }
  const fontOf = (frame) => (frame.pixelFont === 'silk' ? 'silk' : 'press');

  // ---- drawing pieces ----
  function patternFor(level) {
    if (!masks) masks = new Array(DISSOLVE_STEPS + 1).fill(null);
    let p = masks[level];
    if (!p) {
      const t = makeCanvas(4, 4);
      const g = t.getContext('2d');
      g.fillStyle = '#000';
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (bayerThreshold(x, y, 4) < level / DISSOLVE_STEPS) g.fillRect(x, y, 1, 1);
      p = sg.createPattern(t, 'repeat');
      masks[level] = p;
    }
    return p;
  }
  // Draws something through the dither dissolve (level 0..16), or through a plain fade with reduce motion.
  function through(level, still, fn, a, b, c) {
    if (level <= 0) return;
    if (level >= DISSOLVE_STEPS) {
      fn(lg, a, b, c);
      return;
    }
    if (still) {
      lg.globalAlpha = level / DISSOLVE_STEPS;
      fn(lg, a, b, c);
      lg.globalAlpha = 1;
      return;
    }
    sg.clearRect(0, 0, fit.lw, fit.lh);
    fn(sg, a, b, c);
    sg.globalCompositeOperation = 'destination-in';
    sg.fillStyle = patternFor(level);
    sg.fillRect(0, 0, fit.lw, fit.lh);
    sg.globalCompositeOperation = 'source-over';
    lg.drawImage(scratch, 0, 0);
  }
  function drawSlot(s, now, still, fn, a, b, c) {
    const total = still ? FADE : DUR;
    if (s.prev !== null && now - s.pt < total) through(dissolveLevel(1 - progressOf(now, s.pt, total)), still, fn, s.prev, b, c);
    if (s.key !== null) through(dissolveLevel(progressOf(now, s.t0, total)), still, fn, s.key, b, c);
  }

  function paintMain(g, li, frame) {
    const sp = lineSprite(frame, li, 'main');
    const line = frame.lines[li];
    const pos = frame.pos;
    g.drawImage(sp.outline, sp.x, sp.y);
    g.drawImage(sp.dim, sp.x, sp.y);
    let last = -1;
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      const tone = wordTone(pos, shownAt(w, line, frame.mode), w.end);
      if (tone === TONE_DIM) continue;
      last = i;
      const src = tone === TONE_BRIGHT ? sp.bright : sp.mid;
      const ps = sp.parts[i];
      for (let k = 0; k < ps.length; k++) {
        const p = ps[k];
        g.drawImage(src, p.x, p.y, p.w, p.h, sp.x + p.x, sp.y + p.y, p.w, p.h);
      }
    }
    // the cursor: an underline under the word being sung (word by word only)
    if (last >= 0 && frame.mode !== 'line' && pos < line.words[last].end + 1400) {
      const ps = sp.parts[last];
      g.fillStyle = css[pal.accent];
      for (let k = 0; k < ps.length; k++) g.fillRect(sp.x + ps[k].x, sp.y + ps[k].y + 2 + sp.size + 1, ps[k].w, 1);
    }
  }
  function paintSub(g, li, frame) {
    const sp = lineSprite(frame, li, 'sub');
    const m = slots.main.key !== null ? sprites.get(`main|${slots.main.key}`) : null;
    const y = G.cy + (m ? Math.ceil(m.lay.height / 2) : 16) + 14;
    g.drawImage(sp.outline, sp.x, y);
    g.drawImage(sp.dim, sp.x, y);
  }

  function paintIdle(g, _key, frame) {
    const { lw, lh } = fit;
    const k = Math.max(1, Math.min(3, Math.floor((Math.min(lw, lh) * 0.22) / COVER_N)));
    const cs = COVER_N * k;
    const fx = Math.round((lw - cs) / 2);
    const fy = Math.round(lh * 0.36 - cs / 2);
    g.fillStyle = css[pal.outline];
    g.fillRect(fx - 3, fy - 3, cs + 8, cs + 8); // frame shadow and outline
    g.fillStyle = css[pal.mid];
    g.fillRect(fx - 2, fy - 2, cs + 4, cs + 4);
    g.fillStyle = css[pal.outline];
    g.fillRect(fx - 1, fy - 1, cs + 2, cs + 2);
    g.imageSmoothingEnabled = false;
    g.drawImage(cover.canvas, 0, 0, COVER_N, COVER_N, fx, fy, cs, cs);
    // the music indicator: five bars that step up and down a few times a second
    const bars = 5;
    const bw = 3;
    const gap = 2;
    const ex = Math.round((lw - (bars * bw + (bars - 1) * gap)) / 2);
    const base = fy + cs + 18;
    const step = Math.floor(tAnim * 5);
    for (let b = 0; b < bars; b++) {
      const hgt = frame.reduceMotion ? 3 + ((b * 3) % 5) : 2 + Math.floor(hash(step, b + 1) * 9);
      g.fillStyle = css[pal.accent];
      g.fillRect(ex + b * (bw + gap), base - hgt, bw, hgt);
      g.fillStyle = css[pal.outline];
      g.fillRect(ex + b * (bw + gap), base, bw, 1);
    }
    const t = textSprite(frame, 'INSTRUMENTAL', pal.dim);
    const tx = Math.round((lw - t.w) / 2) - 2;
    g.drawImage(t.cv, tx, base + 5);
    const blinkOn = frame.reduceMotion || Math.floor(tAnim * 1.5) % 2 === 0;
    if (blinkOn) {
      g.fillStyle = css[pal.accent];
      g.fillRect(tx + t.w + 1, base + 6, 5, 8);
    }
  }

  // ---- the handheld interface ----
  function paintHud(frame) {
    const { lw, lh } = fit;
    const g = lg;
    const ui = pal.ui;
    // bezel: a thin line just inside the edge, with rounded (stepped) corners cut out in black
    g.fillStyle = css[pal.uiDim];
    g.fillRect(3, 1, lw - 6, 1);
    g.fillRect(3, lh - 2, lw - 6, 1);
    g.fillRect(1, 3, 1, lh - 6);
    g.fillRect(lw - 2, 3, 1, lh - 6);
    g.fillRect(2, 2, 1, 1);
    g.fillRect(lw - 3, 2, 1, 1);
    g.fillRect(2, lh - 3, 1, 1);
    g.fillRect(lw - 3, lh - 3, 1, 1);
    g.fillStyle = '#000';
    for (const [cx, cy] of [[0, 0], [lw - 1, 0], [0, lh - 1], [lw - 1, lh - 1]]) {
      const sx = cx === 0 ? 1 : -1;
      const sy = cy === 0 ? 1 : -1;
      g.fillRect(cx, cy, 1, 1);
      g.fillRect(cx + sx, cy, 1, 1);
      g.fillRect(cx, cy + sy, 1, 1);
      g.fillRect(cx + sx * 2, cy, 1, 1);
      g.fillRect(cx, cy + sy * 2, 1, 1);
    }
    // top bar: signal bars, a note, the menu label, the clock, the battery
    for (let i = 0; i < 4; i++) {
      g.fillStyle = css[ui];
      g.fillRect(6 + i * 3, 11 - (2 + i * 2), 2, 2 + i * 2);
    }
    g.drawImage(iconCanvas('note', pal.uiDim), 24, 5);
    if (lw >= 300) {
      const t = textSprite(frame, 'NOW PLAYING', pal.uiDim);
      g.drawImage(t.cv, Math.round((lw - t.w) / 2), 3);
    }
    const clock = textSprite(frame, clockText(frame.pos), ui);
    g.drawImage(clock.cv, lw - 30 - clock.w, 3);
    const bx = lw - 24;
    g.fillStyle = css[ui];
    g.fillRect(bx, 4, 16, 1);
    g.fillRect(bx, 11, 16, 1);
    g.fillRect(bx, 5, 1, 6);
    g.fillRect(bx + 15, 5, 1, 6);
    g.fillRect(bx + 16, 6, 2, 4);
    let level = battery ? battery.level : 0.95 - ((frame.now / 1000 / 1800) % 1) * 0.6;
    level = Math.max(0.05, Math.min(1, level));
    const on = Math.ceil(level * 4);
    for (let i = 0; i < on; i++) g.fillRect(bx + 2 + i * 3, 6, 2, 4);
    // bottom: a heart, the scrolling title, a speaker; the progress bar, the power dot
    const by = lh - 26;
    g.drawImage(iconCanvas('heart', pal.accent), 7, by + 1);
    g.drawImage(iconCanvas('speaker', pal.uiDim), lw - 14, by);
    const track = frame.track;
    const title = pixelText(`${track?.title || ''}${track?.artist ? '  -  ' + track.artist : ''}`, fontOf(frame)).toUpperCase();
    const boxX = 19;
    const boxW = lw - 19 - 20;
    if (title) {
      let str = title;
      let t = textSprite(frame, str, ui);
      if (t.tw > boxW && frame.reduceMotion) {
        while (str.length > 4 && measure(fontOf(frame), `${str}...`, 8) > boxW) str = str.slice(0, -1);
        t = textSprite(frame, `${str}...`, ui);
      }
      const off = frame.reduceMotion ? 0 : marqueeOffset(t.w, boxW, frame.now);
      const cycle = t.w + 24;
      for (let c = 0; c < 2; c++) {
        const cx = -off + c * cycle;
        const left = Math.max(cx, 0);
        const right = Math.min(cx + t.w, boxW);
        if (right > left) g.drawImage(t.cv, left - cx, 0, right - left, t.h, boxX + left, by - 1, right - left, t.h);
      }
    }
    const dur = frame.track?.durationMs > 0 ? frame.track.durationMs : (frame.lines[frame.lines.length - 1]?.time || 0) + 15000;
    const frac = Math.max(0, Math.min(1, frame.pos / dur));
    const px = 7;
    const pw = lw - 14 - 8;
    const py = lh - 12;
    g.fillStyle = css[pal.uiDim];
    g.fillRect(px, py, pw, 1);
    g.fillRect(px, py + 4, pw, 1);
    g.fillRect(px, py + 1, 1, 3);
    g.fillRect(px + pw - 1, py + 1, 1, 3);
    g.fillStyle = css[pal.accent];
    g.fillRect(px + 1, py + 1, Math.floor(frac * (pw - 2)), 3);
    // the power dot: on most of the time, off for a moment (slow, a few seconds apart)
    const dotOn = frame.reduceMotion || Math.floor(tAnim / 1.2) % 4 !== 3;
    g.fillStyle = css[dotOn ? pal.accent : pal.uiDim];
    g.fillRect(lw - 11, py, 3, 3);
  }

  function blip(frame) {
    try {
      audio ??= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const t = audio.currentTime;
      const o = audio.createOscillator();
      const v = audio.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(880, t);
      o.frequency.setValueAtTime(1320, t + 0.05);
      v.gain.setValueAtTime(0.02, t);
      v.gain.linearRampToValueAtTime(0, t + 0.11);
      o.connect(v).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.12);
    } catch {
      // no audio available: the sound is only a nicety
    }
  }

  function startBattery() {
    try {
      navigator.getBattery?.().then((b) => {
        const read = () => (battery = { level: b.level });
        read();
        b.addEventListener('levelchange', read);
      });
    } catch {
      // no battery information: the decorative one is used
    }
  }

  // ---- the scene ----
  return {
    id: 'pixel',
    name: 'Pixel',
    init(_canvas, context) {
      ctx = context;
      canRender = typeof ImageData !== 'undefined' && typeof document !== 'undefined' && !!ctx?.canvas && typeof ctx.canvas.width === 'number';
      if (canRender) startBattery();
    },
    resize() {
      fit = null;
    },
    draw(frame) {
      const { w, h, now } = frame;
      if (!canRender) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        return;
      }
      if (!fontsRequested) loadFonts();
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      const screen = frame.pixelScreen === 'portrait' ? 'portrait' : 'fill';
      const target = SIZES[frame.pixelSize] || SIZES.normal;
      const f = fitScreen(cw, ch, { screen, target });

      // the palette, with the cover's colour when asked
      updateCover(frame);
      const baseId = PALETTES[frame.pixelPalette] ? frame.pixelPalette : 'dreamy';
      const useAlbum = frame.pixelAlbum === true && !!cover.dominant;
      const pk = `${baseId}|${useAlbum ? cover.dominant.join(',') : ''}`;
      if (pk !== palKey || !pal) {
        palKey = pk;
        setPalette(useAlbum ? withAlbumAccent(paletteOf(baseId), cover.dominant) : paletteOf(baseId));
        dropSprites();
        dropWorld();
        cover.canvasKey = '';
      }
      const key = String(frame.seed);
      if (key !== seedKey) {
        seedKey = key;
        seedI = seedInt(key);
        dropWorld();
      }
      if (!fit || f.lw !== fit.lw || f.lh !== fit.lh || f.scale !== fit.scale || f.ox !== fit.ox || f.oy !== fit.oy) {
        const sizeChanged = !fit || f.lw !== fit.lw || f.lh !== fit.lh;
        fit = f;
        if (sizeChanged || !L) {
          free(L);
          free(scratch);
          L = makeCanvas(f.lw, f.lh);
          lg = L.getContext('2d', { alpha: false });
          lg.imageSmoothingEnabled = false;
          scratch = makeCanvas(f.lw, f.lh);
          sg = scratch.getContext('2d');
          masks = null;
          dropSprites();
          dropWorld();
          G.key = '';
        }
      }
      const lk = `${frame.pixelFont}|${frame.pixelHud}`;
      if (lk !== layoutKey) {
        layoutKey = lk;
        dropSprites();
        G.key = '';
      }
      if (!world) world = bakeWorld(fit.lw, fit.lh);
      if (!cover.canvas || cover.canvasKey !== palKey) buildCoverCanvas();

      // the animation clock: wall time, scaled by Animation speed, frozen with reduce motion
      if (tStart < 0) {
        tStart = now;
        lastNow = now;
      }
      const dt = Math.min(100, Math.max(0, now - lastNow));
      lastNow = now;
      const mult = frame.pixelSpeed === 'slow' ? 0.5 : frame.pixelSpeed === 'fast' ? 1.6 : 1;
      const still = frame.reduceMotion;
      if (!still) tAnim += (dt / 1000) * mult;

      const { lw, lh } = fit;
      const g = lg;
      // layer 1 (far): sky, stars, the moon
      const pf = still ? 0 : panOffset(tAnim, PAN_FAR, 90);
      const pm = still ? 0 : panOffset(tAnim, PAN_MID, 70, 1.3);
      const pn = still ? 0 : panOffset(tAnim, PAN_NEAR, 55, 2.1);
      g.drawImage(world.sky, -PAN_FAR + pf, 0);
      if (!still) {
        g.fillStyle = css[pal.starBright];
        for (const t of world.twinkles) {
          if (((tAnim / t.period + t.phase) % 1) < 0.1) {
            const x = t.x - PAN_FAR + pf;
            g.fillRect(x - 1, t.y, 3, 1);
            g.fillRect(x, t.y - 1, 1, 3);
          }
        }
      }
      // layer 2 (middle): clouds drifting, distant hills
      for (const c of world.clouds) {
        const x = still ? Math.floor(c.x0 % (lw + c.w)) - c.w : cloudX(c.x0, c.speed * mult, tAnim / mult, lw, c.w);
        g.drawImage(c.cv, x + pm, c.y);
      }
      g.drawImage(world.hills, -PAN_MID + pm, Math.floor(lh * 0.46));
      // layer 3 (near): the skyline and ground
      g.drawImage(world.skyline, -PAN_NEAR + pn, 0);
      if (!still) {
        g.fillStyle = css[pal.near];
        for (const b of world.blinkers) if (((tAnim / b.period + b.phase) % 1) > 0.82) g.fillRect(b.x - PAN_NEAR + pn, b.y, 2, 2);
      }

      // what is on screen: the main line, the small next line, or the idle console
      if (frame.lines !== repeatedFor) {
        repeatedFor = frame.lines;
        repeated = repeatedLines(frame.lines);
      }
      const vis = visibleLines(frame.lines, frame.index, frame.pos, repeated);
      const gm = geometry(frame);
      void gm;
      const changedMain = setSlot(slots.main, vis.main >= 0 ? vis.main : null, now);
      setSlot(slots.sub, vis.sub >= 0 ? vis.sub : null, now);
      setSlot(slots.idle, vis.main < 0 ? 'idle' : null, now);
      if (changedMain && vis.main >= 0 && frame.pixelSound === true && frame.playing) blip(frame);
      if (fontsReady) {
        drawSlot(slots.idle, now, still, paintIdle, null, frame);
        drawSlot(slots.sub, now, still, paintSub, null, frame);
        drawSlot(slots.main, now, still, paintMain, null, frame);
        if (frame.pixelHud !== false) paintHud(frame);
      }
      if (frame.pixelCrt !== false && crt) g.drawImage(crt, 0, 0);

      // to the window: whole-number scale, no smoothing, black outside
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(L, 0, 0, lw, lh, fit.ox, fit.oy, lw * fit.scale, lh * fit.scale);
      ctx.restore();

      // what the tests and the screenshot tool read
      stats.canvases = 6 + sprites.size * 4 + texts.size + icons.size;
      stats.sprites = sprites.size;
      stats.texts = texts.size;
      stats.scale = fit.scale;
      stats.lw = lw;
      stats.lh = lh;
      stats.ox = fit.ox;
      stats.oy = fit.oy;
      stats.cw = cw;
      stats.ch = ch;
      stats.coverage = fit.coverage;
      stats.main = vis.main;
      stats.sub = vis.sub;
      stats.idle = vis.main < 0;
      stats.palette = baseId;
      stats.fontsReady = fontsReady;
      stats.rects = vis.main >= 0 && sprites.has(`main|${vis.main}`) ? sprites.get(`main|${vis.main}`).rects : null;
      stats.size = vis.main >= 0 && sprites.has(`main|${vis.main}`) ? sprites.get(`main|${vis.main}`).size : 0;
      stats.rows = vis.main >= 0 && sprites.has(`main|${vis.main}`) ? sprites.get(`main|${vis.main}`).lay.rows.length : 0;
      stats.truncated = vis.main >= 0 && sprites.has(`main|${vis.main}`) ? !!sprites.get(`main|${vis.main}`).lay.truncated : false;
      stats.safe = { x0: G.x0, x1: G.x1, y0: G.y0, y1: G.y1 };
      stats.colors = css;
      stats.bright = pal.colors[pal.bright];
      // (tests only) when the probe flag is set: when each word of the main line shows
      if (globalThis.__pixelProbe && vis.main >= 0) {
        const ln = frame.lines[vis.main];
        stats.starts = ln.words.map((w) => shownAt(w, ln, frame.mode));
      }
      globalThis.__pixelStats = stats;
      globalThis.__pixelCanvas = L;
    },
  };
}
