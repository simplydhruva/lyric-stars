// Local playback clock. Sources report positions every few seconds; this
// extrapolates between reports so words never jump, and re-syncs on drift.

export const RESYNC_THRESHOLD_MS = 300;
const SLEW_MS = 1000; // small errors are corrected smoothly over this window

const now = () => globalThis.performance.now();

export class PlaybackClock {
  constructor({ clock = now } = {}) {
    this.clock = clock;
    this.reset();
  }

  reset() {
    this.basePos = 0;
    this.baseAt = this.clock();
    this.playing = false;
    this.trackKey = null;
    this.slew = 0; // remaining correction in ms
    this.slewAt = this.baseAt;
    this.stats = { samples: 0, resyncs: 0, lastDrift: 0 };
  }

  // Raw extrapolation, without the pending slew.
  _raw(t) {
    return this.basePos + (this.playing ? t - this.baseAt : 0);
  }

  _pendingSlew(t) {
    const k = Math.min(1, (t - this.slewAt) / SLEW_MS);
    return this.slew * (1 - k);
  }

  position(t = this.clock()) {
    return Math.max(0, this._raw(t) - this._pendingSlew(t));
  }

  // sample: { positionMs, at (clock ms when the position was true), isPlaying, trackKey }
  update({ positionMs, at = this.clock(), isPlaying, trackKey }) {
    const t = this.clock();
    const reported = positionMs + (isPlaying ? t - at : 0);
    this.stats.samples++;
    const snap = trackKey !== this.trackKey || isPlaying !== this.playing;
    const drift = reported - this.position(t);
    this.stats.lastDrift = Math.round(drift);

    if (snap || Math.abs(drift) > RESYNC_THRESHOLD_MS) {
      if (!snap) this.stats.resyncs++;
      this.slew = 0;
    } else {
      // Move the base to the truth, but keep the displayed value continuous
      // and let the difference fade out over SLEW_MS.
      this.slew = drift;
    }
    this.slewAt = t;
    this.basePos = reported;
    this.baseAt = t;
    this.playing = isPlaying;
    this.trackKey = trackKey;
    return { snapped: snap || Math.abs(drift) > RESYNC_THRESHOLD_MS, drift };
  }
}
