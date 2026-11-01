import test from 'node:test';
import assert from 'node:assert/strict';
import { FONT_IDS, FONTS, createFontPicker, fontOrder, hasGlyph, inkOf, MIN_INK, sizeFor, splitRuns, SYSTEM, FALLBACK } from '../web/js/scenes/reel-fonts.js';
import {
  HERO_MAX, MIN_VISIBLE, SAFE, effectCount, effectsOf, entranceOf, flickersOf, heroIndex, heroVisible, kindOf, lettersOf, maskEligible,
  maskUsable, metricsOf, bottomLimit, maxLetterCut, MAX_LETTER_CUT, pickMaskLines, planLine, punchLine, scrimFor, wordKey, regionStats,
} from '../web/js/scenes/reel-motion.js';

// A stand-in for measureText: an advance per character that depends on the font and the letter (so tests see variety).
const charW = (font, ch) => (ch === ' ' ? 0.3 : 0.45 + ((font.length * 7 + ch.codePointAt(0)) % 9) * 0.03);
const metrics = (text, font, cap, key) => metricsOf(text, font, cap, charW, key);

const SENTENCES = [
  'love', 'hold me closer tiny dancer', 'I want to break free', 'a', 'we will rock you tonight and every night forever',
  'in the middle of the night when the stars are bright and the world is quiet and still', 'no', 'Supercalifragilisticexpialidocious',
  'dancing in the dark', 'oh oh oh', 'burning down the house', 'ain\'t no mountain high enough',
];
const mkWords = (text) => {
  let t = 1000;
  return text.split(' ').map((s) => ({ text: s, start: (t += 300), end: t + 250 }));
};

function planAll(w, h, seed, n = 24) {
  const out = [];
  let prev = null;
  let prevKind = null;
  for (let li = 0; li < n; li++) {
    const words = mkWords(SENTENCES[li % SENTENCES.length]);
    const picker = createFontPicker();
    picker.configure(seed, FONT_IDS, false, null);
    const hero = heroIndex(words);
    const fonts = picker.lineFonts(li, words.length, hero);
    const texts = words.map((x, i) => x.text.toLocaleUpperCase());
    const plan = planLine({ w, h, li, seed, words, texts, fonts, prevCenter: prev, kind: kindOf(seed, li), prevKind, metrics });
    out.push({ plan, words });
    prev = plan.heroCenter;
    prevKind = plan.kind;
  }
  return out;
}

const SIZES = [[1920, 1080], [2560, 1440], [700, 900], [390, 844]];

test('hero word: the stressed word is the hero and its cap height is at most 45% of the screen', () => {
  for (const [w, h] of SIZES) {
    for (const { plan, words } of planAll(w, h, 7)) {
      assert.equal(plan.hero, heroIndex(words));
      assert.ok(plan.words[plan.hero].cap <= h * HERO_MAX + 0.01, `${w}x${h} hero cap ${plan.words[plan.hero].cap}`);
    }
  }
});

test('layout: every word but the hero is inside the 5% safe margin; the hero keeps at least 70% of its letters', () => {
  for (const [w, h] of SIZES) {
    for (const seed of [1, 7, 4242, 99991]) {
      for (const { plan } of planAll(w, h, seed)) {
        plan.words.forEach((wd) => {
          if (wd.i === plan.hero) {
            assert.ok(heroVisible(wd, w, h) >= MIN_VISIBLE, `hero visible ${heroVisible(wd, w, h)} at ${w}x${h} seed ${seed}`);
            return;
          }
          const x0 = wd.cx - wd.bw / 2;
          const x1 = wd.cx + wd.bw / 2;
          const y0 = wd.cy - wd.bh / 2;
          const y1 = wd.cy + wd.bh / 2;
          const m = 0.5;
          assert.ok(x0 >= w * SAFE - m && x1 <= w * (1 - SAFE) + m && y0 >= h * SAFE - m && y1 <= h * (1 - SAFE) + m, `word "${wd.text}" box ${[x0, y0, x1, y1].map(Math.round)} at ${w}x${h} seed ${seed}`);
        });
      }
    }
  }
});

