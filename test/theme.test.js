import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPalette, forNightSky, makeTheme, resolveTheme, hexToRgb, rgbToHex, THEMES, fontCss, FONTS } from '../web/js/theme.js';
import { FrameStats } from '../web/js/perf.js';

// RGBA bytes for an image made of [color, pixelCount] blocks.
function pixels(blocks) {
  const out = [];
  for (const [[r, g, b, a = 255], n] of blocks) for (let i = 0; i < n; i++) out.push(r, g, b, a);
  return Uint8ClampedArray.from(out);
}

const lightness = ([r, g, b]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;

test('hex colors round-trip and bad input is rejected', () => {
  assert.deepEqual(hexToRgb('#f4c76b'), [244, 199, 107]);
  assert.deepEqual(hexToRgb('F4C76B'), [244, 199, 107]);
  assert.equal(rgbToHex([244, 199, 107]), '#f4c76b');
  assert.equal(hexToRgb('red'), null);
  assert.equal(hexToRgb(undefined), null);
});

test('night-sky colors keep their hue but are always bright enough', () => {
  for (const c of [[10, 0, 40], [80, 10, 10], [120, 120, 120], [255, 255, 255]]) {
    const out = forNightSky(c);
    assert.ok(lightness(out) >= 0.6 && lightness(out) <= 0.8, `${c} -> ${out}`);
  }
  const navy = forNightSky([10, 20, 90]);
  assert.ok(navy[2] > navy[0] && navy[2] > navy[1], 'stays blue');
});

test('the gold theme matches the original look', () => {
  const t = makeTheme(THEMES.gold.base);
  assert.deepEqual(t.star, [244, 199, 107]);
  assert.deepEqual(t.accents, [t.star]);
  assert.ok(lightness(t.core) > lightness(t.label) && lightness(t.label) > lightness(t.star));
});

test('album palettes pick distinct common colors and ignore grey', () => {
  const data = pixels([
    [[200, 30, 30], 500], // red, most common
    [[30, 60, 200], 300], // blue
    [[205, 40, 25], 200], // another red: same bucket
    [[128, 128, 128], 900], // grey: ignored
    [[3, 3, 3], 900], // black: ignored
    [[40, 200, 60], 10], // green, too rare
  ]);
  const p = extractPalette(data);
  assert.equal(p.length, 2);
  assert.ok(p[0][0] > 150 && p[0][2] < 60, `first is red: ${p[0]}`);
  assert.ok(p[1][2] > 150, `second is blue: ${p[1]}`);
});

test('neighbouring hues are not both picked', () => {
  const data = pixels([
    [[220, 40, 40], 400], // red
    [[220, 90, 40], 380], // red-orange, adjacent bucket
    [[40, 200, 220], 300], // cyan
  ]);
  const p = extractPalette(data);
  assert.equal(p.length, 2);
  assert.ok(p[1][2] > 150, 'second pick skips the adjacent orange');
});

test('monochrome or transparent art gives no palette', () => {
  assert.deepEqual(extractPalette(pixels([[[20, 20, 20], 500], [[240, 240, 240], 500]])), []);
  assert.deepEqual(extractPalette(pixels([[[200, 30, 30, 0], 500]])), []);
  assert.deepEqual(extractPalette(new Uint8ClampedArray(0)), []);
});

test('resolveTheme: album colors win when available, then custom, then named', () => {
  const palette = [[200, 30, 30], [30, 60, 200]];
  const album = resolveTheme({ theme: 'ice', albumColors: true }, palette);
  assert.equal(album.accents.length, 2);
  assert.ok(album.star[0] > album.star[2]);
  // No palette (yet) falls back to the chosen theme.
  assert.deepEqual(resolveTheme({ theme: 'ice', albumColors: true }, []).star, makeTheme(THEMES.ice.base).star);
  assert.deepEqual(resolveTheme({ theme: 'custom', customColor: '#00ff00' }).star, forNightSky([0, 255, 0]));
  assert.deepEqual(resolveTheme({ theme: 'custom', customColor: 'nope' }).star, makeTheme(THEMES.gold.base).star);
  assert.deepEqual(resolveTheme({ theme: 'unknown' }).star, makeTheme(THEMES.gold.base).star);
  assert.deepEqual(resolveTheme({ theme: 'gold', albumColors: false }, palette).star, makeTheme(THEMES.gold.base).star);
});

test('fonts are system fonts with a fallback', () => {
  assert.equal(fontCss('nope'), FONTS.segoe.css);
  for (const f of Object.values(FONTS)) assert.match(f.css, /(sans-serif|serif|monospace)$/);
});

test('frame stats report rate, cost and late frames', () => {
  const s = new FrameStats();
  let t = 0;
  for (let i = 0; i < 120; i++) s.add((t += 16.7), 1 + (i % 10 === 0 ? 4 : 0));
  s.add((t += 60), 1); // one dropped frame
  const sum = s.summary(t);
  assert.ok(sum.fps > 55 && sum.fps < 61, `fps ${sum.fps}`);
  assert.equal(sum.longFrames, 1);
  assert.equal(sum.p95Ms, 5);
  assert.ok(sum.meanMs > 1 && sum.meanMs < 2);
  assert.equal(new FrameStats().summary(0).fps, 0);
});
