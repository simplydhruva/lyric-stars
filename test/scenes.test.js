import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, SCENE_IDS, DISPLAY_MODES, DEFAULT_SCENE, sceneSettingKey, validScene, nextScene, randomScene, sceneName, createScene } from '../web/js/scenes/index.js';

test('every scene has the shared interface', () => {
  for (const entry of SCENES) {
    const scene = entry.create();
    assert.equal(scene.id, entry.id);
    assert.equal(typeof scene.name, 'string');
    for (const fn of ['init', 'draw', 'resize']) assert.equal(typeof scene[fn], 'function', `${entry.id}.${fn}`);
  }
});

test('scene ids are unique and every display mode has a valid default', () => {
  assert.equal(new Set(SCENE_IDS).size, SCENE_IDS.length);
  for (const m of DISPLAY_MODES) assert.ok(SCENE_IDS.includes(DEFAULT_SCENE[m]), m);
});

test('window and fullscreen default to the constellation; there is no overlay mode', () => {
  assert.deepEqual(DISPLAY_MODES, ['window', 'fullscreen']);
  assert.equal(DEFAULT_SCENE.window, 'constellation');
  assert.equal(DEFAULT_SCENE.fullscreen, 'constellation');
});

test('each display mode has its own settings key', () => {
  assert.deepEqual(DISPLAY_MODES.map(sceneSettingKey), ['sceneWindow', 'sceneFullscreen']);
});

test('validScene keeps known ids and falls back to the mode default', () => {
  assert.equal(validScene('karaoke', 'window'), 'karaoke');
  assert.equal(validScene('gone', 'overlay'), 'constellation');
  assert.equal(validScene(undefined, 'window'), 'constellation');
  assert.equal(validScene(null, 'fullscreen'), 'constellation');
});

test('nextScene cycles through every scene and wraps', () => {
  let id = SCENE_IDS[0];
  const seen = [];
  for (let i = 0; i < SCENE_IDS.length; i++) {
    seen.push(id);
    id = nextScene(id);
  }
  assert.deepEqual(seen, SCENE_IDS);
  assert.equal(id, SCENE_IDS[0]);
  assert.equal(nextScene('unknown'), SCENE_IDS[0]);
});

test('randomScene never repeats the current scene', () => {
  for (const current of SCENE_IDS) {
    for (const r of [0, 0.3, 0.5, 0.99, 1]) assert.notEqual(randomScene(current, () => r), current);
  }
});

test('randomScene can reach every other scene', () => {
  const reached = new Set();
  for (let i = 0; i < 20; i++) reached.add(randomScene('constellation', () => i / 20));
  assert.deepEqual([...reached].sort(), SCENE_IDS.filter((id) => id !== 'constellation').sort());
});

test('sceneName and createScene handle unknown ids', () => {
  assert.equal(sceneName('karaoke'), 'Karaoke');
  assert.equal(sceneName('nope'), 'nope');
  assert.equal(createScene('nope').id, SCENE_IDS[0]);
});

// A fake 2D context that records what was drawn, so scenes can be run without a browser.
function fakeCtx() {
  const calls = [];
  return new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (text) => ({ width: text.length * 10 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => calls.push([k, ...args]);
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

// Scenes build a glow sprite from a canvas; give them a minimal document.
globalThis.document ??= { createElement: () => ({ getContext: () => fakeCtx() }) };

function frameOf(ctx, over = {}) {
  const word = (text, start, end) => ({ text, start, end });
  const lines = [
    { time: 1000, end: 3000, words: [word('look', 1000, 1500), word('up', 1500, 2500)] },
    { time: 4000, end: 6000, words: [word('stars', 4000, 5000), word('tonight', 5000, 6000)] },
    { time: 8000, end: 8000, words: [] },
  ];
  return {
    ctx, w: 800, h: 600, dpr: 1, pos: 4500, now: 0, lines, index: 1,
    line: lines[1], words: lines[1].words, prevLine: lines[0], nextLine: lines[2],
    theme: { star: [244, 199, 107], core: [250, 230, 190], label: [235, 215, 170] }, palette: null,
    fontFamily: 'sans-serif', displayMode: 'window', mode: 'word', reduceMotion: false, playing: true, quiet: false,
    seed: 'x|1', spread: 100, chaos: 50, ...over,
  };
}

for (const entry of SCENES) {
  test(`${entry.id}: draws a normal frame`, () => {
    const ctx = fakeCtx();
    const scene = entry.create();
    scene.init(null, ctx);
    scene.draw(frameOf(ctx));
    assert.ok(ctx.calls.length > 0);
  });

  test(`${entry.id}: survives before the first line, an empty line and the last line`, () => {
    const ctx = fakeCtx();
    const scene = entry.create();
    scene.init(null, ctx);
    const base = frameOf(ctx);
    scene.draw({ ...base, pos: 100, index: -1, line: null, words: [], prevLine: null, nextLine: base.lines[0] });
    scene.draw({ ...base, pos: 8500, index: 2, line: base.lines[2], words: [], prevLine: base.lines[1], nextLine: null });
    scene.draw({ ...base, pos: 1200, index: 0, line: base.lines[0], words: base.lines[0].words, prevLine: null, nextLine: base.lines[1] });
  });

  test(`${entry.id}: survives reduce motion, line mode and resize`, () => {
    const ctx = fakeCtx();
    const scene = entry.create();
    scene.init(null, ctx);
    scene.draw(frameOf(ctx, { reduceMotion: true, mode: 'line' }));
    scene.resize();
    scene.draw(frameOf(ctx, { w: 300, h: 500 }));
  });

  test(`${entry.id}: the same position draws the same thing, whatever the wall clock says`, () => {
    const a = fakeCtx();
    const b = fakeCtx();
    const sa = entry.create();
    const sb = entry.create();
    sa.init(null, a);
    sb.init(null, b);
    sa.draw(frameOf(a, { now: 1 }));
    sb.draw(frameOf(b, { now: 999999 }));
    const plain = (calls) => calls.map((c) => c.map((x) => (typeof x === 'object' ? '[object]' : x)));
    assert.deepEqual(plain(a.calls), plain(b.calls));
  });
}

test('constellation draws nothing before the first line', () => {
  const ctx = fakeCtx();
  const scene = SCENES[0].create();
  scene.init(null, ctx);
  scene.draw({ ...frameOf(ctx), index: -1, line: null, words: [], pos: 10 });
  assert.equal(ctx.calls.length, 0);
});

test('karaoke fills only the words sung so far; reduce motion lights each word at its start', () => {
  const clips = (over) => {
    const ctx = fakeCtx();
    const scene = SCENES.find((s) => s.id === 'karaoke').create();
    scene.init(null, ctx);
    scene.draw(frameOf(ctx, over));
    return ctx.calls.filter((c) => c[0] === 'rect').map((c) => c[3]); // clip widths of filled words
  };
  assert.deepEqual(clips({ pos: 4000, reduceMotion: true }), []); // nothing sung yet (no slide, so no outgoing line either)
  const half = clips({ pos: 4500 }); // "stars" is half sung: 5 characters at the fake 10 px each
  assert.equal(half.length, 1);
  assert.ok(Math.abs(half[0] - 25) < 1e-6, `clip ${half[0]}`);
  assert.equal(clips({ pos: 5600, reduceMotion: true }).length, 2); // both words lit once started
  assert.equal(clips({ pos: 4500, reduceMotion: true }).length, 1); // "stars" lit, "tonight" not yet
});