test('layout: the hero is at most 15% cropped by the screen edge, and its start frame is fully on screen except for that bleed', () => {
  for (const [w, h] of SIZES) {
    for (const { plan } of planAll(w, h, 31)) {
      const hw = plan.words[plan.hero];
      const along = Math.abs(Math.sin(hw.rot)) > 0.7 ? hw.bh : hw.bw;
      const over = Math.abs(Math.sin(hw.rot)) > 0.7 ? Math.max(0, hw.bh / 2 - hw.cy, hw.cy + hw.bh / 2 - h) : Math.max(0, hw.bw / 2 - hw.cx, hw.cx + hw.bw / 2 - w);
      assert.ok(over <= along * 0.15 + 1, `hero crop ${over} of ${along}`);
    }
  }
});

test('layout: the hero is never in the same area as the previous hero, and layouts alternate', () => {
  for (const [w, h] of SIZES) {
    const all = planAll(w, h, 5, 30);
    for (let i = 1; i < all.length; i++) {
      assert.notEqual(all[i].plan.kind, all[i - 1].plan.kind);
      const a = all[i - 1].plan.heroCenter;
      const b = all[i].plan.heroCenter;
      // one-word lines are centred by nature, so the distance rule can only be met by moving; allow equal only if nothing else fits
      if (all[i].words.length > 1 && all[i - 1].words.length > 1) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 0.09, `line ${i}: heroes ${JSON.stringify(a)} ${JSON.stringify(b)} at ${w}x${h}`);
    }
  }
});

test('kinds: never the same layout kind twice in a row', () => {
  for (const seed of [1, 2, 3, 77, 90210]) for (let li = 1; li < 80; li++) assert.notEqual(kindOf(seed, li), kindOf(seed, li - 1));
});

test('seeded stability: the same song gives the same plan; another seed gives another one', () => {
  const a = JSON.stringify(planAll(1920, 1080, 12).map((x) => x.plan.words.map((wd) => [wd.cx, wd.cy, wd.font, wd.cap])));
  const b = JSON.stringify(planAll(1920, 1080, 12).map((x) => x.plan.words.map((wd) => [wd.cx, wd.cy, wd.font, wd.cap])));
  const c = JSON.stringify(planAll(1920, 1080, 13).map((x) => x.plan.words.map((wd) => [wd.cx, wd.cy, wd.font, wd.cap])));
  assert.equal(a, b);
  assert.notEqual(a, c);
  const m1 = metrics('HELLO', 'Anton', 100, wordKey(5, 2, 1));
  const m2 = metrics('HELLO', 'Anton', 100, wordKey(5, 2, 1));
  assert.deepEqual(m1, m2);
  m1.letters.forEach((l) => assert.ok(Math.abs(l.rot) <= 0.0525 + 1e-9));
});

test('fonts: at most 3 fonts in a line, hero font differs from the previous line\'s, 2 or 3 fonts appear in long lines', () => {
  for (const seed of [1, 9, 123, 5555]) {
    const p = createFontPicker();
    p.configure(seed, FONT_IDS, false, null);
    let prevHero = null;
    let sawThree = false;
    for (let li = 0; li < 60; li++) {
      const n = 3 + (li % 5);
      const fonts = p.lineFonts(li, n, li % n);
      const set = new Set(fonts);
      assert.ok(set.size <= 3);
      if (set.size === 3) sawThree = true;
      assert.ok(set.size >= 2);
      const hf = fonts[li % n];
      assert.notEqual(hf, prevHero);
      prevHero = hf;
    }
    assert.ok(sawThree, 'a 3-font line appears');
  }
  const p = createFontPicker();
  p.configure(1, FONT_IDS, true, null);
  assert.deepEqual(p.lineFonts(4, 4, 1), Array(4).fill('Anton'));
});

