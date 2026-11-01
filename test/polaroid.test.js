import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRE_MS, SETTLE_MS, PENDULUM_MS, TILT_MAX, STACK_DEPTH, CAMERA_MS, FLASH_MS, TRANS_MS,
  cardSize, pendulum, pop, develop, tiltOf, placeOf, arrival, cameraIntro, ageOf, slot, kenBurns, coverRect,
  isFlashLine, flashAlpha, seedInt, easeOutBack,
} from '../web/js/scenes/polaroid-motion.js';

test('card layout: border thicker at the bottom, the photo a square, everything inside the screen', () => {
  for (const [w, h] of [[1920, 1080], [2560, 1440], [700, 900], [320, 480]]) {
    const c = cardSize(w, h);
    assert.ok(c.strip > c.border, 'the writing strip is the thick edge');
    assert.ok(Math.abs(c.border * 2 + c.photo - c.cw) < 1e-9, 'photo is the card minus two borders');
    assert.ok(Math.abs(c.border + c.photo + c.strip - c.ch) < 1e-9);
    assert.ok(c.cw <= w * 0.7 + 1e-9 || c.cw === 160, `width fits at ${w}x${h}`);
    assert.ok(c.ch < h * 0.95 || c.cw === 160, `height fits at ${w}x${h}: ${c.ch} of ${h}`);
  }
});

test('the pendulum starts at its amplitude, swings both ways and has died away in 1.5 s', () => {
  assert.equal(pendulum(0, 0.07), 0.07);
  assert.equal(pendulum(-50), 0);
  let crossings = 0;
  let last = pendulum(1, 0.07);
  let peak = 0;
  for (let t = 2; t <= PENDULUM_MS; t += 2) {
    const v = pendulum(t, 0.07);
    if (Math.sign(v) !== Math.sign(last) && v !== 0) crossings++;
    peak = Math.max(peak, Math.abs(v));
    last = v;
  }
  assert.ok(crossings >= 2, `swings to both sides (${crossings} crossings)`);
  assert.ok(peak <= 0.07);
  assert.ok(Math.abs(pendulum(PENDULUM_MS, 0.07)) < 0.07 * 0.07, 'about 5% left at 1.5 s');
  // the envelope only shrinks: each later peak is lower
  const peaks = [];
  for (let t = 1; t < 3000; t++) {
    const a = Math.abs(pendulum(t - 1, 0.07));
    const b = Math.abs(pendulum(t, 0.07));
    const c = Math.abs(pendulum(t + 1, 0.07));
    if (b > a && b >= c && b > 1e-6) peaks.push(b);
  }
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] < peaks[i - 1]);
});

test('the pop goes 1.00, up to 1.03, back to 1.00 and is 1 before and after', () => {
  assert.equal(pop(-10), 1);
  assert.equal(pop(0), 1);
  assert.ok(Math.abs(pop(130) - 1.03) < 1e-9);
  assert.ok(Math.abs(pop(260) - 1) < 1e-9);
  assert.equal(pop(5000), 1);
  for (let t = 0; t < 400; t += 10) assert.ok(pop(t) >= 1 && pop(t) <= 1.03 + 1e-9);
});

test('development: dark and washed out at first, full colour after about 1.2 s', () => {
  assert.equal(develop(0), 0);
  assert.equal(develop(-100), 0);
  assert.ok(develop(600) > 0.5 && develop(600) < 1);
  assert.equal(develop(1200), 1);
  assert.equal(develop(9000), 1);
});

test('each card has its own tilt within 6 degrees and its own place; the same seed gives the same wall', () => {
  const seen = new Set();
  for (let li = 0; li < 60; li++) {
    const t = tiltOf(li, 5);
    assert.ok(Math.abs(t) <= TILT_MAX + 1e-12);
    seen.add(t.toFixed(5));
    const p = placeOf(li, 5);
    assert.ok(Math.abs(p.dx) <= 0.04 + 1e-12 && Math.abs(p.dy) <= 0.03 + 1e-12);
  }
  assert.ok(seen.size > 50, 'tilts differ');
  assert.equal(tiltOf(7, 5), tiltOf(7, 5));
  assert.notEqual(tiltOf(7, 5), tiltOf(7, 6));
  assert.equal(seedInt('track-1|2'), seedInt('track-1|2'));
});

