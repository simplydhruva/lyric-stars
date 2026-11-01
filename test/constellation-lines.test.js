// Constellation rules: a link only ever joins two stars of the SAME line, and a line's stars, links and labels
// are gone for good once its fade-out has finished (only the song-map ending may show old lines again).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConstellation } from '../web/js/scenes/constellation.js';
import { buildTimeline } from '../web/js/timing.js';
import { makeTheme, THEMES } from '../web/js/theme.js';
import { lineIndexAt } from '../web/js/lyrics/lrc.js';

// A canvas that records what the scene draws.
function recorder() {
  const rec = { segments: [], dots: [], texts: [], images: 0 };
  let pen = null;
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(_, name) {
      switch (name) {
        case 'moveTo': return (x, y) => { pen = [x, y]; };
        case 'lineTo': return (x, y) => { if (pen) rec.segments.push({ a: pen, b: [x, y] }); };
        case 'arc': return (x, y) => rec.dots.push([x, y]);
        case 'fillText': return (t, x, y) => rec.texts.push({ t, x, y });
        case 'drawImage': return () => { rec.images++; };
        case 'measureText': return (t) => ({ width: String(t).length * 8 });
        case 'createRadialGradient': return () => ({ addColorStop: noop });
        default: return noop;
      }
    },
    set() { return true; },
  });
  return { ctx, rec, reset() { rec.segments = []; rec.dots = []; rec.texts = []; rec.images = 0; pen = null; } };
}

globalThis.document ??= { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true }), width: 0, height: 0 }) };

const TEXTS = [
  'Hold me in the light tonight', 'Stars are falling slow and bright', 'Sing it back to me again',
  'We walked through the endless city lights', 'Hold me in the light tonight', 'And everything you do was gold',
];
const lines = buildTimeline(TEXTS.map((text, i) => ({ time: 2000 + i * 4000, text })), { trackDurationMs: 40000 });

function run(overrides = {}) {
  const r = recorder();
  const scene = createConstellation();
  scene.init(null, r.ctx);
  const theme = makeTheme(THEMES.gold.base);
  const base = { ctx: r.ctx, w: 1280, h: 720, dpr: 1, lines, theme, fontFamily: 'sans-serif', mode: 'word', reduceMotion: false, quiet: false, seed: 'x|1', spread: 100, chaos: 100, previewNext: true, songMap: false, emotion: false, glow: 0.25, beat: 0, ...overrides };
  return { scene, r, frameAt: (pos) => ({ ...base, pos, index: lineIndexAt(lines, pos) }) };
}

const near = (p, q) => Math.hypot(p[0] - q.x, p[1] - q.y) < 0.01;
// Is point b on the straight way from a to star s (a link that is still drawing itself)?
const onWay = (a, b, s) => {
  const dx = s.x - a[0];
  const dy = s.y - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const t = ((b[0] - a[0]) * dx + (b[1] - a[1]) * dy) / (len * len);
  return t >= -1e-6 && t <= 1 + 1e-6 && Math.hypot(a[0] + dx * t - b[0], a[1] + dy * t - b[1]) < 0.01;
};

test('every link joins two stars of one line, never a star of line 1 to a star of line 3', () => {
  const { scene, r, frameAt } = run();
  for (let pos = 0; pos < 24000; pos += 40) {
    r.reset();
    const f = frameAt(pos);
    scene.draw(f);
    if (f.index < 0) continue;
    const allowed = [f.index, f.index - 1].filter((i) => i >= 0).map((i) => scene.layoutFor(f, i).stars);
    for (const { a, b } of r.rec.segments) {
      const ok = allowed.some((stars) => stars.some((s) => near(a, s)) && stars.some((s) => onWay(a, b, s)));
      assert.ok(ok, `at ${pos} ms a link runs between stars that are not of one visible line`);
    }
  }
});

test('a line leaves nothing behind once its fade-out is over', () => {
  const { scene, r, frameAt } = run({ previewNext: false });
  for (let pos = 0; pos < 24000; pos += 40) {
    r.reset();
    const f = frameAt(pos);
    scene.draw(f);
    if (f.index < 0) continue;
    const since = pos - lines[f.index].time;
    // Only the current line may be drawn once 700 ms have passed since it began (the previous line is gone).
    const shown = [f.index, ...(since < 700 ? [f.index - 1] : [])].filter((i) => i >= 0).flatMap((i) => scene.layoutFor(f, i).stars);
    const others = [];
    for (let i = 0; i < lines.length; i++) if (i !== f.index && !(i === f.index - 1 && since < 700)) others.push(...scene.layoutFor(f, i).stars.filter((s) => !shown.some((o) => near([s.x, s.y], o))));
    for (const t of r.rec.texts) assert.ok(!others.some((s) => Math.abs(s.x - t.x) < 0.01), `at ${pos} ms the word "${t.t}" belongs to an old line`);
    for (const d of r.rec.dots) assert.ok(!others.some((s) => near(d, s)), `at ${pos} ms a dot of an old line is still drawn`);
  }
});

test('the dots of the next line only show before it starts, and none are drawn before the first line', () => {
  const { scene, r, frameAt } = run();
  r.reset();
  scene.draw(frameAt(0));
  assert.ok(r.rec.dots.length <= lines[0].words.length);
  r.reset();
  scene.draw(frameAt(lines[3].time + 3000)); // line 4 is long over its fade; line 5 preview is allowed, nothing from lines 1-3
  const f = frameAt(lines[3].time + 3000);
  const old = [0, 1, 2].flatMap((i) => scene.layoutFor(f, i).stars);
  const own = [3, 4].flatMap((i) => scene.layoutFor(f, i).stars);
  for (const d of r.rec.dots) assert.ok(own.some((s) => near(d, s)) || !old.some((s) => near(d, s)), 'an old line\'s dot is back');
});

test('no two lines share a star position, so a repeated line never brings an old line\'s dots back', () => {
  const { scene, frameAt } = run();
  const f = frameAt(0);
  const seen = new Map();
  lines.forEach((l, i) => {
    for (const s of scene.layoutFor(f, i).stars) {
      const key = `${s.x.toFixed(2)},${s.y.toFixed(2)}`;
      assert.ok(!seen.has(key), `line ${i + 1} sits on a star of line ${seen.get(key) + 1}`);
      seen.set(key, i);
    }
  });
});
