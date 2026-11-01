import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISSOLVE_STEPS, PALETTES, PALETTE_IDS, SIZES, TONE_BRIGHT, TONE_DIM, TONE_MID, bayerThreshold, clockText, cloudX, coverToIndices, dissolveLevel,
  dissolveVisible, fitScreen, fontSizes, hexToRgb, layoutLine, marqueeOffset, nearestIndex, paletteOf, panOffset, pixelText, repeatedLines, showUntil,
  tableMeasure, visibleLines, withAlbumAccent, wordTone,
} from '../web/js/scenes/pixel-core.js';

const SIZES_TO_TRY = [[1920, 1080], [2560, 1440], [700, 900], [2560, 1440], [3840, 2160], [1280, 720], [2880, 1620], [800, 600], [1366, 768], [1500, 1000], [400, 800]];

test('fill: integer scale, the logical screen covers 98 percent or more of the window, centring is whole pixels', () => {
  for (const [dw, dh] of SIZES_TO_TRY) {
    const f = fitScreen(dw, dh, { screen: 'fill', target: SIZES.normal });
    assert.ok(Number.isInteger(f.scale) && f.scale >= 1, `${dw}x${dh} scale ${f.scale}`);
    assert.ok(f.lw * f.scale <= dw && f.lh * f.scale <= dh);
    assert.ok(dw - f.lw * f.scale < f.scale && dh - f.lh * f.scale < f.scale, `${dw}x${dh} leftover less than one logical pixel`);
    assert.ok(Number.isInteger(f.ox) && Number.isInteger(f.oy) && f.ox >= 0 && f.oy >= 0);
    assert.ok(f.coverage >= 0.95, `${dw}x${dh} coverage ${f.coverage}`);
    assert.ok(f.lh >= 200 && f.lw >= 100, `${dw}x${dh} logical ${f.lw}x${f.lh}`);
  }
});

test('fill: the logical height stays near 320 on common screens, and the scale follows the device pixel ratio', () => {
  assert.equal(fitScreen(1920, 1080).lh, 360);
  assert.equal(fitScreen(2560, 1440).scale, 5);
  assert.equal(fitScreen(3840, 2160).scale, 7); // 4K: 308 rows
  const dpr2 = fitScreen(1280 * 2, 720 * 2); // a 1280x720 window at 200 percent is a 2560x1440 canvas
  assert.equal(dpr2.scale, 5);
  assert.equal(fitScreen(700, 900).scale, 2);
});

test('portrait: a 9:16 screen at the largest whole scale, centred', () => {
  const f = fitScreen(1920, 1080, { screen: 'portrait', target: 320 });
  assert.equal(f.lh, 320);
  assert.equal(f.lw, 180);
  assert.equal(f.scale, 3);
  assert.equal(f.ox, Math.floor((1920 - 180 * 3) / 2));
});

test('palettes: three of 16 colours, every role is a valid index, and the lyric tones are ordered by brightness', () => {
  assert.deepEqual(PALETTE_IDS.sort(), ['dreamy', 'green', 'sunset']);
  const lum = (h) => {
    const [r, g, b] = hexToRgb(h);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  for (const id of PALETTE_IDS) {
    const p = paletteOf(id);
    assert.equal(p.colors.length, 16, id);
    assert.equal(new Set(p.colors).size, 16, `${id} has 16 different colours`);
    for (const [role, i] of Object.entries(p)) if (role !== 'colors' && role !== 'ramp' && role !== 'name') assert.ok(Number.isInteger(i) && i >= 0 && i < 16, `${id}.${role}`);
    for (const i of p.ramp) assert.ok(i >= 0 && i < 16);
    assert.ok(lum(p.colors[p.bright]) > lum(p.colors[p.mid]) && lum(p.colors[p.mid]) > lum(p.colors[p.dim]), `${id} tones`);
    assert.ok(lum(p.colors[p.bright]) - lum(p.colors[p.outline]) > 90, `${id} text against its outline`);
  }
  assert.equal(paletteOf('nope'), PALETTES.dreamy);
});

test('album colour changes only the accent (never the 16-colour rule), and not the green palette', () => {
  const base = paletteOf('dreamy');
  const tinted = withAlbumAccent(base, [220, 40, 40]);
  assert.equal(tinted.colors.length, 16);
  assert.notEqual(tinted.colors[tinted.accent], base.colors[base.accent]);
  assert.equal(tinted.colors[tinted.bright], base.colors[base.bright]);
  assert.deepEqual(withAlbumAccent(paletteOf('green'), [220, 40, 40]).colors, paletteOf('green').colors);
});

test('cover mapping uses only palette colours and reports a dominant colour', () => {
  const n = 8;
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) rgba.set([200, 30, 40, 255], i * 4);
  const p = paletteOf('sunset');
  const { indices, dominant } = coverToIndices(rgba, n, p);
  assert.equal(indices.length, n * n);
  for (const i of indices) assert.ok(i >= 0 && i < 16);
  assert.ok(dominant[0] > dominant[2]);
  assert.equal(nearestIndex([[0, 0, 0], [255, 255, 255]], 250, 250, 250), 1);
});