test('a card has landed by the time its line starts when there is a gap, and is never far off when there is none', () => {
  const T = 10000;
  // plenty of gap: it flies in during the gap and is at rest (or just past it) when the line starts
  const a = arrival(T, T, 2000);
  assert.ok(Math.abs(a.k) < 0.12, `near rest at the start (${a.k})`);
  assert.equal(a.start, 1);
  assert.ok(arrival(T - PRE_MS, T, 2000).k > 0.99, 'off screen when the flight begins');
  // no gap: starts on screen a short hop away, never beyond half way out
  const b = arrival(T, T, 0);
  assert.equal(b.start, 0);
  assert.ok(b.k > 0.99, 'at the start of its short hop on the line start frame');
  // it overshoots a little, then settles exactly
  let min = 0;
  for (let t = T; t <= T + SETTLE_MS; t += 5) min = Math.min(min, arrival(t, T, 2000).k);
  assert.ok(min < 0 && min > -0.2, `a small overshoot (${min})`);
  assert.equal(arrival(T + 5000, T, 2000).k, 0);
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-12 && easeOutBack(0) === 0);
});

test('camera intro: out of the slot, then to its place, done as the first line starts', () => {
  const T0 = 3000;
  const s = cameraIntro(T0 - CAMERA_MS, T0);
  assert.equal(s.p, 0);
  assert.equal(s.eject, 0);
  assert.equal(s.glide, 0);
  const mid = cameraIntro(T0 - CAMERA_MS * 0.5, T0);
  assert.ok(mid.eject === 1 && mid.glide > 0 && mid.glide < 1 && mid.slot > 0);
  const end = cameraIntro(T0, T0);
  assert.equal(end.p, 1);
  assert.equal(end.glide, 1);
  assert.equal(end.slot, 0);
  assert.equal(cameraIntro(T0 + 9000, T0).p, 1);
  // a song that starts late in its intro (pos 0, first line at 400 ms) is already well on its way
  assert.ok(cameraIntro(0, 400).p > 0.7);
});

test('the stack: older cards are smaller, dimmer, move back one place per line and vanish after the third', () => {
  assert.equal(ageOf(5, 5, 0, false), 0);
  assert.equal(ageOf(5, 4, 0, false), 0, 'the previous card starts at the front when the line starts');
  assert.equal(ageOf(5, 4, TRANS_MS, false), 1, 'and is one place back after the move');
  assert.equal(ageOf(5, 4, 0, true), 1, 'reduce motion: straight to its place');
  let prev = slot(0, 1);
  for (let a = 0.5; a <= STACK_DEPTH; a += 0.5) {
    const s = slot(a, 1);
    assert.ok(s.scale < prev.scale && s.dim >= prev.dim && s.alpha === 1);
    prev = s;
  }
  assert.equal(slot(STACK_DEPTH + 1, 1).alpha, 0);
  assert.ok(slot(STACK_DEPTH + 0.5, -1).alpha > 0 && slot(STACK_DEPTH + 0.5, -1).alpha < 1);
  assert.ok(slot(2, 1).x > 0 && slot(2, -1).x < 0, 'peeks out to its own side');
  const front = slot(0, 1);
  assert.deepEqual([front.x, front.scale, front.dim], [0, 1, 0]);
});

