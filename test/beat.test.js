import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatTracker } from '../web/js/beat.js';

// A synthetic drum track: a kick on every beat, a weaker hit halfway between, a little noise, optional jitter.
function feed(tr, { bpm, from = 0, to = 12000, offset = 100, jitter = 0, seed = 1 }) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const period = 60000 / bpm;
  const hits = new Map();
  for (let t = offset; t < to + period; t += period) {
    hits.set(Math.round((t + (rnd() - 0.5) * jitter) / 10), 1);
    hits.set(Math.round((t + period / 2) / 10), 0.4);
  }
  for (let t = from; t < to; t += 10) tr.push(t, (hits.get(Math.round(t / 10)) || 0) + rnd() * 0.05);
}

const nearBeat = (tr, bpm, offset, at) => {
  const period = 60000 / bpm;
  const phase = (((at - offset) % period) + period) % period;
  return Math.min(phase, period - phase);
};

test('finds 120 BPM and pulses on the beat', () => {
  const tr = new BeatTracker();
  feed(tr, { bpm: 120, to: 12000 });
  assert.ok(Math.abs(tr.bpm - 120) < 3, `bpm ${tr.bpm}`);
  // The pulse peaks within 40 ms of a real beat, and is low halfway between beats.
  let bestAt = 0;
  let best = -1;
  for (let t = 11000; t < 11500; t += 5) if (tr.pulse(t) > best) (best = tr.pulse(t)), (bestAt = t);
  assert.ok(nearBeat(tr, 120, 100, bestAt) < 40, `peak ${bestAt} is ${nearBeat(tr, 120, 100, bestAt)} ms from a beat`);
  assert.ok(best > 0.8, `peak ${best}`);
  assert.ok(tr.pulse(100 + 250 + 11000 - (11000 % 500) + 0) < 0.5);
});

test('finds other tempos, with timing jitter', () => {
  for (const bpm of [75, 100, 140, 170]) {
    const tr = new BeatTracker();
    feed(tr, { bpm, to: 14000, jitter: 20, seed: bpm });
    // A fast song may be read at half speed (every second beat): still on the beat, so it counts.
    const ok = [bpm, bpm / 2].some((b) => Math.abs(tr.bpm - b) / b < 0.04);
    assert.ok(ok && (bpm < 150 || tr.bpm > 0), `${bpm} read as ${tr.bpm}`);
  }
});

test('follows a change of tempo', () => {
  const tr = new BeatTracker();
  feed(tr, { bpm: 100, to: 10000 });
  feed(tr, { bpm: 140, from: 10000, to: 24000, offset: 10000 + 50 });
  assert.ok(Math.abs(tr.bpm - 140) < 6, `read as ${tr.bpm}`);
});

test('says nothing for silence, steady noise and too little music', () => {
  const quiet = new BeatTracker();
  for (let t = 0; t < 10000; t += 10) quiet.push(t, 0);
  assert.equal(quiet.bpm, 0);
  assert.equal(quiet.pulse(10000), 0);

  const noise = new BeatTracker();
  let s = 7;
  for (let t = 0; t < 12000; t += 10) noise.push(t, ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 0.5);
  assert.equal(noise.pulse(12000), 0, `noise gave ${noise.bpm} BPM`);

  const short = new BeatTracker();
  feed(short, { bpm: 120, to: 2000 });
  assert.equal(short.pulse(2000), 0);
});

test('lets go of the beat when the music stops, and starts again', () => {
  const tr = new BeatTracker();
  feed(tr, { bpm: 120, to: 10000 });
  assert.ok(tr.bpm > 0);
  for (let t = 10000; t < 13000; t += 10) tr.push(t, 0);
  assert.equal(tr.pulse(13000), 0);
  assert.equal(tr.bpm, 0);
  feed(tr, { bpm: 120, from: 13000, to: 22000, offset: 13000 });
  assert.ok(Math.abs(tr.bpm - 120) < 4, `read as ${tr.bpm}`);
});

test('ignores bad input and time going backwards', () => {
  const tr = new BeatTracker();
  tr.push(NaN, 1);
  tr.push(100, -1);
  tr.push(1000, 1);
  tr.push(500, 1); // earlier: ignored
  assert.equal(tr.pulse(1000), 0);
});