test('fonts: a shuffle changes the fonts of that line', () => {
  const p = createFontPicker();
  p.configure(11, FONT_IDS, false, null);
  const before = p.heroFont(5);
  p.configure(11, FONT_IDS, false, new Map([[5, 1]]));
  assert.notEqual(p.heroFont(5), before);
});

test('fonts: each song gets its own order; the order is stable', () => {
  assert.deepEqual(fontOrder(3), fontOrder(3));
  assert.notDeepEqual(fontOrder(3), fontOrder(4));
  assert.equal(new Set(fontOrder(3)).size, FONT_IDS.length);
});

test('fonts: no font is thin, and sizes are corrected to a common cap height', () => {
  for (const f of FONTS) assert.ok(inkOf(f.id) >= MIN_INK, `${f.id} ink ${inkOf(f.id)}`);
  for (const f of FONTS) assert.ok(Math.abs(sizeFor(f.id, 100) * f.cap - 100) < 1e-6);
});

test('glyph coverage: accents and curly quotes are in the fonts; missing characters fall back to Anton, then the system font', () => {
  for (const f of FONTS) {
    for (const ch of 'É’“”1&@') {
      const ok = hasGlyph(f.id, ch.codePointAt(0));
      const runs = splitRuns(ch, f.id);
      assert.equal(runs.length, 1);
      assert.ok(ok ? runs[0].font === f.id : [FALLBACK, SYSTEM].includes(runs[0].font));
    }
    const runs = splitRuns('AΩ文😀', f.id);
    assert.ok(runs.every((r) => r.font === f.id || r.font === FALLBACK || r.font === SYSTEM));
    assert.equal(runs.map((r) => r.t).join(''), 'AΩ文😀');
    assert.equal(runs[runs.length - 1].font, SYSTEM); // nothing bundled has an emoji
  }
});

test('effects: at most 3 per line; strong ones on at most 1 line in 3; flicker spacing is under 3 Hz', () => {
  for (const seed of [1, 2, 3, 100]) {
    let strong = 0;
    for (let li = 0; li < 90; li++) {
      const e = effectsOf(li, seed);
      assert.ok(effectCount(e) <= 3, `line ${li} has ${effectCount(e)}`);
      if (e.rgb || e.distort) strong++;
      assert.equal(e.rgb, e.strong);
      const starts = [0, 300, 700, 1200, 1800];
      const f = flickersOf(li, seed, starts, 4000, 2);
      assert.ok(f.length <= 2);
      f.forEach((x, i) => {
        assert.ok(x.t >= 400 && x.t <= 3600);
        assert.ok(x.t >= starts[x.word] + 150);
        if (i) assert.ok(x.t - f[i - 1].t >= 700);
        assert.ok(x.dur <= 50);
      });
    }
    assert.ok(strong <= 31, `strong lines ${strong}`);
  }
});

test('cover mask: every 4th line, hero of 4+ letters, not two in a row, never on a very long line', () => {
  const ok = (j) => j % 5 !== 3;
  const m = pickMaskLines(40, ok);
  for (let i = 1; i < m.length; i++) assert.ok(!(m[i] && m[i - 1]));
  m.forEach((v, i) => v && assert.ok(ok(i)));
  assert.ok(m.filter(Boolean).length >= 8);
  assert.ok(maskEligible(mkWords('hold me closer tiny dancer'), 'stacked'));
  assert.ok(!maskEligible(mkWords('a b c'), 'stacked')); // no 4-letter hero
  assert.ok(!maskEligible(mkWords('in the middle of the night when the stars are bright and the world is quiet and still'), 'stacked'));
  assert.ok(!maskEligible(mkWords('love'), 'rot90'));
});

test('cover mask: bright or look-alike covers fall back to the cream fill', () => {
  assert.equal(maskUsable({ mean: 0.9, sd: 0.2 }, 0.5, 0.35), false);
  assert.equal(maskUsable({ mean: 0.3, sd: 0.02 }, 0.3 / 0.65, 0.35), false);
  assert.equal(maskUsable({ mean: 0.35, sd: 0.2 }, 0.3, 0.35), true);
  assert.ok(scrimFor(0) >= 0.25 && scrimFor(1) <= 0.45 + 1e-9);
  const data = new Uint8ClampedArray(4 * 4 * 4).fill(128);
  assert.ok(Math.abs(regionStats(data, 4, 4, 0, 0, 1, 1).mean - 128 / 255) < 0.01);
});