test('Ken Burns: slow, different per line, and the crop always stays inside the cover', () => {
  const dirs = new Set();
  for (let li = 0; li < 20; li++) {
    for (const age of [0, 2000, 12000, 60000, 1e9]) {
      const k = kenBurns(li, 3, age);
      assert.ok(k.zoom >= 1.06 && k.zoom <= 1.16 + 1e-9);
      for (const [nw, nh] of [[640, 640], [640, 480], [300, 640]]) {
        const r = coverRect(nw, nh, k.zoom, k.panX, k.panY);
        assert.ok(r.sx >= 0 && r.sy >= 0 && r.sx + r.side <= nw + 1e-9 && r.sy + r.side <= nh + 1e-9, `${nw}x${nh} li ${li} age ${age}`);
      }
    }
    dirs.add(`${Math.sign(kenBurns(li, 3, 20000).panX)}${Math.sign(kenBurns(li, 3, 20000).panY)}`);
  }
  assert.ok(dirs.size >= 3, 'lines drift in different directions');
  const a = kenBurns(0, 3, 1000);
  const b = kenBurns(0, 3, 1016);
  assert.ok(Math.abs(b.zoom - a.zoom) < 5e-4 && Math.abs(b.panX - a.panX) < 3e-3, 'slow: no jumps between frames');
});

test('the flash: at most one line in four, over in 80 ms, never before landing', () => {
  for (const seed of [0, 1, 2, 3, 17]) {
    let flashes = 0;
    for (let li = 0; li < 40; li++) if (isFlashLine(li, seed)) flashes++;
    assert.ok(flashes <= 10 && flashes >= 9, `seed ${seed}: ${flashes} of 40`);
    for (let li = 0; li + 3 < 40; li++) {
      const n = [0, 1, 2, 3].filter((k) => isFlashLine(li + k, seed)).length;
      assert.ok(n <= 1, 'never twice within four lines');
    }
  }
  assert.equal(isFlashLine(0, 0), false);
  assert.equal(flashAlpha(-1), 0);
  assert.ok(flashAlpha(0) > 0.8);
  assert.equal(flashAlpha(FLASH_MS), 0);
  assert.equal(flashAlpha(5000), 0);
});

// The timing rule, checked on the drawing itself: on the very frame a word starts it is drawn, at full strength.
import { createPolaroid } from '../web/js/scenes/polaroid.js';

function recorder() {
  const texts = [];
  const t = { texts, globalAlpha: 1 };
  return new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'measureText') return (s) => ({ width: s.length * 10 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'fillText') return (s) => o.texts.push({ s, alpha: o.globalAlpha });
      if (k === 'save') return () => { (o.stack ??= []).push(o.globalAlpha); };
      if (k === 'restore') return () => { o.globalAlpha = (o.stack ?? []).pop() ?? 1; };
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

test('every word is drawn at full strength on its start frame, with and without a gap, in every motion mode', () => {
  const w = (text, start, end) => ({ text, start, end });
  const lines = [
    { time: 3000, end: 5000, words: [w('first', 3000, 3600), w('words', 3600, 5000)] },
    { time: 5000, end: 7000, words: [w('no', 5000, 5400), w('gap', 5400, 6000), w('here', 6000, 7000)] }, // starts the moment the last ended
    { time: 9000, end: 11000, words: [w('after', 9000, 9800), w('silence', 9800, 11000)] },
  ];
  for (const reduceMotion of [false, true]) {
    for (const [li, line] of lines.entries()) {
      for (const [wi, word] of line.words.entries()) {
        const ctx = recorder();
        const scene = createPolaroid();
        scene.init(null, ctx);
        scene.draw({
          ctx, w: 1280, h: 720, dpr: 1, pos: word.start, now: 0, lines, index: li, line, words: line.words,
          prevLine: lines[li - 1] ?? null, nextLine: lines[li + 1] ?? null,
          theme: { star: [244, 199, 107], core: [250, 230, 190], label: [235, 215, 170] }, palette: null,
          fontFamily: 'sans-serif', displayMode: 'window', mode: 'word', reduceMotion, seed: 's|1', film: true, art: null,
        });
        const hit = ctx.texts.find((t) => t.s === word.text);
        assert.ok(hit, `"${word.text}" (line ${li}, word ${wi}, reduceMotion ${reduceMotion}) is drawn on its start frame`);
        assert.ok(hit.alpha >= 0.999, `"${word.text}" at full strength (${hit.alpha})`);
      }
    }
  }
});
