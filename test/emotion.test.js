import test from 'node:test';
import assert from 'node:assert/strict';
import { emotionOf, emotionLook, drawEmotion, EMOTION_COLORS } from '../web/js/scenes/emotion.js';
import { createScene } from '../web/js/scenes/index.js';

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
globalThis.document ??= { createElement: () => ({ getContext: () => fakeCtx() }) };

test('emotionOf finds the words, ignores punctuation, case and plurals in the list, and skips the rest', () => {
  assert.equal(emotionOf('Fire,'), 'fire');
  assert.equal(emotionOf('LOVE'), 'love');
  assert.equal(emotionOf('"night"'), 'night');
  assert.equal(emotionOf('tears'), 'water');
  assert.equal(emotionOf('sunshine'), 'sun');
  assert.equal(emotionOf("heart's"), 'love');
  assert.equal(emotionOf('table'), null);
  assert.equal(emotionOf('...'), null);
  assert.equal(emotionOf('amour'), null); // other languages get nothing
});

test('every kind has a colour, and the glow is on from the very first instant', () => {
  for (const kind of Object.keys(EMOTION_COLORS)) {
    for (const since of [0, 1, 37, 500, 4000]) {
      for (const still of [false, true]) {
        const l = emotionLook(kind, since, 5, still);
        assert.ok(l.a > 0.3 && l.a <= 1, `${kind} ${since} a=${l.a}`);
        assert.ok(l.blur > 0.5, kind);
      }
    }
    assert.equal(emotionLook(kind, 123, 9, false).a, emotionLook(kind, 123, 9, false).a);
  }
});

test('reduce motion holds every glow still', () => {
  for (const kind of Object.keys(EMOTION_COLORS)) {
    assert.deepEqual(emotionLook(kind, 0, 4, true), emotionLook(kind, 3333, 4, true));
  }
});

test('drawEmotion paints only emotion words, only when on, and only from the word start', () => {
  const run = (text, over = {}, since = 100) => {
    const ctx = fakeCtx();
    let painted = 0;
    drawEmotion(ctx, { emotion: true, reduceMotion: false, quiet: false, ...over }, text, since, 1, 30, 1, () => painted++);
    return painted;
  };
  assert.equal(run('fire'), 1);
  assert.equal(run('table'), 0);
  assert.equal(run('fire', { emotion: false }), 0);
  assert.equal(run('fire', {}, -1), 0);
});

// the six scenes that show emotion glow draw more when a line has an emotion word; the others never change
const WITH = ['constellation', 'karaoke', 'kinetic', 'stack', 'neon', 'lanterns'];
test('emotion glow is wired into exactly the six chosen scenes', () => {
  const word = (text, start, end) => ({ text, start, end });
  const lines = [{ time: 1000, end: 3000, words: [word('love', 1000, 1500), word('burning', 1500, 2500)] }];
  const count = (id, emotion) => {
    const ctx = fakeCtx();
    const scene = createScene(id);
    scene.init(null, ctx);
    scene.draw({
      ctx, w: 800, h: 600, dpr: 1, pos: 2000, now: 0, lines, index: 0, line: lines[0], words: lines[0].words, prevLine: null, nextLine: null,
      theme: { star: [244, 199, 107], core: [250, 230, 190], label: [235, 215, 170], accents: [[244, 199, 107]] }, palette: null,
      fontFamily: 'sans-serif', displayMode: 'window', mode: 'word', reduceMotion: false, playing: true, quiet: false,
      seed: 'x|1', spread: 100, chaos: 50, emotion,
    });
    return ctx.calls.length;
  };
  for (const id of ['constellation', 'karaoke', 'kinetic', 'stack', 'neon', 'lanterns', 'rain', 'orbit', 'paper']) {
    const on = count(id, true);
    const off = count(id, false);
    if (WITH.includes(id)) assert.ok(on > off, `${id} should draw a glow`);
    else assert.equal(on, off, `${id} should not change`);
  }
});