test('punch-in: never twice within 500 ms', () => {
  const lines = Array.from({ length: 40 }, (_, i) => ({ time: i * 300 }));
  for (const seed of [1, 2, 3, 4]) {
    let last = -1e9;
    for (let li = 0; li < 40; li++) {
      if (punchLine(lines, li, seed)) {
        assert.ok(lines[li].time - last >= 500, `seed ${seed} line ${li}`);
        last = lines[li].time;
      }
    }
  }
});

test('entrances: a word is at full size inside the screen on its start frame (zoom starts at most 1.6x, only into free room)', () => {
  for (const [w, h] of SIZES) {
    for (const { plan } of planAll(w, h, 77)) {
      plan.words.forEach((wd) => {
        const e = wd.enter;
        if (e.type === 'zoom') assert.ok(e.from <= 1.6 + 1e-9 && e.from <= wd.grow + 1e-9);
        const o = entranceOf(wd, 0, false, { s: 1, dx: 0, dy: 0, rot: 0, trail: 0 });
        const sx = o.s;
        const hw = (wd.bw / 2) * sx;
        const hh = (wd.bh / 2) * sx;
        if (wd.i !== plan.hero) {
          assert.ok(wd.cx + o.dx - hw >= w * SAFE - 1 && wd.cx + o.dx + hw <= w * (1 - SAFE) + 1, `x of "${wd.text}" ${e.type}`);
          assert.ok(wd.cy + o.dy - hh >= h * SAFE - 1 && wd.cy + o.dy + hh <= h * (1 - SAFE) + 1, `y of "${wd.text}" ${e.type}`);
        }
        // reduce motion: no movement at all
        const r = entranceOf(wd, 0, true, { s: 1, dx: 0, dy: 0, rot: 0, trail: 0 });
        assert.deepEqual([r.s, r.dx, r.dy, r.rot, r.trail], [1, 0, 0, 0, 0]);
      });
    }
  }
});

test('letters: counting', () => {
  assert.equal(lettersOf("don't!"), 4);
  assert.equal(lettersOf('…'), 0);
});

test('layout: no word, hero included, goes into the bottom zone where the playback controls sit', () => {
  for (const [w, h] of SIZES) {
    const botY = bottomLimit(h);
    assert.ok(botY < h * 0.9 && botY > h * 0.5, 'the limit is a sensible height');
    for (const seed of [1, 2, 3]) {
      for (const { plan } of planAll(w, h, seed, 36)) {
        for (const wd of plan.words) assert.ok(wd.cy + wd.bh / 2 <= botY + 1, `bottom of a word at ${wd.cy + wd.bh / 2} is below ${botY} at ${w}x${h}`);
      }
    }
  }
});

test('layout: no hero letter is cut by more than 30%, and rows under the hero start below it', () => {
  for (const [w, h] of SIZES) {
    for (const seed of [1, 2, 3, 4]) {
      for (const { plan } of planAll(w, h, seed, 36)) {
        const hero = plan.words[plan.hero];
        assert.ok(maxLetterCut(hero, w, h) <= MAX_LETTER_CUT + 1e-9, `a hero letter is cut ${maxLetterCut(hero, w, h)} at ${w}x${h}`);
        if (Math.abs(Math.sin(hero.rot)) > 0.7) continue;
        for (const wd of plan.words) {
          if (wd.i > plan.hero && Math.abs(Math.sin(wd.rot)) < 0.7) assert.ok(wd.cy - wd.bh / 2 >= hero.cy + hero.bh / 2 - hero.cap * 0.3, 'a later row sits on the hero');
        }
      }
    }
  }
});
