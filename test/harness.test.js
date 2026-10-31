import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scoreSong, scoreSet } from '../web/js/harness.js';
import { loadReferenceSongs, BASELINE } from '../tools/harness.mjs';

const ALLOWED_REGRESSION_MS = 5;

test('scoreSong measures bias and error after a per-song offset', () => {
  // Reference words are each exactly 100 ms later than an even split would put them.
  const song = {
    track: { title: 't', durationMs: 10_000 },
    lines: [
      { time: 0, text: 'a b', words: [{ text: 'a', start: 100 }, { text: 'b', start: 1000 }] },
      { time: 5000, text: '', words: [] },
    ],
  };
  const r = scoreSong(song);
  assert.equal(r.words, 2);
  assert.ok(r.meanAbs > 0);
  assert.ok(r.meanAbsAfterOffset <= r.meanAbs);
});

test('scoreSong skips lines whose word count differs', () => {
  const song = { lines: [{ time: 0, text: 'one two', words: [{ text: 'one', start: 0 }] }] };
  assert.equal(scoreSong(song).skippedLines, 1);
});

test('timing accuracy has not regressed against the reference set', (t) => {
  const songs = loadReferenceSongs();
  if (!songs.length) return t.skip('no reference songs in test/reference yet');
  const r = scoreSet(songs);
  if (!fs.existsSync(BASELINE)) return t.skip('no baseline yet: run npm run harness -- --update-baseline');
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  assert.ok(
    r.meanAbsAfterOffset <= base.meanAbsAfterOffset + ALLOWED_REGRESSION_MS,
    `after-offset error ${Math.round(r.meanAbsAfterOffset)} ms is worse than baseline ${Math.round(base.meanAbsAfterOffset)} ms`
  );
  assert.ok(
    r.meanAbs <= base.meanAbs + ALLOWED_REGRESSION_MS,
    `error ${Math.round(r.meanAbs)} ms is worse than baseline ${Math.round(base.meanAbs)} ms`
  );
});
