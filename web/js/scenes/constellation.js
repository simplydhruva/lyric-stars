// Constellation scene: every word becomes a star, joined to earlier ones by thin links.
// Moved out of renderer.js unchanged. Everything drawn is a pure function of the playback
// position, so seeking, pausing and resuming never leave stale animation behind.
import { placeLine, hash } from '../sky-layout.js';
import { detectChorus } from './chorus.js';
import { drawEmotion } from './emotion.js';

const CENTER = [255, 250, 235];
const FADE_OUT_MS = 700;
const LINK_MS = 250;
const QUIET_AFTER_MS = 3500; // silence after a line before the sky starts to quiet
const QUIET_FADE_MS = 2000;
const QUIET_ALPHA = 0.12;
const EMPHASIS_DECAY_MS = 450;
const REPEAT_SIZE = 1.25; // a line that comes back (the chorus) returns with bigger, brighter stars
const REPEAT_BRIGHT = 1.2;
const PREVIEW_LEAD_MS = 4000; // the next line's dots show up this long before it starts (sooner in a short gap)
const PREVIEW_FADE_MS = 600;
const PREVIEW_ALPHA = 0.2;
const MAP_AFTER_MS = 2500; // the song map starts to form this long after the last line ends
const MAP_FADE_MS = 2200;
const MAP_MIN_LINES = 4;

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function makeGlowSprite(color) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, rgba(color, 0.9));
  grad.addColorStop(0.18, rgba(color, 0.35));
  grad.addColorStop(0.5, rgba(color, 0.08));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function sparklePath(ctx, x, y, r) {
  const k = r * 0.14;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + k, y - k, x + r, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + r);
  ctx.quadraticCurveTo(x - k, y + k, x - r, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - r);
  ctx.closePath();
}

