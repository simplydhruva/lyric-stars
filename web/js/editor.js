// Tap-to-sync editor (E). Tap Space on each word as you hear it, or drag words
// on the strip. A line is saved as yours once all its words have times.
import { lineIndexAt } from './lyrics/lrc.js';
import { splitWords } from './timing.js';
import { scoreSong } from './harness.js';
import * as corrections from './corrections.js';
import { formatOffset } from './sync.js';

const BEFORE_MS = 2000;
const AFTER_MS = 4000;
const LOOKAHEAD_MS = 500; // a tap this close before a line starts belongs to that line
const MIN_GAP_MS = 20;
const GOLD = '#f4c76b';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class SyncEditor {
  // host: { state(): { track, timeline, record }, lyricTime(ts), drawPosition(),
  //         offsets(): { song, global, display }, change(record), importText(text), nudgeGlobal(ms) }
  constructor(el, host) {
    this.el = el;
    this.host = host;
    this.visible = false;
    this.pending = null; // { line, starts: [] }
    this.history = []; // committed line indexes, for undo
    this.lastLine = null; // { line, t } of the line just tapped, so further taps move on
    this.drag = null;
    this.rects = [];
    this.message = '';
    this.lastPaint = 0;
    this._build();
  }

  _build() {
    this.el.innerHTML = `
      <div class="editor-head">
        <h2>Sync editor</h2>
        <span data-part="status"></span>
        <button type="button" data-ed="toggle" title="Close (E)">Close</button>
      </div>
      <canvas class="strip" height="72"></canvas>
      <p class="editor-line" data-part="line"></p>
      <p data-part="message" class="tap-flash"></p>
      <p class="hint">Space: tap each word as you hear it · Backspace: undo · drag words on the strip · [ ] song offset (Shift for 10 ms)</p>
      <p data-part="offsets"></p>
      <p data-part="score"></p>
      <div class="row">
        <button type="button" data-ed="clearLine">Clear this line</button>
        <button type="button" data-ed="globalEarlier" title="Every song: lyrics 50 ms earlier">Global −</button>
        <button type="button" data-ed="globalLater" title="Every song: lyrics 50 ms later">Global +</button>
        <button type="button" data-ed="exportJson">Export timings</button>
        <button type="button" data-ed="exportLrc">Export LRC</button>
        <button type="button" data-ed="pickFile">Import file…</button>
        <input type="file" accept=".lrc,.json,.txt,text/plain,application/json" hidden>
      </div>`;
    this.canvas = this.el.querySelector('canvas');
    this.file = this.el.querySelector('input[type=file]');
    this.parts = Object.fromEntries([...this.el.querySelectorAll('[data-part]')].map((n) => [n.dataset.part, n]));
    this.el.addEventListener('click', (e) => {
      const action = e.target.closest('[data-ed]')?.dataset.ed;
      if (action) this[action]();
    });
    this.file.addEventListener('change', () => this._readFile());
    this.canvas.addEventListener('pointerdown', (e) => this._dragStart(e));
    this.canvas.addEventListener('pointermove', (e) => this._dragMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._dragEnd(e));
    this.canvas.addEventListener('pointercancel', () => this._dragCancel());
  }

  toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    this.pending = null;
    if (this.visible) this.paint();
  }

  onTrackChange() {
    this.pending = null;
    this.history = [];
    this.lastLine = null;
    this.drag = null;
    this.message = '';
    if (this.visible) this.paint();
  }

  say(text) {
    this.message = text;
    this.paint();
  }

  // ---- tapping ---------------------------------------------------------------

  tap(timeStamp) {
    const { timeline, record } = this.host.state();
    if (!timeline?.length || !record) return this.say('No timed lyrics to sync for this song.');
    const t = this.host.lyricTime(timeStamp);
    const p = this.pending;
    if (p) {
      const nextTime = p.line + 1 < timeline.length ? timeline[p.line + 1].time : Infinity;
      if (t < nextTime + LOOKAHEAD_MS && t > p.starts[p.starts.length - 1]) return this._addTap(t);
      this.pending = null;
      this.message = `Line ${p.line + 1} left unfinished, so it was not saved.`;
    }
    let line = lineIndexAt(timeline, t + LOOKAHEAD_MS);
    // Once a line is finished, the next taps belong to the line after it.
    if (this.lastLine && line <= this.lastLine.line && t > this.lastLine.t) line = this.lastLine.line + 1;
    // A tap during a gap belongs to the next sung line.
    while (line >= 0 && line < timeline.length && !timeline[line].words.length) line++;
    if (line < 0 || line >= timeline.length) return this.say('No line to tap here.');
    if (timeline[line].time - t > 1500) return this.say('That tap is too early for the next line.');
    if (!p) this.message = '';
    this.pending = { line, starts: [] };
    this._addTap(t);
  }

  _addTap(t) {
    const p = this.pending;
    const { record } = this.host.state();
    p.starts.push(t);
    const n = splitWords(record.lines[p.line].text).length;
    if (p.starts.length >= n) {
      this._commit(p.line, p.starts);
      this.lastLine = { line: p.line, t };
      this.pending = null;
      this.message = `Line ${p.line + 1} saved.`;
    }
    this.paint();
  }

  undo() {
    if (this.pending?.starts.length) {
      this.pending.starts.pop();
      if (!this.pending.starts.length) this.pending = null;
      return this.paint();
    }
    const line = this.history.pop();
    if (line == null) return this.say('Nothing to undo.');
    this.lastLine = null;
    this.host.change(corrections.clearLine(this.host.state().record, line));
    this.say(`Line ${line + 1} is estimated again.`);
  }

  clearLine() {
    const { timeline, record } = this.host.state();
    if (!timeline || !record) return;
    const line = this.pending?.line ?? lineIndexAt(timeline, this.host.drawPosition());
    this.pending = null;
    if (line < 0) return;
    this.host.change(corrections.clearLine(record, line));
    this.say(`Line ${line + 1} is estimated again.`);
  }

  _commit(line, starts) {
    this.host.change(corrections.setLineWords(this.host.state().record, line, starts));
    this.history.push(line);
  }

  globalEarlier() {
    this.host.nudgeGlobal(50);
  }

  globalLater() {
    this.host.nudgeGlobal(-50);
  }

  // ---- strip and dragging ----------------------------------------------------

  _window() {
    const w = this.canvas.clientWidth || 1;
    const center = this.host.drawPosition();
    const from = center - BEFORE_MS;
    return { from, to: center + AFTER_MS, center, pxPerMs: w / (BEFORE_MS + AFTER_MS) };
  }

  _timeAt(x) {
    const win = this._window();
    return win.from + x / win.pxPerMs;
  }

  _dragStart(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hit = this.rects.find((h) => x >= h.x - 3 && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    if (!hit) return;
    const { timeline } = this.host.state();
    const starts = timeline[hit.line].words.map((w) => w.start);
    this.drag = { line: hit.line, word: hit.word, starts, grab: this._timeAt(x) - starts[hit.word], moved: false };
    this.canvas.setPointerCapture(e.pointerId);
  }

  _dragMove(e) {
    const d = this.drag;
    if (!d) {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      this.canvas.style.cursor = this.rects.some((h) => x >= h.x - 3 && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) ? 'ew-resize' : '';
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const lo = d.word > 0 ? d.starts[d.word - 1] + MIN_GAP_MS : -Infinity;
    const hi = d.word + 1 < d.starts.length ? d.starts[d.word + 1] - MIN_GAP_MS : Infinity;
    d.starts[d.word] = Math.round(Math.min(hi, Math.max(lo, this._timeAt(e.clientX - r.left) - d.grab)));
    d.moved = true;
  }

  _dragEnd() {
    const d = this.drag;
    this.drag = null;
    if (!d?.moved) return;
    this._commit(d.line, d.starts);
    this.say(`Line ${d.line + 1} saved.`);
  }

  _dragCancel() {
    this.drag = null;
  }

  // ---- drawing ----------------------------------------------------------------

  frame() {
    if (!this.visible) return;
    this._drawStrip();
    if (performance.now() - this.lastPaint > 250) this.paint();
  }

  _drawStrip() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const win = this._window();
    const x = (t) => (t - win.from) * win.pxPerMs;
    const { timeline } = this.host.state();
    this.rects = [];

    // second ticks
    ctx.fillStyle = 'rgba(244,199,107,0.25)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    for (let s = Math.ceil(win.from / 1000) * 1000; s < win.to; s += 1000) {
      ctx.fillRect(x(s), h - 8, 1, 8);
      if (s >= 0) ctx.fillText(`${Math.floor(s / 60000)}:${String(Math.floor(s / 1000) % 60).padStart(2, '0')}`, x(s) + 3, h - 1);
    }

    if (timeline) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      let i = Math.max(0, lineIndexAt(timeline, win.from) - 1);
      for (; i < timeline.length && timeline[i].time < win.to; i++) {
        const line = timeline[i];
        const dragged = this.drag?.line === i ? this.drag.starts : null;
        const real = line.timing !== 'estimated';
        const row = i % 2;
        line.words.forEach((wd, k) => {
          const start = dragged ? dragged[k] : wd.start;
          const end = dragged ? (k + 1 < dragged.length ? dragged[k + 1] : Math.max(start + 200, wd.end)) : wd.end;
          const bx = x(start);
          const bw = Math.max(4, x(end) - bx - 2);
          if (bx + bw < 0 || bx > w) return;
          const by = 6 + row * 24;
          ctx.fillStyle = real ? 'rgba(244,199,107,0.28)' : 'rgba(255,255,255,0.08)';
          ctx.fillRect(bx, by, bw, 20);
          ctx.fillStyle = real ? GOLD : 'rgba(255,255,255,0.35)';
          ctx.fillRect(bx, by, 2, 20);
          ctx.save();
          ctx.beginPath();
          ctx.rect(bx, by, bw, 20);
          ctx.clip();
          ctx.fillStyle = real ? '#fff3d6' : 'rgba(255,255,255,0.6)';
          ctx.fillText(wd.text, bx + 5, by + 10);
          ctx.restore();
          this.rects.push({ line: i, word: k, x: bx, y: by, w: bw, h: 20 });
        });
      }
    }

    if (this.pending) {
      ctx.fillStyle = GOLD;
      for (const t of this.pending.starts) ctx.fillRect(x(t) - 1, 2, 2, h - 12);
    }
    // playhead
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x(win.center), 0, 1, h);
  }

  paint() {
    if (!this.visible) return;
    this.lastPaint = performance.now();
    const { track, timeline, record } = this.host.state();
    const p = this.parts;
    if (!track || !record) {
      p.status.textContent = track ? 'No timed lyrics for this song. Import an LRC file to add your own.' : 'Nothing playing.';
      p.line.innerHTML = '';
      p.score.textContent = '';
    } else {
      const sung = record.lines.filter((l) => splitWords(l.text).length).length;
      p.status.textContent = `${track.title} · ${corrections.timedLineCount(record)} of ${sung} lines have word times`;
      const idx = this.pending?.line ?? Math.max(0, lineIndexAt(timeline, this.host.drawPosition()));
      const words = splitWords(record.lines[idx]?.text);
      const next = this.pending ? this.pending.starts.length : -1;
      p.line.innerHTML = words
        .map((wd, k) => `<span class="${k < next ? 'done' : k === next ? 'next' : ''}">${esc(wd)}</span>`)
        .join(' ');
      const s = scoreSong({ track: record.track, lines: record.lines });
      p.score.textContent = s.words
        ? `Estimator vs your times: ${Math.round(s.meanAbs)} ms average error, ${Math.round(s.meanAbsAfterOffset)} ms after offset (${s.words} words).`
        : '';
    }
    const o = this.host.offsets();
    p.offsets.textContent = `Song offset ${formatOffset(o.song)} · global ${formatOffset(o.global)} · display latency ${Math.round(o.display)} ms`;
    p.message.textContent = this.message;
  }

  // ---- files ----------------------------------------------------------------------

  exportJson() {
    const { track, record } = this.host.state();
    if (!record) return this.say('Nothing to export.');
    download(corrections.fileName(track, 'json'), corrections.toJson({ ...record, offsetMs: this.host.offsets().song }), 'application/json');
  }

  exportLrc() {
    const { track, record } = this.host.state();
    if (!record) return this.say('Nothing to export.');
    download(corrections.fileName(track, 'lrc'), corrections.toLrc(record), 'text/plain');
  }

  pickFile() {
    if (!this.host.state().track) return this.say('Play the song first, then import its file.');
    this.file.value = '';
    this.file.click();
  }

  async _readFile() {
    const f = this.file.files[0];
    if (!f) return;
    if (f.size > 1_000_000) return this.say('That file is too big for lyrics.');
    try {
      this.say(this.host.importText(await f.text()));
    } catch (e) {
      this.say(e.message);
    }
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
