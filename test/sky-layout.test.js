import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLine, hash } from '../web/js/sky-layout.js';

const measure = (text, font) => text.length * font * 0.55;
const words = (...t) => t.map((text) => ({ text }));
const base = { w: 1280, h: 720, baseFont: 24, measure };
const line = (extra = {}) =>
  placeLine({ ...base, words: words('hold', 'me', 'closer', 'tiny', 'dancer', 'now'), seed: 42, ...extra });
const boxesOverlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

test('same inputs give the same sky', () => {
  assert.deepEqual(line(), line());
});

test('different seeds give different skies', () => {
  assert.notDeepEqual(line({ seed: 1 }).stars, line({ seed: 2 }).stars);
});

test('places every word, linked to the one before', () => {
  const r = line({ chaos: 0 });
  assert.equal(r.stars.length, 6);
  assert.deepEqual(r.links, [1, 2, 3, 4, 5].map((to) => ({ from: to - 1, to })));
});

test('stars do not overlap and stay on screen', () => {
  for (const seed of [1, 7, 99, 1234]) {
    const { stars } = line({ seed });
    stars.forEach((s, i) => {
      assert.ok(s.box.l >= 0 && s.box.t >= 0 && s.box.r <= base.w && s.box.b <= base.h);
      for (const o of stars.slice(i + 1)) assert.ok(!boxesOverlap(s.box, o.box));
    });
  }
});

test('chaos adds extra links, never to a later or the same star', () => {
  const calm = line({ chaos: 0 }).links.length;
  const wild = line({ chaos: 1 }).links;
  assert.ok(wild.length > calm);
  assert.ok(wild.every((l) => l.from < l.to));
});

test('low spread keeps stars nearer the centre', () => {
  const span = (r) => Math.max(...r.stars.map((s) => s.x)) - Math.min(...r.stars.map((s) => s.x));
  assert.ok(span(line({ spread: 0 })) < span(line({ spread: 1 })));
});

test('empty line carries the previous line forward', () => {
  const first = line();
  const empty = placeLine({ ...base, words: [], seed: 3, prev: first });
  assert.deepEqual(empty.stars, []);
  assert.equal(empty.tail, first.tail);
});

test('hash is stable', () => {
  assert.equal(hash('abc'), hash('abc'));
  assert.notEqual(hash('abc'), hash('abd'));
});
