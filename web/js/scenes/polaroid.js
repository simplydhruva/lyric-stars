// Polaroid: every line is an instant photo pinned to a dark wall. The picture is the album cover (slowly drifting, with a
// faded warm film look and a little grain) that "develops" over about a second; the lyric is handwritten on the white
// strip below as it is sung. A new line's card flies in and swings like a pinned photo; the older cards stay behind it,
// smaller, dimmer and a little blurred, and fade away. The first card of a song slides out of a camera at the bottom edge.
//
// The timing rule: a word is fully readable on its start frame, at full strength. Only the card around it moves. The
// maths (card size, swing, stack, flight, development, Ken Burns, flash) lives in polaroid-motion.js and is unit-tested.
// Pure function of the playback position. The pitch-black sky behind is the shared one; nothing here glows.
import { artImage, pokeRedraw } from './art.js';
import { createFitCache } from './line-draw.js';
import { LINE_HEIGHT } from './karaoke-layout.js';
import { clamp, easeOut, hash, shownAt } from './motion.js';
import {
  CAMERA_MS, STACK_DEPTH, PRE_MS,
  arrival, arriveAngle, ageOf, cameraIntro, cardSize, coverRect, develop, flashAlpha, isFlashLine, kenBurns, pendulum,
  placeOf, pop, seedInt, slot, tiltOf,
} from './polaroid-motion.js';

const FAMILY = '"Caveat", "Segoe Script", "Ink Free", cursive';
const PAPER = '#f7f3ea';
const INK = 'rgb(38,34,46)';
const GOLD = [200, 135, 10];
const READ_MS = 400; // the previous card stays untouched this long after its last word
const STILL_FADE_MS = 200; // reduce motion: a card cuts in with a short fade that is over when its line starts

// Colour strings for overlays whose alpha changes every frame, made once (no string building while drawing).
const STEPS = 64;
const table = (r, g, b) => Array.from({ length: STEPS + 1 }, (_, i) => `rgba(${r},${g},${b},${(i / STEPS).toFixed(3)})`);
const BLACK = table(0, 0, 0);
const DEV_DARK = table(18, 16, 24);
const DEV_WASH = table(238, 230, 214);
const q = (a) => Math.round(clamp(a, 0, 1) * STEPS);
// A little blur for the cards in the back, in 0.15 px steps up to about 1.8 px.
const BLURS = Array.from({ length: 13 }, (_, i) => `blur(${(i * 0.15).toFixed(2)}px)`);
const PINS = ['rgb(196,52,48)', 'rgb(48,112,186)', 'rgb(222,168,40)', 'rgb(66,150,92)'];

