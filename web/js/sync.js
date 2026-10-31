// Sync offsets and latency compensation.
// Positive offsets make lyrics appear earlier. The drawn position is
//   clock + display latency + global offset + this song's offset.
import { store, settings } from './settings.js';

export const OFFSET_STEP_MS = 50;
export const FINE_STEP_MS = 10;
export const OFFSET_LIMIT_MS = 5000;

const clampOffset = (ms) => Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(ms)));

export function songOffset(trackKey) {
  if (!trackKey) return 0;
  return (store.get('ls.offsets') || {})[trackKey] || 0;
}

export function setSongOffset(trackKey, ms) {
  if (!trackKey) return 0;
  const all = store.get('ls.offsets') || {};
  const v = clampOffset(ms);
  if (v) all[trackKey] = v;
  else delete all[trackKey];
  store.set('ls.offsets', all);
  return v;
}

export function globalOffset() {
  return settings.get('globalOffsetMs') || 0;
}

export function setGlobalOffset(ms) {
  const v = clampOffset(ms);
  settings.set('globalOffsetMs', v);
  return v;
}

// A frame drawn now reaches the screen about one and a half refresh intervals later
// (the rest of this frame, then the compositor's). Measured from requestAnimationFrame.
export class DisplayLatency {
  constructor() {
    this.intervals = [];
    this.last = 0;
    this.ms = 16 * 1.5;
  }

  tick(now) {
    if (this.last) {
      const d = now - this.last;
      // Ignore stalls (hidden tab, breakpoints): they are not the refresh rate.
      if (d > 4 && d < 50) {
        this.intervals.push(d);
        if (this.intervals.length > 120) this.intervals.shift();
        if (this.intervals.length % 30 === 0) {
          const sorted = [...this.intervals].sort((a, b) => a - b);
          this.ms = sorted[sorted.length >> 1] * 1.5;
        }
      }
    }
    this.last = now;
  }
}

export function formatOffset(ms) {
  if (!ms) return '0 ms';
  return `${ms > 0 ? '+' : '−'}${Math.abs(ms)} ms`;
}
