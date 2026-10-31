// Constellation scene: every word becomes a star, joined to earlier ones by thin links.
// Moved out of renderer.js unchanged. Everything drawn is a pure function of the playback
// position, so seeking, pausing and resuming never leave stale animation behind.
import { placeLine, hash } from '../sky-layout.js';

const CENTER = [255, 250, 235];
const FADE_OUT_MS = 700;
const LINK_MS = 250;
const QUIET_AFTER_MS = 3500; // silence after a line before the sky starts to quiet
const QUIET_FADE_MS = 2000;
const QUIET_ALPHA = 0.12;
const EMPHASIS_DECAY_MS = 450;

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
    return placeLine({
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
  }

  // Layouts depend on the lyrics, the seed, the size, the font and the spread and chaos settings.
  function checkCache(frame) {
    const key = [frame.w, frame.h, frame.fontFamily, frame.spread, frame.chaos, frame.seed];
    if (layoutKey && layoutKey.lines === frame.lines && layoutKey.key.every((v, i) => v === key[i])) return;
    layouts.clear();
    layoutKey = { lines: frame.lines, key };
  }

  function drawSky(frame, index, alpha, leaving) {
    const { pos, mode, theme, reduceMotion: still } = frame;
    const line = frame.lines[index];
    const { stars, links, font } = layout(frame, index);
    const { star: STAR, core: CORE, label: LABEL } = theme;
    const words = line.words;
    const appear = (k) => (mode === 'line' ? line.time : words[k].start);

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
      ctx.strokeStyle = rgba(STAR, 0.38 * alpha * (still ? p : 1));
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
      const r = font * (0.22 + 0.38 * e) * pop;
      const bright = (0.5 + 0.5 * e) * alpha;

      const gs = r * (5 + 4 * e);
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
      ctx.fillText(words[k].text, s.x, s.labelBelow ? s.y + off : s.y - off);
    }
  }

  return {
    id: 'constellation',
    name: 'Constellation',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      layouts.clear();
      layoutKey = null;
    },
    draw(frame) {
      const { lines, index, pos, theme } = frame;
      if (index < 0) return;
      const key = theme.star.join();
      if (key !== glowColor) {
        glow = makeGlowSprite(theme.star);
        glowColor = key;
      }
      checkCache(frame);

      const cur = lines[index];
      // The sky for the current line, quieting during long silences.
      let curAlpha = 1;
      const nextTime = index + 1 < lines.length ? lines[index + 1].time : Infinity;
      if (!cur.words.length) curAlpha = 0;
      else if (pos > cur.end + QUIET_AFTER_MS && nextTime - pos > 1500) {
        curAlpha = 1 - (1 - QUIET_ALPHA) * clamp((pos - cur.end - QUIET_AFTER_MS) / QUIET_FADE_MS, 0, 1);
      }
      if (frame.quiet) curAlpha = Math.min(curAlpha, 0.35);

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
