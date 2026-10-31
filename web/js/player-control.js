// What happens when a player button is pressed: show the result at once, send the
// command, undo it if Spotify refuses, and ignore stale polls until the real state
// confirms it. Knows nothing about the page; main.js supplies the pieces.

export const HOLD_MS = 2500; // how long a poll that disagrees is treated as stale
export const REFRESH_MS = 450; // wait before asking for the real state
const AGREE_MS = 1500; // a position this close to the expected one counts as confirmed

export class PlayerControl {
  // sender: { play, pause, next, previous, seek } returning promises.
  // state(): { available, trackKey, durationMs, isPlaying, positionMs }
  // apply({ isPlaying, positionMs }): show a state now. refresh(): poll now. onError(error).
  constructor({ sender, state, apply, refresh, onError, now = () => performance.now(), later = (fn, ms) => setTimeout(fn, ms) }) {
    Object.assign(this, { sender, state, apply, refresh, onError, now, later });
    this.expect = null;
  }

  get available() {
    return this.state().available;
  }

  playPause() {
    const s = this.state();
    if (!s.available) return;
    const isPlaying = !s.isPlaying;
    return this._run(isPlaying ? 'play' : 'pause', [], s, { isPlaying, positionMs: s.positionMs });
  }

  // Next and previous start the new song from the top; which song it is comes from the next poll.
  next() {
    return this._skip('next');
  }

  previous() {
    return this._skip('previous');
  }

  _skip(command) {
    const s = this.state();
    if (s.available) return this._run(command, [], s, { isPlaying: true, positionMs: 0 });
  }

  seek(ms) {
    const s = this.state();
    if (!s.available || !(s.durationMs > 0)) return;
    const positionMs = Math.round(Math.min(Math.max(0, ms), s.durationMs - 500));
    return this._run('seek', [positionMs], s, { isPlaying: s.isPlaying, positionMs });
  }

  async _run(command, args, before, after) {
    const t0 = this.now();
    // Skips change the song, so the poll may report a new track key: only hold same-track polls for those.
    this.expect = { ...after, trackKey: before.trackKey, at: t0, until: t0 + HOLD_MS };
    this.apply(after);
    try {
      await this.sender[command](...args);
      this.later(() => this.refresh(), REFRESH_MS);
    } catch (e) {
      this.expect = null;
      this.apply({ isPlaying: before.isPlaying, positionMs: before.positionMs + (before.isPlaying ? this.now() - t0 : 0) });
      this.onError(e);
    }
  }

  // True for a source sample that predates the last command: it is dropped, not shown.
  holding(sample) {
    const e = this.expect;
    if (!e) return false;
    const t = this.now();
    if (t > e.until || sample.kind !== 'track' || sample.track.key !== e.trackKey) {
      this.expect = null;
      return false;
    }
    const expected = e.positionMs + (e.isPlaying ? t - e.at : 0);
    const reported = sample.positionMs + (sample.isPlaying ? t - (sample.at ?? t) : 0);
    if (sample.isPlaying === e.isPlaying && Math.abs(reported - expected) <= AGREE_MS) {
      this.expect = null; // confirmed
      return false;
    }
    return true;
  }
}