export function createConstellation() {
  let ctx = null;
  let glow = null;
  let glowColor = '';
  const layouts = new Map();
  let layoutKey = null; // what the cached layouts were built for
  let chorus = null; // detectChorus() for the current lines
  let chorusFor = null;
  let map = null; // the song map, drawn once into its own canvas
  let mapKey = '';

  // Each line's sky depends on the line before it (fading stars, regions used),
  // so layouts are built in order from the last one cached.
  function layout(frame, index) {
    let i = index;
    while (i > 0 && !layouts.has(i - 1)) i--;
    for (; i <= index; i++) if (!layouts.has(i)) layouts.set(i, place(frame, i, layouts.get(i - 1)));
    return layouts.get(index);
  }

  function place(frame, index, prev) {
    const { w, h, fontFamily } = frame;
    const placed = placeLine({
      words: frame.lines[index].words,
      w,
      h,
      seed: hash(`${frame.seed}|${index}`),
      prev: prev || null,
      baseFont: clamp(Math.min(w, h * 1.6) * 0.03, 14, 34),
      spread: frame.spread / 100,
      chaos: frame.chaos / 100,
      measure: (text, font) => {
        ctx.font = `600 ${font}px ${fontFamily}`;
        return ctx.measureText(text).width;
      },
    });
    // A line sung again returns to the very same stars as the first time, so the earlier constellation comes back.
    const c = chorus[index];
    if (c && c.occurrence > 0 && c.firstIndex < index) {
      const first = layout(frame, c.firstIndex);
      if (first.stars.length === placed.stars.length && first.stars.length) return { ...placed, stars: first.stars, links: first.links, font: first.font };
    }
    return placed;
  }

  // Layouts depend on the lyrics, the seed, the size, the font and the spread and chaos settings.
  function checkCache(frame) {
    const key = [frame.w, frame.h, frame.fontFamily, frame.spread, frame.chaos, frame.seed];
    if (layoutKey && layoutKey.lines === frame.lines && layoutKey.key.every((v, i) => v === key[i])) return;
    layouts.clear();
    map = null;
    layoutKey = { lines: frame.lines, key };
    if (chorusFor !== frame.lines) {
      chorus = detectChorus(frame.lines);
      chorusFor = frame.lines;
    }
  }

  function drawSky(frame, index, alpha, leaving) {
    const { pos, mode, theme, reduceMotion: still } = frame;
    const line = frame.lines[index];
    const { stars, links, font } = layout(frame, index);
    const { star: STAR, core: CORE, label: LABEL } = theme;
    const words = line.words;
    const appear = (k) => (mode === 'line' ? line.time : words[k].start);
    const again = chorus[index]?.occurrence > 0;
    const size = again ? REPEAT_SIZE : 1;

    let visible = 0;
    while (visible < words.length && (leaving || appear(visible) <= pos)) visible++;
    if (!visible) return;

    // Links first, so stars sit on top of them.
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    // Each link draws from the older star to the new one as the new word appears.
    for (const { from, to } of links) {
      if (to >= visible) continue;
      const a = stars[from];
      const b = stars[to];
      const start = mode === 'line' ? line.time + to * 35 : appear(to);
      const p = leaving ? 1 : easeOut(clamp((pos - start) / LINK_MS, 0, 1));
      if (p <= 0) continue;
      // Reduce motion: links fade in place instead of drawing across.
      const reach = still ? 1 : p;
      ctx.strokeStyle = rgba(STAR, (again ? 0.55 : 0.38) * alpha * (still ? p : 1));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * reach, a.y + (b.y - a.y) * reach);
      ctx.stroke();
    }

    for (let k = 0; k < visible; k++) {
      const s = stars[k];
      const t = pos - appear(k);
      // Emphasis: 1 while the word is being sung, decaying once the next word starts.
      let e;
      if (mode === 'line') e = 0.45;
      else {
        const handoff = k + 1 < words.length ? words[k + 1].start : Math.max(words[k].end, words[k].start + 600);
        e = pos < handoff ? 1 : clamp(1 - (pos - handoff) / EMPHASIS_DECAY_MS, 0, 1);
      }
      if (leaving) e *= 0.5;
      const pop = leaving || still ? 1 : 1 + 0.55 * Math.exp(-Math.max(0, t) / 90);
      const r = font * (0.22 + 0.38 * e) * pop * size;
      const bright = Math.min(1, (0.5 + 0.5 * e) * (again ? REPEAT_BRIGHT : 1)) * alpha;

      const gs = r * (5 + 4 * e) * (again ? 1.3 : 1) * (1 + 0.3 * (frame.beat || 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(bright * (0.45 + 0.55 * e), 0, 1);
      ctx.drawImage(glow, s.x - gs / 2, s.y - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.fillStyle = rgba(CORE, bright);
      sparklePath(ctx, s.x, s.y, r * 1.6);
      ctx.fill();
      ctx.fillStyle = rgba(CENTER, bright);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.8, r * 0.22), 0, Math.PI * 2);
      ctx.fill();

      const bold = e > 0.5;
      ctx.font = `${bold ? 600 : 400} ${font * (0.9 + 0.12 * e)}px ${frame.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = s.labelBelow ? 'top' : 'bottom';
      ctx.fillStyle = rgba(LABEL, (0.45 + 0.55 * e) * alpha);
      const off = font * 0.9;
      const ly = s.labelBelow ? s.y + off : s.y - off;
      drawEmotion(ctx, frame, words[k].text, t, index * 31 + k, font, alpha, () => ctx.fillText(words[k].text, s.x, ly));
      ctx.fillText(words[k].text, s.x, ly);
    }
  }

  // Faint dots where the next line's stars will appear, so you can sing along before the words arrive.
  // A word's dot goes away the moment its star takes over.
  function drawPreview(frame, index) {
    const { lines, pos, theme, mode } = frame;
    const next = lines[index + 1];
    if (!next || !next.words.length) return;
    const cur = index >= 0 ? lines[index] : null;
    // Appears once the current line's last word is being sung, but never earlier than the lead before the next line.
    const from = Math.max(cur?.words.length ? cur.words[cur.words.length - 1].start : -Infinity, next.time - PREVIEW_LEAD_MS);
    const a = clamp((pos - from) / PREVIEW_FADE_MS, 0, 1);
    if (a <= 0 || pos >= next.time) return;
    const { stars, font } = layout(frame, index + 1);
    const alpha = PREVIEW_ALPHA * easeOut(a) * (frame.quiet ? 0.35 : 1);
    const r = font * 0.16;
    ctx.fillStyle = rgba(theme.star, alpha);
    for (let k = 0; k < stars.length; k++) {
      if (mode !== 'line' && next.words[k].start <= pos) continue;
      ctx.beginPath();
      ctx.arc(stars[k].x, stars[k].y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The whole song as one picture: every line's stars and links together. Lines sung again sit on the same
  // stars, so the chorus shines brightest. Drawn once into its own canvas and then just faded in.
  function songMap(frame) {
    const { w, h, dpr, lines, theme } = frame;
    const key = [w, h, dpr, theme.star.join(), layoutKey?.key.join('|')].join('#');
    if (map && mapKey === key) return map;
    map = document.createElement('canvas');
    map.width = Math.round(w * dpr);
    map.height = Math.round(h * dpr);
    mapKey = key;
    const g = map.getContext('2d');
    g.scale(dpr, dpr);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].words.length) continue;
      const { stars, links, font } = layout(frame, i);
      g.lineWidth = 1;
      g.strokeStyle = rgba(theme.star, 0.1);
      for (const { from, to } of links) {
        if (!stars[from] || !stars[to]) continue;
        g.beginPath();
        g.moveTo(stars[from].x, stars[from].y);
        g.lineTo(stars[to].x, stars[to].y);
        g.stroke();
      }
      const gs = font * 2.6;
      for (const st of stars) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.5;
        g.drawImage(glow, st.x - gs / 2, st.y - gs / 2, gs, gs);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.fillStyle = rgba(theme.core, 0.7);
        sparklePath(g, st.x, st.y, font * 0.4);
        g.fill();
      }
    }
    return map;
  }

  return {
    id: 'constellation',
    name: 'Constellation',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      map = null;
      layouts.clear();
      layoutKey = null;
    },
    draw(frame) {
      const { lines, index, pos, theme } = frame;
      const key = theme.star.join();
      if (key !== glowColor) {
        glow = makeGlowSprite(theme.star);
        glowColor = key;
      }
      checkCache(frame);
      if (frame.previewNext) drawPreview(frame, index);
      if (index < 0) return;

      const cur = lines[index];
      // The sky for the current line, quieting during long silences.
      let curAlpha = 1;
      const nextTime = index + 1 < lines.length ? lines[index + 1].time : Infinity;
      if (!cur.words.length) curAlpha = 0;
      else if (pos > cur.end + QUIET_AFTER_MS && nextTime - pos > 1500) {
        curAlpha = 1 - (1 - QUIET_ALPHA) * clamp((pos - cur.end - QUIET_AFTER_MS) / QUIET_FADE_MS, 0, 1);
      }
      if (frame.quiet) curAlpha = Math.min(curAlpha, 0.35);

      // After the last line the whole song gathers into one map. A function of the position, so seeking back removes it.
      let last = lines.length - 1;
      while (last >= 0 && !lines[last].words.length) last--;
      let mapAlpha = 0;
      if (frame.songMap && index >= last && last >= 0 && lines.filter((l) => l.words.length).length >= MAP_MIN_LINES) {
        mapAlpha = easeOut(clamp((pos - lines[last].end - MAP_AFTER_MS) / MAP_FADE_MS, 0, 1));
      }
      if (mapAlpha > 0) {
        curAlpha *= 1 - mapAlpha;
        ctx.globalAlpha = mapAlpha * (frame.quiet ? 0.35 : 1);
        ctx.drawImage(songMap(frame), 0, 0, frame.w, frame.h);
        ctx.globalAlpha = 1;
      }

      // The previous sky fades out while the new one forms.
      const since = pos - cur.time;
      if (since < FADE_OUT_MS && index > 0 && lines[index - 1].words.length) {
        const prev = lines[index - 1];
        const prevGapAlpha = cur.time - prev.end > QUIET_AFTER_MS + QUIET_FADE_MS ? QUIET_ALPHA : 1;
        drawSky(frame, index - 1, prevGapAlpha * (1 - easeOut(since / FADE_OUT_MS)), true);
      }
      if (curAlpha > 0) drawSky(frame, index, curAlpha, false);
    },
  };
}
