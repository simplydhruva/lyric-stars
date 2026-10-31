// The control bar at the bottom: previous, play/pause, next, and a seekable progress bar.
// It only draws and reports presses; player-control.js decides what they do.

const ICONS = {
  previous: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
};
const MESSAGE_MS = 5000;

// 3:05, or 1:02:03 for a long recording.
export function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Where along the bar (0..1) a pointer at clientX is.
export function barRatio(clientX, rect) {
  return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
}

export class PlayerBar {
  // handlers: { previous, playPause, next, seek(ms) }
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Player');
    root.innerHTML = `
      <p class="pb-message" role="status" hidden></p>
      <div class="pb-buttons">
        <button type="button" class="pb-btn" data-act="previous" aria-label="Previous song" title="Previous (Left arrow)">${ICONS.previous}</button>
        <button type="button" class="pb-btn pb-main" data-act="playPause" aria-label="Pause" title="Play or pause (Space)">${ICONS.pause}</button>
        <button type="button" class="pb-btn" data-act="next" aria-label="Next song" title="Next (Right arrow)">${ICONS.next}</button>
      </div>
      <div class="pb-progress">
        <span class="pb-time pb-elapsed">0:00</span>
        <div class="pb-track" role="progressbar" aria-label="Song position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" title="Click to jump">
          <div class="pb-fill"></div>
        </div>
        <span class="pb-time pb-total">0:00</span>
      </div>`;
    const q = (s) => root.querySelector(s);
    this.el = { message: q('.pb-message'), main: q('.pb-main'), track: q('.pb-track'), fill: q('.pb-fill'), elapsed: q('.pb-elapsed'), total: q('.pb-total') };
    this.shown = { playing: true, elapsed: '0:00', total: '0:00', ratio: -1 };
    this.scrub = null; // 0..1 while the pointer is down on the bar
    this.messageTimer = null;

    root.querySelector('.pb-buttons').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) handlers[act]();
    });
    const { track } = this.el;
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture?.(e.pointerId);
      this.scrub = barRatio(e.clientX, track.getBoundingClientRect());
    });
    track.addEventListener('pointermove', (e) => {
      if (this.scrub != null) this.scrub = barRatio(e.clientX, track.getBoundingClientRect());
    });
    track.addEventListener('pointerup', (e) => {
      if (this.scrub == null) return;
      const ratio = barRatio(e.clientX, track.getBoundingClientRect());
      this.scrub = null;
      handlers.seek(ratio * this.duration);
    });
    track.addEventListener('pointercancel', () => (this.scrub = null));
    this.duration = 0;
  }

  setAvailable(available) {
    this.root.hidden = !available;
  }

  // A short note under the buttons, such as why Spotify refused a command.
  say(text) {
    const { message } = this.el;
    message.textContent = text;
    message.hidden = false;
    this.root.classList.add('has-message');
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      message.hidden = true;
      this.root.classList.remove('has-message');
    }, MESSAGE_MS);
  }

  // Called every animation frame, so it only touches the page when something changed.
  frame(positionMs, durationMs, isPlaying) {
    if (this.root.hidden) return;
    this.duration = durationMs || 0;
    const ratio = this.scrub ?? (this.duration ? Math.min(1, positionMs / this.duration) : 0);
    const shownMs = this.scrub != null ? this.scrub * this.duration : positionMs;
    const elapsed = formatClock(shownMs);
    const total = formatClock(this.duration);
    const s = this.shown;
    if (isPlaying !== s.playing) {
      s.playing = isPlaying;
      this.el.main.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
      this.el.main.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    }
    if (elapsed !== s.elapsed) this.el.elapsed.textContent = s.elapsed = elapsed;
    if (total !== s.total) this.el.total.textContent = s.total = total;
    if (Math.abs(ratio - s.ratio) > 0.0005) {
      s.ratio = ratio;
      this.el.fill.style.transform = `scaleX(${ratio.toFixed(4)})`;
      this.el.track.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      this.el.track.setAttribute('aria-valuetext', `${elapsed} of ${total}`);
    }
  }
}