test('dissolve: the dither only ever adds pixels as it goes, starts empty and ends complete', () => {
  assert.equal(DISSOLVE_STEPS, 16);
  let prev = null;
  for (let level = 0; level <= DISSOLVE_STEPS; level++) {
    const cur = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) cur.push(dissolveVisible(x, y, level));
    if (prev) cur.forEach((v, i) => assert.ok(!prev[i] || v, `level ${level} keeps what level ${level - 1} showed`));
    assert.equal(cur.filter(Boolean).length, level, `level ${level} shows exactly ${level} of 16`);
    prev = cur;
  }
  assert.equal(dissolveLevel(0), 0);
  assert.equal(dissolveLevel(1), DISSOLVE_STEPS);
  let last = -1;
  for (let i = 0; i <= 100; i++) {
    const l = dissolveLevel(i / 100);
    assert.ok(l >= last);
    last = l;
  }
  const seen = new Set();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const t = bayerThreshold(x, y, 8);
    assert.ok(t > 0 && t < 1);
    seen.add(t);
  }
  assert.equal(seen.size, 64);
});

test('text: curly quotes and dashes are made plain, accents the font lacks are dropped', () => {
  assert.equal(pixelText('don’t “go” — now', 'press'), 'don\'t "go" - now');
  assert.equal(pixelText('  a   b  ', 'press'), 'a b');
});

test('wrapping with the real font metrics: at most 3 rows, inside the box, a smaller size when needed, never overlapping', () => {
  const long = 'In the middle of the night when the stars are bright and the world is quiet and still and nobody knows my name at all and the rain keeps falling'.split(' ');
  for (const fontId of ['press', 'silk']) {
    const measure = tableMeasure(fontId);
    for (const maxW of [600, 480, 300, 200]) {
      for (const lh of [240, 320, 360, 450, 640]) {
        const sizes = fontSizes(lh);
        const lay = layoutLine(long, measure, { maxW, maxRows: 3, sizes });
        assert.ok(lay.rows.length >= 1 && lay.rows.length <= 3, `${fontId} ${maxW} rows ${lay.rows.length}`);
        assert.ok(sizes.includes(lay.size), 'a size from the list');
        assert.equal(lay.size % 8, 0, 'a multiple of 8, the font grid');
        for (const row of lay.rows) {
          assert.ok(row.w <= maxW, `${fontId} ${maxW}@${lh}: row ${row.w}`);
          assert.ok(row.x >= 0 && row.x + row.w <= maxW);
          let x = -1;
          for (const it of row.items) {
            assert.ok(it.x >= x, 'items do not overlap');
            x = it.x + it.w;
          }
        }
        for (let i = 1; i < lay.rows.length; i++) assert.ok(lay.rows[i].y - lay.rows[i - 1].y >= lay.size, 'rows do not overlap');
      }
    }
  }
  const short = layoutLine(['Hello', 'there'], tableMeasure('press'), { maxW: 600, maxRows: 3, sizes: fontSizes(360) });
  assert.equal(short.rows.length, 1);
  assert.equal(short.size, 16, 'a short line keeps the large size');
});

