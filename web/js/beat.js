// Finding the beat from a stream of "something just started" strengths (onsets), for the beat pulse.
// Pure: it never touches audio. audio-beat.js turns the sound into onset strengths and feeds them here.
//
//   tracker.push(timeMs, strength)   as often as you like, times only ever increase
//   tracker.pulse(timeMs)            0..1: 1 on a beat, fading away after it; 0 when there is no steady beat
//
// How: the onsets of the last 8 seconds go into 10 ms bins. For every tempo from 60 to 180 BPM the strengths one beat
// apart are compared with each other (autocorrelation); the best tempo wins, with a mild liking for 90 to 150 BPM so
// that a half-time or double-time reading is not picked by accident. The beat phase is where a comb at that tempo
// catches the most onset strength. When no tempo stands out, the pulse stays at 0 instead of guessing.

const BIN_MS = 10;
const WINDOW_BINS = 800; // 8 s
const MIN_BPM = 60;
const MAX_BPM = 180;
const MIN_HISTORY_MS = 4000; // before this there is too little to tell a tempo
const UPDATE_MS = 250;
const CONFIDENT = 0.28; // autocorrelation peak, relative to the lag-0 energy; below it the beat is "not steady"
const DECAY_MS = 150;
const SILENCE_MS = 1500; // no onsets at all for this long: forget the beat

export class BeatTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.env = new Float32Array(WINDOW_BINS);
    this.lastBin = -1; // newest bin written
    this.firstMs = null;
    this.lastOnsetMs = -Infinity;
    this.lastUpdate = -Infinity;
    this.period = 0; // ms per beat, 0 = no steady beat
    this.anchor = 0; // time of one beat, ms
    this.confidence = 0;
  }

  get bpm() {
    return this.period ? 60000 / this.period : 0;
  }

  push(t, strength) {
    if (!(strength >= 0) || !Number.isFinite(t)) return;
    const bin = Math.floor(t / BIN_MS);
    if (this.firstMs == null) this.firstMs = t;
    if (bin < this.lastBin) return; // never goes back
    // Clear the bins that passed without any onset.
    const gap = Math.min(bin - this.lastBin, WINDOW_BINS);
    for (let k = 1; k <= gap; k++) this.env[(this.lastBin + k) % WINDOW_BINS] = 0;
    this.lastBin = bin;
    const i = bin % WINDOW_BINS;
    if (strength > this.env[i]) this.env[i] = strength;
    if (strength > 0.05) this.lastOnsetMs = t;
    if (t - this.lastUpdate >= UPDATE_MS) {
      this.lastUpdate = t;
      this._update(t);
    }
  }

  _bins(t) {
    // The last 8 s as a plain array, oldest first, ending at the bin of time t.
    const end = Math.floor(t / BIN_MS);
    const out = new Float32Array(WINDOW_BINS);
    for (let k = 0; k < WINDOW_BINS; k++) {
      const b = end - (WINDOW_BINS - 1 - k);
      if (b < 0 || b > this.lastBin || b <= this.lastBin - WINDOW_BINS) continue;
      out[k] = this.env[b % WINDOW_BINS];
    }
    return { x: out, startMs: (end - (WINDOW_BINS - 1)) * BIN_MS };
  }

  _update(t) {
    if (t - this.lastOnsetMs > SILENCE_MS) {
      this.period = 0;
      this.confidence = 0;
      return;
    }
    if (t - this.firstMs < MIN_HISTORY_MS) return;
    const { x, startMs } = this._bins(t);
    let mean = 0;
    for (let k = 0; k < WINDOW_BINS; k++) mean += x[k];
    mean /= WINDOW_BINS;
    const y = new Float32Array(WINDOW_BINS);
    let energy = 0;
    for (let k = 0; k < WINDOW_BINS; k++) {
      y[k] = x[k] - mean;
      energy += y[k] * y[k];
    }
    if (energy < 1e-6) {
      this.period = 0;
      this.confidence = 0;
      return;
    }
    const minLag = Math.round(60000 / MAX_BPM / BIN_MS);
    const maxLag = Math.round(60000 / MIN_BPM / BIN_MS);
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let k = lag; k < WINDOW_BINS; k++) sum += y[k] * y[k - lag];
      // The same beat also shows up two beats apart, so add that in: a real tempo scores on both.
      let sum2 = 0;
      for (let k = 2 * lag; k < WINDOW_BINS; k++) sum2 += y[k] * y[k - 2 * lag];
      const bpm = 60000 / (lag * BIN_MS);
      const prefer = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2));
      const score = ((sum / (WINDOW_BINS - lag) + 0.5 * sum2 / Math.max(1, WINDOW_BINS - 2 * lag)) / 1.5) * (0.6 + 0.4 * prefer);
      if (score > best) {
        best = score;
        bestLag = lag;
      }
    }
    const rel = best / (energy / WINDOW_BINS);
    if (!bestLag || rel < CONFIDENT) {
      this.confidence = rel;
      // Keep the old tempo through a short weak patch (a quiet bar), drop it when it lasts.
      if (rel < CONFIDENT * 0.6) this.period = 0;
      return;
    }
    // Refine the lag to a fraction of a bin around the peak.
    const period = bestLag * BIN_MS;
    this.confidence = rel;
    this.period = this.period && Math.abs(this.period - period) / this.period < 0.04 ? this.period * 0.6 + period * 0.4 : period;

    // Phase: the offset in one beat where onsets add up most (every beat in the window counts).
    const p = this.period / BIN_MS;
    let bestPhase = 0;
    let bestSum = -1;
    const steps = Math.max(1, Math.round(p));
    for (let s = 0; s < steps; s++) {
      const phase = (s * p) / steps;
      let sum = 0;
      for (let pos = phase; pos < WINDOW_BINS; pos += p) {
        const k = Math.round(pos);
        sum += x[Math.min(WINDOW_BINS - 1, k)] + 0.5 * (x[Math.max(0, k - 1)] + x[Math.min(WINDOW_BINS - 1, k + 1)]);
      }
      if (sum > bestSum) {
        bestSum = sum;
        bestPhase = phase;
      }
    }
    // The comb catches the onset a bin or two after it starts; that bias is small next to 150 ms of fade.
    this.anchor = startMs + bestPhase * BIN_MS;
  }

  // 0..1. 1 right on a beat, fading to 0 before the next one; 0 when there is no steady beat.
  pulse(t) {
    if (!this.period) return 0;
    if (t - this.lastOnsetMs > SILENCE_MS) return 0;
    const since = (((t - this.anchor) % this.period) + this.period) % this.period;
    // A clear beat pulses fully; one that is only just holding on (a quiet bar) fades toward nothing.
    const c = this.confidence;
    const strength = c >= CONFIDENT ? 0.8 + 0.2 * Math.min(1, (c - CONFIDENT) / CONFIDENT) : (0.8 * (c - CONFIDENT * 0.6)) / (CONFIDENT * 0.4);
    return Math.exp(-since / DECAY_MS) * Math.max(0, strength);
  }
}