function noiseTile() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g?.createImageData) return null;
  const d = g.createImageData(128, 128);
  if (!d?.data || !g.putImageData) return null;
  let s = 20240607;
  for (let i = 0; i < 128 * 128; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = s >>> 24;
    d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v;
    d.data[i * 4 + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c;
}

// How long before a line starts its card may fly in: the silence before it (never more than PRE_MS).
function gapBefore(lines, li) {
  if (li <= 0) return 0;
  const p = lines[li - 1];
  const last = p.words[p.words.length - 1];
  const end = last && Number.isFinite(last.end) ? last.end : p.time;
  return lines[li].time - end;
}

// How long before its line starts a card may arrive (and the card before it start to move aside): the silence before the
// line, never more than PRE_MS (a short fade with reduce motion). With no silence it is 0: nothing moves before the line.
function preOf(lines, k, still) {
  if (k <= 0) return still ? STILL_FADE_MS : 0;
  // the previous line's finished words stay readable for READ_MS before anything moves over them
  const gap = Math.max(0, gapBefore(lines, k) - READ_MS);
  return still ? Math.min(gap, STILL_FADE_MS) : Math.min(gap, PRE_MS);
}

export function createPolaroid() {
  let ctx = null;
  let grain = null;
  let hasFilter = false;
  const cache = createFitCache(() => ctx, { weight: 400, family: () => FAMILY, maxRows: 3 });
  // reused every frame, so nothing is allocated while drawing
  const cs = {};
  const pl = {};
  const kb = {};
  const cr = {};
  const sl = {};
  const A = {};
  const CI = {};
  const P = { x: 0, y: 0, rot: 0, sc: 1, alpha: 1, dim: 0, age: 0, dev: 1, since: 0, devSince: 0, intro: false };
  let fontOk = false;
  let seedKey;
  let seedI = 0;
  let accentKey = null;
  let accent = INK;
  let washKey = null;
  let wash = null;

  function accentOf(frame) {
    const key = frame.palette || frame.theme;
    if (key === accentKey) return accent;
    accentKey = key;
    const c = frame.palette?.[0] || GOLD;
    const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const k = lum > 0.42 ? 0.42 / lum : 1; // dark enough to read on white paper
    accent = `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
    return accent;
  }

  // The picture when there is no cover: a wash of the album colours, made once per palette and card size.
  function washOf(frame) {
    const key = frame.palette || frame.theme;
    if (wash && washKey === key && wash.cw === cs.cw) return wash.g;
    const c1 = frame.palette?.[0] || frame.theme.star;
    const c2 = frame.palette?.[1] || frame.theme.label;
    const px = -cs.photo / 2;
    const g = ctx.createRadialGradient(px + cs.photo * 0.3, px + cs.photo * 0.3, 0, 0, 0, cs.photo * 0.85);
    g.addColorStop(0, `rgb(${c1[0]},${c1[1]},${c1[2]})`);
    g.addColorStop(1, `rgb(${c2[0]},${c2[1]},${c2[2]})`);
    washKey = key;
    wash = { g, cw: cs.cw };
    return g;
  }

  // Where a card is and how it looks at this moment: fills P. li is the line the card belongs to.
  function setPose(frame, li, front) {
    const { w, h, pos, lines, index, reduceMotion: still } = frame;
    const T = lines[li].time;
    const since = pos - T;
    placeOf(li, seedI, pl);
    const bx = w / 2 + pl.dx * w;
    const by = h * 0.46 + pl.dy * h;
    const side = li & 1 ? 1 : -1;
    let x = bx;
    let y = by;
    let rot = tiltOf(li, seedI);
    let sc = 1;
    let alpha = 1;
    let age = 0;
    P.dim = 0;
    P.intro = false;
    P.devSince = since;
    // the cards move back from the moment the next card starts to arrive, so it never lands on words still showing
    if (li < front) age = ageOf(front, li, pos - lines[front].time + preOf(lines, front, still), still);
    if (age > 0) {
      slot(age, side, sl);
      x += sl.x * cs.cw;
      y += sl.y * cs.cw;
      sc = sl.scale;
      alpha = sl.alpha;
      P.dim = sl.dim;
      if (!still && age < 1) {
        // the old card drops back and slides aside with a little turn
        rot += side * 0.06 * Math.sin(Math.PI * age);
        y += Math.sin(Math.PI * age) * cs.cw * 0.05;
      }
    }
    if (still) {
      if (li > index) {
        const pre = preOf(lines, li, true);
        alpha = pre > 0 ? easeOut((pos - (T - pre)) / pre) : 1;
      }
      P.dev = 1;
      P.since = 0;
    } else if (li === 0 && index < 0) {
      // the first card: out of the camera slot at the bottom edge, then to its place
      cameraIntro(pos, T, CI);
      const slotY = camera(h).slotY;
      const yEnd = slotY - cs.ch / 2 - 3;
      const yOut = slotY + cs.ch / 2 + (yEnd - slotY - cs.ch / 2) * easeOut(CI.eject);
      y = yOut + (by - yOut) * CI.glide;
      rot *= CI.glide;
      P.intro = true;
      P.devSince = pos - (T - CAMERA_MS * 0.6);
      P.since = P.devSince;
      P.dev = develop(P.devSince);
    } else {
      if (li > 0) {
        arrival(pos, T, gapBefore(lines, li), A);
        if (A.k !== 0) {
          const near = cs.cw * 0.35;
          const far = Math.max(w, h) * 0.75 + cs.ch * 0.5;
          const dist = near + (far - near) * A.start;
          const ang = arriveAngle(li, seedI);
          x += Math.cos(ang) * dist * A.k;
          y += Math.sin(ang) * dist * A.k;
          rot += side * 0.2 * A.k; // it turns a little as it flies in
        }
      } else P.devSince = pos - (T - CAMERA_MS * 0.6); // the camera's first card developed while it came out
      // a pinned photo knocked into place: it swings about its pin and settles (the swing eases in so there is no snap)
      const amp = (hash(li, 41 + seedI) < 0.5 ? -1 : 1) * 0.06;
      const ease = clamp(since / 120, 0, 1);
      rot += pendulum(since, amp) * ease * ease * (3 - 2 * ease);
      // the last word of the line: a tiny pop
      if (li === index) {
        const words = frame.lines[li].words;
        const lw = words[words.length - 1];
        if (lw) sc *= pop(pos - shownAt(lw, frame.lines[li], frame.mode));
      }
      P.dev = develop(P.devSince);
      P.since = Math.max(0, P.devSince);
    }
    P.x = x;
    P.y = y;
    P.rot = rot;
    P.sc = sc;
    P.alpha = alpha;
    P.age = age;
  }

  // The card's face (grain, picture, flash, tape or pin, handwriting) in card coordinates, centred on (0,0).
  function paintFace(frame, li, front, pin) {
    const { w, h, dpr, pos, lines, index, reduceMotion: still } = frame;
    const line = lines[li];
    const { cw, ch, border, photo, strip } = cs;
    const film = frame.film !== false;
    if (film && grain) {
      ctx.globalAlpha = P.alpha * 0.045; // paper texture
      ctx.fillStyle = grain;
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      ctx.globalAlpha = P.alpha;
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.09)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-cw / 2 + 0.5, -ch / 2 + 0.5, cw - 1, ch - 1);

    // the picture: the cover, cropped square and slowly drifting (a different way for every line)
    const px = -cw / 2 + border;
    const py = -ch / 2 + border;
    const img = artImage(frame.art);
    if (img) {
      kenBurns(li, seedI, still ? 0 : P.since, kb);
      coverRect(img.naturalWidth, img.naturalHeight, kb.zoom, kb.panX, kb.panY, cr);
      ctx.drawImage(img, cr.sx, cr.sy, cr.side, cr.side, px, py, photo, photo);
    } else {
      ctx.fillStyle = washOf(frame);
      ctx.fillRect(px, py, photo, photo);
    }
    if (film) {
      ctx.fillStyle = 'rgba(255,190,120,0.10)'; // warm
      ctx.fillRect(px, py, photo, photo);
      ctx.fillStyle = 'rgba(66,54,62,0.13)'; // lifted blacks, faded
      ctx.fillRect(px, py, photo, photo);
      if (grain) {
        ctx.globalAlpha = P.alpha * 0.09;
        ctx.fillStyle = grain;
        ctx.fillRect(px, py, photo, photo);
        ctx.globalAlpha = P.alpha;
      }
    }
    if (P.dev < 1) {
      // developing: dark and washed out, to full colour (the picture only: the writing is never held back)
      const k = 1 - P.dev;
      ctx.fillStyle = DEV_DARK[q(k * 0.72)];
      ctx.fillRect(px, py, photo, photo);
      ctx.fillStyle = DEV_WASH[q(k * 0.3)];
      ctx.fillRect(px, py, photo, photo);
    }

    // the optional camera flash, drawn before the writing so it can never cover a word
    if (front && frame.polaroidFlash && !still && isFlashLine(li, seedI)) {
      const a = flashAlpha(pos - line.time);
      if (a > 0) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }

    // a strip of tape or a pin at the top
    ctx.save();
    ctx.translate(0, pin);
    if (hash(li, 5 + seedI) < 0.5) {
      ctx.rotate((hash(li, 6 + seedI) - 0.5) * 0.3);
      ctx.fillStyle = 'rgba(236,226,186,0.78)';
      ctx.fillRect(-cw * 0.13, -cw * 0.035, cw * 0.26, cw * 0.07);
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(-cw * 0.13, cw * 0.032, cw * 0.26, 1);
    } else {
      const r = cw * 0.03;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.arc(r * 0.35, r * 0.45, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PINS[Math.floor(hash(li, 8 + seedI) * PINS.length)];
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.3, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // the handwriting, written as sung: the word being sung in the album colour, the rest in dark ink
    if (line.words.length && li <= index) {
      const f = cache.fit(frame, li, cw * 0.13, cw * 0.88);
      const s = Math.min(1, (strip * 0.84) / f.height);
      const rowH = f.font * LINE_HEIGHT;
      ctx.save();
      ctx.translate(0, -ch / 2 + border + photo + strip * 0.52);
      ctx.scale(s, s);
      f.css ??= `400 ${f.font}px ${FAMILY}`;
      ctx.font = f.css;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const sungHere = li === index;
      const hot = accentOf(frame);
      f.rows.forEach((row, r) => {
        const cy = -f.height / 2 + (r + 0.5) * rowH;
        for (let i = row.from; i < row.to; i++) {
          const word = line.words[i];
          if (sungHere && shownAt(word, line, frame.mode) > pos) continue;
          ctx.fillStyle = sungHere && frame.mode !== 'line' && pos < word.end ? hot : INK;
          ctx.fillText(word.text, -row.width / 2 + f.offsets[i], cy);
        }
      });
      ctx.restore();
    }
  }

  // An older card, softened once: blurring live every frame is far too slow, so the finished card is blurred into a small
  // canvas that is reused (made again if the size, cover, palette or film setting changes).
  const baked = new Map();
  function bake(frame, li) {
    if (!hasFilter || typeof document === 'undefined') return null;
    const { cw, ch, border } = cs;
    const key = `${Math.round(cw)}|${frame.dpr}|${frame.art}|${frame.film !== false}|${seedI}|${fontOk}`;
    let e = baked.get(li);
    if (e && e.key === key) return e.canvas;
    const cv = e?.canvas ?? document.createElement('canvas');
    cv.width = Math.max(1, Math.round(cw * frame.dpr));
    cv.height = Math.max(1, Math.round(ch * frame.dpr));
    const bc = cv.getContext('2d');
    if (!bc) return null;
    const main = ctx;
    const keep = { x: P.x, y: P.y, rot: P.rot, sc: P.sc, alpha: P.alpha, dim: P.dim, age: P.age, dev: P.dev, since: P.since, devSince: P.devSince };
    ctx = bc;
    try {
      ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.filter = BLURS[6];
      ctx.translate(cw / 2, ch / 2);
      ctx.fillStyle = PAPER;
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      P.alpha = 1;
      P.dim = 0;
      P.dev = 1;
      P.since = 1e9;
      paintFace(frame, li, false, -ch / 2 + border * 0.55);
    } finally {
      ctx = main;
      Object.assign(P, keep);
    }
    baked.set(li, { key, canvas: cv });
    if (baked.size > STACK_DEPTH + 4) baked.delete(baked.keys().next().value);
    return cv;
  }

  function drawCard(frame, li, front, baked = null) {
    const { w, h, dpr, pos, lines, index, reduceMotion: still } = frame;
    const line = lines[li];
    if (P.alpha <= 0.01) return;
    const { cw, ch, border, photo, strip } = cs;
    const film = frame.film !== false;
    ctx.save();
    ctx.globalAlpha = P.alpha;
    ctx.translate(P.x, P.y);
    ctx.scale(P.sc, P.sc);
    // everything swings about the pin, near the top edge
    const pin = -ch / 2 + border * 0.55;
    ctx.translate(0, pin);
    ctx.rotate(P.rot);
    ctx.translate(0, -pin);

    // paper with a soft shadow that leans the other way as the card swings (offsets are in device pixels)
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = cw * 0.05 * dpr * P.sc;
    ctx.shadowOffsetX = (cw * 0.02 - Math.sin(P.rot) * cw * 0.35) * dpr * P.sc;
    ctx.shadowOffsetY = cw * 0.035 * dpr * P.sc;
    ctx.fillStyle = PAPER;
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    if (baked && P.age >= 1) {
      ctx.drawImage(baked, -cw / 2, -ch / 2, cw, ch); // settled: the softened picture made once
    } else {
      paintFace(frame, li, front, pin);
      if (baked) {
        ctx.globalAlpha = P.alpha * clamp((P.age - 0.1) / 0.9, 0, 1);
        ctx.drawImage(baked, -cw / 2, -ch / 2, cw, ch);
        ctx.globalAlpha = P.alpha;
      }
    }
    // the cards at the back are dimmer
    if (P.dim > 0.004) {
      ctx.fillStyle = BLACK[q(P.dim)];
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
    }
    ctx.restore();
  }

  // Where the camera sits: a little above the bottom edge, clear of the playback controls that sit over it.
  const cam = { top: 0, bh: 0, slotY: 0 };
  function camera(h) {
    cam.bh = cs.cw * 0.12;
    cam.top = h - clamp(h * 0.22, 150, 260) - cam.bh;
    cam.slotY = cam.top + cam.bh * 0.3;
    return cam;
  }

  // The camera the first card comes out of: a dark body with a slot, drawn over the card's start.
  function drawCamera(frame, a) {
    const { w, h } = frame;
    const bw = cs.cw * 1.3;
    const { bh, top } = camera(h);
    const x = w / 2 - bw / 2;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#1b1b20';
    ctx.fillRect(x, top, bw, bh);
    ctx.fillStyle = '#34343c';
    ctx.fillRect(x, top, bw, 2);
    ctx.fillStyle = '#050507';
    ctx.fillRect(w / 2 - cs.cw * 0.53, top + bh * 0.2, cs.cw * 1.06, bh * 0.2);
    ctx.fillStyle = '#0c0c10';
    ctx.beginPath();
    ctx.arc(x + bw * 0.86, top + bh * 0.58, bh * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    id: 'polaroid',
    name: 'Polaroid',
    init(_canvas, context) {
      ctx = context;
      hasFilter = 'filter' in ctx;
      const tile = noiseTile();
      grain = tile && ctx.createPattern ? ctx.createPattern(tile, 'repeat') : null;
      // the handwriting font loads on first use; wrap the lines again with it and repaint a paused picture
      if (typeof document !== 'undefined' && document.fonts?.load) {
        document.fonts.load('400 40px Caveat').then(
          () => {
            cache.clear();
            pokeRedraw();
          },
          () => {}
        );
      }
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos, reduceMotion: still } = frame;
      if (frame.seed !== seedKey) {
        seedKey = frame.seed;
        seedI = seedInt(seedKey);
      }
      if (!fontOk && typeof document !== 'undefined' && document.fonts?.check?.('400 40px Caveat')) {
        fontOk = true; // the handwriting font has arrived: wrap every line again with its real widths
        cache.clear();
      }
      cardSize(w, h, cs);
      cache.check(frame, cs.cw * 0.13, cs.cw * 0.88);
      if (index < 0) {
        // before the first line: its card comes out of the camera (or just fades in, with reduce motion)
        if (pos < lines[0].time - (still ? STILL_FADE_MS : CAMERA_MS)) return;
        setPose(frame, 0, 0);
        if (!still) {
          // the card is only seen above the slot: it comes out of it
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, camera(h).slotY);
          ctx.clip();
          drawCard(frame, 0, true);
          ctx.restore();
          drawCamera(frame, CI.slot);
        } else drawCard(frame, 0, true);
        return;
      }
      // The card in front is the current line's, or the next line's once it has started to arrive (it flies in during the
      // silence before its line and the cards behind it, the current one included, move aside at the same time).
      const nx = index + 1;
      const front = nx < lines.length && pos >= lines[nx].time - preOf(lines, nx, still) && preOf(lines, nx, still) > 0 ? nx : index;
      for (let li = Math.max(0, front - STACK_DEPTH - 1); li < front; li++) {
        setPose(frame, li, front);
        drawCard(frame, li, false, P.age > 0.1 ? bake(frame, li) : null);
      }
      setPose(frame, front, front);
      drawCard(frame, front, true);
    },
  };
}
