import test from 'node:test';
import assert from 'node:assert/strict';
import { createKinetic } from '../web/js/scenes/kinetic.js';
import { layoutKinetic, wordScales, ENTER_GROW, MARGIN } from '../web/js/scenes/kinetic-layout.js';

// A canvas that tracks translate/rotate/save/restore and records the box of every fillText (word or emoji).
function fakeCtx(boxes) {
  let m = { x: 0, y: 0, a: 0 };
  const stack = [];
  const ctx = {
    font: '', fillStyle: '', textAlign: 'center', textBaseline: 'middle', globalAlpha: 1, shadowBlur: 0, shadowColor: '', lineWidth: 1, strokeStyle: '',
    save() { stack.push({ ...m }); },
    restore() { m = stack.pop() || m; },
    translate(x, y) { m.x += x * Math.cos(m.a) - y * Math.sin(m.a); m.y += x * Math.sin(m.a) + y * Math.cos(m.a); },
    rotate(a) { m.a += a; },
    scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, rect() {}, clip() {}, fillRect() {}, strokeText() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    setTransform() {},
    measureText(t) { return { width: [...String(t)].length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || 10) * 0.55 }; },
    fillText(t, x, y) {
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || 10);
      const hw = ctx.measureText(t).width / 2;
      const hh = px * 0.5;
      const xs = [];
      const ys = [];
      for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
        const lx = x + dx;
        const ly = y + dy;
        xs.push(m.x + lx * Math.cos(m.a) - ly * Math.sin(m.a));
        ys.push(m.y + lx * Math.sin(m.a) + ly * Math.cos(m.a));
      }
      boxes.push({ t, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), emoji: /\p{Extended_Pictographic}/u.test(t) });
    },
  };
  return ctx;
}

const theme = { star: [255, 210, 90], core: [255, 250, 220] };
function lineOf(time, texts, step = 300) {
  return { time, words: texts.map((text, i) => ({ text, start: time + i * step, end: time + i * step + step * 0.9 })) };
}
const long30 = 'Supercalifragilisticexpialidocious'.slice(0, 30);
const cases = {
  'a 30-letter word': [lineOf(0, ['I', long30, 'you'])],
  'a line of 20 words': [lineOf(0, Array.from({ length: 20 }, (_, i) => ['love', 'remember', 'tonight', 'a', 'forever'][i % 5]), 200)],
  'the biggest word last': [lineOf(0, ['to', 'be', 'a', 'in', 'the', 'unforgettable'])],
  'emojis on every word': [lineOf(0, ['fire', 'love', 'sun', 'moon', 'heart', 'star', 'rain', 'dance'])],
  'a chorus line': [lineOf(0, ['hold', 'on', 'forever', 'tonight']), lineOf(3000, ['hold', 'on', 'forever', 'tonight']), lineOf(6000, ['hold', 'on', 'forever', 'tonight'])],
};
const sizes = [[1920, 1080, 1], [2560, 1440, 1], [700, 900, 1], [400, 800, 1], [960, 540, 2]];

function sweep(lines, w, h, dpr, emojis = true) {
  const k = createKinetic();
  const boxes = [];
  const ctx = fakeCtx(boxes);
  k.init(null, ctx);
  const bad = [];
  const end = lines.at(-1).time + 4000;
  for (let pos = 0; pos <= end; pos += 16) {
    let index = -1;
    lines.forEach((l, i) => { if (pos >= l.time) index = i; });
    boxes.length = 0;
    k.draw({ ctx, w, h, dpr, pos, now: pos, lines, index, line: lines[index], words: lines[index]?.words, theme, palette: [], fontFamily: 'sans-serif', mode: 'word', reduceMotion: false, quiet: false, emojis, emotion: false, seed: '', beat: 0, glow: 0 });
    for (const b of boxes) {
      const e = 0.5; // half a pixel of rounding
      if (b.x0 < w * MARGIN - e || b.x1 > w * (1 - MARGIN) + e || b.y0 < h * MARGIN - e || b.y1 > h * (1 - MARGIN) + e) bad.push(`${pos}ms "${b.t}" x ${b.x0.toFixed(0)}..${b.x1.toFixed(0)} y ${b.y0.toFixed(0)}..${b.y1.toFixed(0)}`);
    }
  }
  return bad;
}

for (const [name, lines] of Object.entries(cases)) {
  test(`kinetic: ${name} stays inside a 5% margin in every frame, at every size`, () => {
    for (const [w, h, dpr] of sizes) {
      const bad = sweep(lines, w, h, dpr);
      assert.equal(bad.length, 0, `${w}x${h}@${dpr}: ${bad.length} outside, first: ${bad[0]}`);
    }
  });
}

test('kinetic: a 6-line fake song never leaves the screen, including mid-slam', () => {
  const words = ['hold', 'me', 'closer', 'tiny', 'dancer', 'forever'];
  const lines = Array.from({ length: 6 }, (_, i) => lineOf(i * 2500, words.slice(0, 3 + (i % 4)).concat(i === 4 ? ['Supercalifragilisticexpialidocious'] : [])));
  for (const [w, h, dpr] of sizes) {
    const bad = sweep(lines, w, h, dpr);
    assert.equal(bad.length, 0, `${w}x${h}@${dpr}: ${bad[0]}`);
  }
});

test('layout: a word wider than the row is shrunk alone, the others keep their size', () => {
  const measure = (t, f) => t.length * f * 0.55;
  const texts = ['go', 'x'.repeat(30), 'on'];
  const scales = wordScales(texts.map((text) => ({ text, start: 0, end: 0 })));
  const fit = layoutKinetic(texts, scales, measure, { maxW: 360, maxH: 1000, baseFont: 80, grow: ENTER_GROW });
  assert.ok(fit.widths[1] * ENTER_GROW <= 360 + 1e-6, 'even mid-slam');
  assert.ok(fit.sizes[1] < fit.font * scales[1], 'the long word is shrunk');
  assert.ok(Math.abs(fit.sizes[0] - fit.font * scales[0]) < 1e-9 && Math.abs(fit.sizes[2] - fit.font * scales[2]) < 1e-9);
  for (const r of fit.rows) assert.ok(r.width <= 360 + 1e-6);
});

test('layout: a line too tall for the screen is scaled down evenly until it fits', () => {
  const measure = (t, f) => t.length * f * 0.55;
  const texts = Array.from({ length: 40 }, () => 'wonderful');
  const scales = texts.map(() => 1);
  const fit = layoutKinetic(texts, scales, measure, { maxW: 300, maxH: 300, baseFont: 60, grow: ENTER_GROW });
  assert.ok(fit.height <= 300 + 1e-6, `height ${fit.height}`);
  assert.ok(new Set(fit.sizes.map((s) => s.toFixed(6))).size === 1, 'all words scaled evenly');
});
