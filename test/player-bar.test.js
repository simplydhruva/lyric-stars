import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, barRatio } from '../web/js/player-bar.js';
import { trackFromItem } from '../web/js/sources/spotify.js';
import { borrowArt } from '../web/js/sources/auto.js';

test('formatClock gives m:ss, and h:mm:ss for long recordings', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(5_999), '0:05');
  assert.equal(formatClock(185_000), '3:05');
  assert.equal(formatClock(3_723_000), '1:02:03');
  assert.equal(formatClock(-4000), '0:00');
  assert.equal(formatClock(undefined), '0:00');
});

test('barRatio maps a click to a position along the bar and clamps at the ends', () => {
  const rect = { left: 100, width: 200 };
  assert.equal(barRatio(100, rect), 0);
  assert.equal(barRatio(200, rect), 0.5);
  assert.equal(barRatio(50, rect), 0);
  assert.equal(barRatio(999, rect), 1);
  assert.equal(barRatio(150, { left: 0, width: 0 }), 0);
});

test('trackFromItem keeps the smallest cover for the corner and the largest for the scene', () => {
  const item = {
    id: 'x', name: 'Song', artists: [{ name: 'A' }], duration_ms: 1000,
    album: { name: 'Al', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] },
  };
  const t = trackFromItem(item);
  assert.equal(t.art, 'small');
  assert.equal(t.artLarge, 'big');
  // Not in size order: still the widest.
  item.album.images.reverse();
  assert.equal(trackFromItem(item).artLarge, 'big');
  assert.equal(trackFromItem({ ...item, album: { images: [] } }).artLarge, undefined);
});

test('a local track with no cover borrows the account’s cover for the same song', () => {
  const local = { key: 'smtc:1', title: 'Yellow', artist: 'Coldplay', artists: ['Coldplay'], durationMs: 266_000 };
  const account = { key: 'sp:1', title: 'Yellow', artist: 'Coldplay', artists: ['Coldplay'], durationMs: 266_500, art: 's', artLarge: 'L' };
  const merged = borrowArt(local, account);
  assert.equal(merged.artLarge, 'L');
  assert.equal(merged.art, 's');
  assert.equal(merged.key, 'smtc:1', 'keeps its own key');
  assert.equal(borrowArt(local, { ...account, title: 'Fix You' }), local, 'a different song borrows nothing');
  assert.equal(borrowArt(local, null), local);
  assert.equal(borrowArt({ ...local, artLarge: 'mine' }, account).artLarge, 'mine');
});