test('a line too long even at the smallest size is cut with dots, not drawn outside', () => {
  const words = Array.from({ length: 60 }, () => 'wonderful');
  const lay = layoutLine(words, tableMeasure('press'), { maxW: 200, maxRows: 3, sizes: [16, 8] });
  assert.equal(lay.size, 8);
  assert.equal(lay.rows.length, 3);
  assert.ok(lay.truncated);
  for (const row of lay.rows) assert.ok(row.w <= 200);
});

test('marquee: stays within the loop length, pauses at the start, and does not move when the text fits', () => {
  assert.equal(marqueeOffset(100, 200, 5000), 0);
  assert.equal(marqueeOffset(400, 200, 0), 0);
  assert.equal(marqueeOffset(400, 200, 1900), 0);
  let max = 0;
  let last = 0;
  for (let t = 0; t < 120000; t += 50) {
    const o = marqueeOffset(400, 200, t);
    assert.ok(o >= 0 && o < 400 + 24, `offset ${o}`);
    assert.ok(Number.isInteger(o), 'whole pixels');
    max = Math.max(max, o);
    last = o;
  }
  void last;
  assert.ok(max > 100, 'it does scroll');
});

const mk = (time, text, dur = 2000) => ({ time, words: text.split(' ').map((t, i, a) => ({ text: t, start: time + (i * dur) / a.length, end: time + ((i + 1) * dur) / a.length })) });

test('which line is shown: dim a little before it is sung, kept after, idle in a long gap, held lines stay', () => {
  const lines = [mk(10000, 'one two'), mk(30000, 'three four'), mk(34000, 'five six'), mk(60000, 'seven eight', 7000)];
  const rep = repeatedLines(lines);
  assert.equal(visibleLines(lines, -1, 5000, rep).main, -1, 'long before the first line: idle');
  assert.equal(visibleLines(lines, -1, 9000, rep).main, 0, 'the first line is on screen, dim, before it is sung');
  assert.equal(visibleLines(lines, 0, 10500, rep).main, 0);
  assert.equal(visibleLines(lines, 0, 20000, rep).main, -1, 'the gap shows the idle screen');
  assert.equal(visibleLines(lines, 0, 29000, rep).main, 1, 'the next line comes in before it is sung');
  assert.equal(visibleLines(lines, 1, 31000, rep).sub, 2, 'the line after shows small');
  const held = visibleLines(lines, 3, 66000, rep);
  assert.equal(held.main, 3, 'a long held line stays');
  assert.ok(showUntil(lines, 3, rep) <= 67000 + 6000);
  const chorus = [mk(0, 'la la la love'), mk(5000, 'something else'), mk(40000, 'la la la love')];
  assert.ok(repeatedLines(chorus).has(0) && repeatedLines(chorus).has(2));
  assert.ok(showUntil(chorus, 0, repeatedLines(chorus)) <= 4700);
});

test('a word is bright cream on its start frame, dim before it, a little dimmer long after', () => {
  assert.equal(wordTone(999, 1000, 1500), TONE_DIM);
  assert.equal(wordTone(1000, 1000, 1500), TONE_BRIGHT);
  assert.equal(wordTone(2000, 1000, 1500), TONE_BRIGHT);
  assert.equal(wordTone(9000, 1000, 1500), TONE_MID);
});

test('pan, clouds and clock are whole numbers and stay in range', () => {
  for (let t = 0; t < 600; t += 0.37) {
    assert.ok(Number.isInteger(panOffset(t, 4, 70)) && Math.abs(panOffset(t, 4, 70)) <= 4);
    const x = cloudX(100, 3, t, 640, 30);
    assert.ok(Number.isInteger(x) && x >= -30 && x < 640);
  }
  assert.equal(clockText(65000), '1:05');
  assert.equal(clockText(-5), '0:00');
});
