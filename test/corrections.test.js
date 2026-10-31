import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corrections from '../web/js/corrections.js';
import { buildTimeline, timelineKind } from '../web/js/timing.js';
import { parseLrc } from '../web/js/lyrics/lrc.js';

const track = { key: 'sp:1', title: 'Yellow', artist: 'Coldplay', album: 'Parachutes', durationMs: 20_000 };
const lines = [
  { time: 1000, text: 'Look at the stars' },
  { time: 5000, text: '' },
  { time: 8000, text: 'Look how they shine' },
];

test('tapped lines replace the estimate and are marked as yours', () => {
  let rec = corrections.create(track, lines, { recordId: 7 });
  rec = corrections.setLineWords(rec, 0, [900, 1400, 1700, 2000]);
  const tl = buildTimeline(corrections.apply(lines, rec), { trackDurationMs: track.durationMs });
  assert.equal(tl[0].timing, 'yours');
  assert.equal(tl[0].time, 900, 'an early first word pulls the line in');
  assert.deepEqual(tl[0].words.map((w) => w.start), [900, 1400, 1700, 2000]);
  assert.equal(tl[2].timing, 'estimated');
  assert.equal(timelineKind(tl), 'yours');
  rec = corrections.clearLine(rec, 0);
  assert.equal(corrections.timedLineCount(rec), 0);
});

test('timings saved for different lyrics are not applied', () => {
  const rec = corrections.setLineWords(corrections.create(track, lines), 0, [1000, 1200, 1400, 1600]);
  const other = [{ time: 1000, text: 'Something else entirely' }];
  assert.equal(corrections.apply(other, rec), null);
});

test('export round-trips through JSON and LRC', () => {
  const rec = corrections.setLineWords(corrections.create(track, lines), 2, [8000, 8300, 8600, 9000]);
  const back = corrections.parseImport(corrections.toJson(rec), track, lines);
  assert.equal(back.ownLyrics, false);
  assert.deepEqual(back.lines[2].words.map((w) => w.start), [8000, 8300, 8600, 9000]);

  const lrc = corrections.toLrc(rec);
  assert.match(lrc, /\[00:08\.00\]<00:08\.00>Look <00:08\.30>how/);
  const parsed = parseLrc(lrc);
  assert.deepEqual(parsed.find((l) => l.time === 8000).words.map((w) => w.start), [8000, 8300, 8600, 9000]);
});

test('importing an LRC file supplies the lyrics themselves', () => {
  const rec = corrections.parseImport('[00:01.00]<00:01.00>my <00:01.50>own\n[00:04.00]words here', track, null);
  assert.equal(rec.ownLyrics, true);
  const tl = buildTimeline(corrections.apply(null, rec), { trackDurationMs: track.durationMs });
  assert.equal(tl[0].timing, 'word');
  assert.equal(tl[1].timing, 'estimated');
});

test('bad imports are refused with a plain message', () => {
  assert.throws(() => corrections.parseImport('{"nope":1}', track, lines), corrections.ImportError);
  assert.throws(() => corrections.parseImport('just some text', track, lines), corrections.ImportError);
});
