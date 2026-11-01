import test from 'node:test';
import assert from 'node:assert/strict';
import { Sky, STAR_COUNT, COMET_GAP_S, SKY_MODES, DEFAULT_SKY } from '../web/js/sky.js';

// a canvas that records what is drawn
function recorder() {
  const c = { rects: [], strokes: 0, fills: new Set(), gradients: 0, shadow: 0, fillStyle: '', strokeStyle: '', lineWidth: 1 };
  return Object.assign(c, {
    fillRect(x, y, w, h) { c.rects.push([x, y, w, h, c.fillStyle]); },
    beginPath() {}, moveTo() {}, lineTo() { c.lastLine = true; }, stroke() { c.strokes++; },
    createRadialGradient() { c.gradients++; }, createLinearGradient() { c.gradients++; },
    set shadowBlur(v) { c.shadow += v; },
  });
}
const draw = (sky, t, o = {}, w = 1920, h = 1080, dpr = 1) => {
  const ctx = recorder();
  sky.draw(ctx, w, h, dpr, t, o);
  return ctx;
};

test('the default is stars and comets; there are three modes', () => {
  assert.deepEqual(SKY_MODES, ['off', 'stars', 'comets']);
  assert.equal(DEFAULT_SKY, 'comets');
  assert.ok(STAR_COUNT >= 120 && STAR_COUNT <= 200);
});

test('off draws nothing; stars draws only tiny sharp squares, no gradients or glow', () => {
  assert.equal(draw(new Sky(), 0, { mode: 'off' }).rects.length, 0);
  const c = draw(new Sky(), 0, { mode: 'stars' });
  assert.equal(c.rects.length, STAR_COUNT);
  assert.equal(c.gradients, 0);
  assert.equal(c.shadow, 0);
  for (const [, , w, h] of c.rects) assert.ok(w >= 1 && w <= 2 && h === w);
});

test('stars sit on whole device pixels at devicePixelRatio 1, 1.5 and 2', () => {
  for (const dpr of [1, 1.5, 2]) {
    const sky = new Sky();
    for (const t of [0, 3000, 9000]) {
      const c = draw(sky, t, { mode: 'stars' }, 1280, 720, dpr);
      for (const [x, y] of c.rects) {
        assert.ok(Math.abs(x * dpr - Math.round(x * dpr)) < 1e-4, `x ${x} at ${dpr}`);
        assert.ok(Math.abs(y * dpr - Math.round(y * dpr)) < 1e-4, `y ${y} at ${dpr}`);
        assert.ok(x >= 0 && x < 1280 && y >= 0 && y < 720);
      }
    }
  }
});

test('stars twinkle each at their own pace, and drift one way, slowly', () => {
  const sky = new Sky();
  const first = draw(sky, 0, { mode: 'stars' }).rects.map((r) => r[4]);
  let changed = 0;
  const seen = new Set();
  for (let t = 100; t <= 4000; t += 100) {
    const r = draw(sky, t, { mode: 'stars' }).rects;
    r.forEach((q, i) => q[4] !== first[i] && changed++);
    seen.add(r.map((q) => q[4]).join());
  }
  assert.ok(changed > STAR_COUNT * 10, 'stars change brightness over time');
  // drift: after 60 s no star has moved far (a few px per second at most) and the field is only shifted to the left
  const a = draw(new Sky(), 0, { mode: 'stars' }).rects.map((r) => r[0]);
  const s2 = new Sky();
  for (let t = 0; t <= 60000; t += 50) draw(s2, t, { mode: 'stars' });
  const b = draw(s2, 60050, { mode: 'stars' }).rects.map((r) => r[0]);
  let moved = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] - b[i] + 1920) % 1920;
    assert.ok(d < 200 || d > 1920 - 1, `star ${i} moved ${d}`);
    if (d > 20) moved++;
  }
  assert.ok(moved > a.length * 0.8);
});

test('comets: one at a time, 6 to 15 s apart, never with reduce motion or in stars mode', () => {
  const run = (o, seconds = 200) => {
    const sky = new Sky(5);
    const starts = [];
    let flying = false;
    let max = 0;
    for (let t = 0; t <= seconds * 1000; t += 16) {
      const c = draw(sky, t, o);
      const now = sky.comet.age >= 0;
      if (now && !flying) starts.push(t / 1000);
      flying = now;
      max = Math.max(max, c.strokes);
    }
    return { starts, max };
  };
  const on = run({ mode: 'comets' });
  assert.ok(on.starts.length >= 8, `comets seen ${on.starts.length}`);
  assert.ok(on.max <= 6, 'a tail is a few short segments');
  const sky = new Sky(5);
  let ends = [];
  let flying = false;
  let endedAt = 0;
  for (let t = 0; t <= 200000; t += 16) {
    draw(sky, t, { mode: 'comets' });
    const now = sky.comet.age >= 0;
    if (!now && flying) endedAt = t / 1000;
    if (now && !flying && endedAt) ends.push(t / 1000 - endedAt);
    flying = now;
  }
  assert.ok(ends.length >= 5);
  for (const gap of ends) assert.ok(gap >= COMET_GAP_S[0] - 0.1 && gap <= COMET_GAP_S[1] + 0.1, `gap ${gap}`);
  assert.equal(run({ mode: 'stars' }).starts.length, 0);
  assert.equal(run({ mode: 'comets', reduceMotion: true }).starts.length, 0);
});

test('comets are dimmer over the lyrics than outside them', () => {
  const sky = new Sky(5);
  const w = 1920;
  const h = 1080;
  const inside = [];
  const outside = [];
  const ctx = recorder();
  let at = [0, 0];
  ctx.moveTo = (x, y) => { at = [x, y]; };
  ctx.lineTo = (x, y) => {
    const mx = (at[0] + x) / 2 / w;
    const my = (at[1] + y) / 2 / h;
    const v = Number(/rgb\((\d+)/.exec(ctx.strokeStyle)[1]);
    const middle = mx > 0.12 && mx < 0.88 && my > 0.22 && my < 0.78;
    // only the first tail segment, which has the same strength wherever it is
    (middle ? inside : outside).push(v);
  };
  for (let t = 0; t < 120000; t += 16) sky.draw(ctx, w, h, 1, t, { mode: 'comets' });
  assert.ok(inside.length > 20 && outside.length > 20);
  assert.ok(Math.max(...inside) < Math.max(...outside) * 0.6, `inside ${Math.max(...inside)} outside ${Math.max(...outside)}`);
});

test('reduce motion: the stars stand still, but still twinkle very slowly', () => {
  const sky = new Sky();
  const a = draw(sky, 0, { mode: 'comets', reduceMotion: true }).rects;
  const b = draw(sky, 5000, { mode: 'comets', reduceMotion: true }).rects;
  assert.equal(a.length, STAR_COUNT);
  assert.deepEqual(a.map((r) => r[0]), b.map((r) => r[0]));
  assert.deepEqual(a.map((r) => r[1]), b.map((r) => r[1]));
  assert.ok(a.some((r, i) => r[4] !== b[i][4]), 'still twinkles');
});

test('a long pause does not make the sky jump', () => {
  const sky = new Sky();
  draw(sky, 0, { mode: 'stars' });
  const before = sky.t;
  draw(sky, 600000, { mode: 'stars' });
  assert.ok(sky.t - before <= 0.1 + 1e-9);
});

test('the same seed draws the same sky', () => {
  const a = draw(new Sky(9), 1000, { mode: 'stars' }).rects;
  const b = draw(new Sky(9), 1000, { mode: 'stars' }).rects;
  assert.deepEqual(a, b);
});
