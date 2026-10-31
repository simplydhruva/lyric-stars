// Diagnostics panel for the milestone-1 spike:
//  1. Is the Spotify playback endpoint available to this Development Mode app?
//  2. How accurate is each source's position against what you actually hear?
//  3. How often does the Windows media session update its position?
import { PlaybackClock } from './sources/clock.js';
import { SpotifySource, spotifyGet, CURRENTLY_PLAYING_URL } from './sources/spotify.js';
import { MediaSessionSource } from './sources/mediaSession.js';
import { isLoggedIn } from './auth.js';
import { simplify } from './lyrics/match.js';

const TAP_WINDOW_MS = 1500;
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (ms) => (ms == null || Number.isNaN(ms) ? '–' : `${ms > 0 ? '+' : ''}${Math.round(ms)} ms`);
const time = (ms) => {
  if (ms == null) return '–';
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};

function summarize(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const meanAbs = values.reduce((a, b) => a + Math.abs(b), 0) / values.length;
  return { n: values.length, mean, median: sorted[sorted.length >> 1], sd, meanAbs };
}

export class SpikePanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.visible = false;
    this.shadow = null;
    this.shadowClock = new PlaybackClock();
    this.shadowSample = null;
    this.primarySample = null;
    this.endpoint = null;
    this.taps = [];
    this.smtc = { lastUpdated: null, intervals: [] };
    this.lastPaint = 0;
    this.flash = '';
    el.addEventListener('click', (e) => {
      const action = e.target.closest('[data-spike]')?.dataset.spike;
      if (action) this[action]?.();
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    if (this.visible) this.paint();
    else this.stopCompare();
  }

  // ---- hooks from the app ----

  onSourceChanged() {
    this.stopCompare();
    this.paint();
  }

  onSample(sample) {
    this.primarySample = { ...sample, receivedAt: performance.now() };
    if (this.app.source?.name === 'media-session') this._trackSmtc(this.app.source.last);
  }

  onLyrics() {
    this.paint();
  }

  frame() {
    if (this.visible && performance.now() - this.lastPaint > 250) this.paint();
  }

  // ---- comparison source ----

  compare() {
    if (this.shadow) return this.stopCompare();
    const primary = this.app.source?.name;
    const handlers = {
      onSample: (s) => {
        this.shadowSample = { ...s, receivedAt: performance.now() };
        if (s.kind === 'track') {
          this.shadowClock.update({ positionMs: s.positionMs, at: s.at, isPlaying: s.isPlaying, trackKey: s.track.key });
        }
        if (this.shadow?.name === 'media-session') this._trackSmtc(this.shadow.last);
      },
      onProblem: (p) => (this.shadowProblem = p),
    };
    if (primary === 'spotify') this.shadow = new MediaSessionSource(handlers);
    else if (isLoggedIn()) this.shadow = new SpotifySource(handlers);
    else {
      this.flash = 'Log in to Spotify first to compare with the Web API.';
      return this.paint();
    }
    this.shadowClock.reset();
    this.shadowProblem = null;
    this.shadow.start();
    this.paint();
  }

  stopCompare() {
    this.shadow?.stop();
    this.shadow = null;
    this.shadowSample = null;
  }

  _trackSmtc(d) {
    if (!d?.lastUpdatedMs) return;
    const s = this.smtc;
    if (s.lastUpdated != null && d.lastUpdatedMs !== s.lastUpdated) {
      s.intervals.push(d.lastUpdatedMs - s.lastUpdated);
      if (s.intervals.length > 40) s.intervals.shift();
    }
    s.lastUpdated = d.lastUpdatedMs;
  }

  // ---- endpoint check ----

  async checkEndpoint() {
    if (!isLoggedIn()) {
      this.endpoint = { error: 'Not logged in to Spotify.' };
      return this.paint();
    }
    this.endpoint = { pending: true };
    this.paint();
    const results = {};
    for (const [name, url] of [
      ['GET /me/player/currently-playing', CURRENTLY_PLAYING_URL],
      ['GET /me/player', 'https://api.spotify.com/v1/me/player?additional_types=episode'],
    ]) {
      try {
        const r = await spotifyGet(url);
        results[name] = { ok: true, status: r.status, latency: Math.round(r.receivedAt - r.sentAt) };
      } catch (e) {
        results[name] = { ok: false, status: e.status ?? e.code, message: e.message };
      }
    }
    this.endpoint = { results, at: new Date().toLocaleTimeString() };
    this.paint();
  }

  // ---- tap test ----

  _sameTrack() {
    const a = this.primarySample?.track;
    const b = this.shadowSample?.track;
    return a && b && simplify(a.title) === simplify(b.title);
  }

  tap() {
    const t = performance.now();
    const timeline = this.app.timeline;
    if (!timeline) {
      this.flash = 'Tap test needs a song with synced lyrics playing.';
      return this.paint();
    }
    const est = { [this.app.source.name]: this.app.clock.position(t) };
    if (this.shadow && this._sameTrack()) est[this.shadow.name] = this.shadowClock.position(t);

    let best = null;
    for (const line of timeline) {
      if (!line.words.length) continue;
      const d = Math.abs(line.time - est[this.app.source.name]);
      if (d <= TAP_WINDOW_MS && (!best || d < best.d)) best = { d, line };
    }
    if (!best) {
      this.flash = 'No line start near that tap. Tap right when a line begins.';
      return this.paint();
    }
    const errors = {};
    for (const [name, pos] of Object.entries(est)) errors[name] = Math.round(pos - best.line.time);
    this.taps.push({ track: this.app.track?.title, line: best.line.text, lineTime: best.line.time, errors });
    this.flash = `Tap: ${Object.entries(errors).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}`;
    this.paint();
  }

  resetTaps() {
    this.taps = [];
    this.flash = '';
    this.paint();
  }

  async copyResults() {
    const data = {
      at: new Date().toISOString(),
      endpoint: this.endpoint?.results,
      smtcUpdateIntervalsMs: this.smtc.intervals,
      summary: this._summaries(),
      taps: this.taps,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      this.flash = 'Results copied to the clipboard.';
    } catch {
      console.log(data);
      this.flash = 'Clipboard blocked; results printed to the console.';
    }
    this.paint();
  }

  _summaries() {
    const names = new Set(this.taps.flatMap((t) => Object.keys(t.errors)));
    const out = {};
    for (const n of names) out[n] = summarize(this.taps.map((t) => t.errors[n]).filter((v) => v != null));
    return out;
  }

  // ---- painting ----

  _sourceRow(name, clock, sample, source, problem) {
    const age = sample ? Math.round(performance.now() - sample.receivedAt) : null;
    const st = clock.stats;
    let state = problem?.code || sample?.kind || 'starting';
    if (sample?.kind === 'track') state = sample.isPlaying ? 'playing' : sample.buffering ? 'buffering' : 'paused';
    const latency = source?.last?.latency;
    return `<tr><td>${name}</td><td>${state}</td><td>${time(sample?.positionMs)}</td><td>${time(clock.position())}</td>
      <td>${fmt(st.lastDrift)}</td><td>${st.resyncs}</td><td>${age == null ? '–' : `${age} ms`}${latency != null ? ` / ${latency} ms` : ''}</td></tr>`;
  }

  _skeleton() {
    this.el.innerHTML = `
      <h2>Now playing</h2>
      <div data-part="now"></div>
      <h2>Spotify endpoint access</h2>
      <div data-part="endpoint"></div>
      <div class="row"><button data-spike="checkEndpoint">Check now</button></div>
      <h2>Rendering</h2>
      <div data-part="render"></div>
      <h2>Sources</h2>
      <div data-part="sources"></div>
      <div class="row"><button data-spike="compare" data-part="compare"></button></div>
      <h2>Position accuracy (tap test)</h2>
      <p>Play a song with synced lyrics. Press <b>Space</b> exactly when you hear a line begin. Positive numbers mean the source runs ahead of the audio.</p>
      <div data-part="taps"></div>
      <div class="row"><button data-spike="tap">Tap</button><button data-spike="resetTaps">Reset</button><button data-spike="copyResults">Copy results</button></div>
      <p>Press D to close.</p>`;
    this.parts = {};
    for (const n of this.el.querySelectorAll('[data-part]')) this.parts[n.dataset.part] = n;
  }

  // Only the parts without buttons are rewritten, so clicks are never lost mid-press.
  paint() {
    if (!this.visible) return;
    if (!this.parts) this._skeleton();
    this.lastPaint = performance.now();
    const app = this.app;
    const primary = app.source?.name || 'none';
    const rows = [this._sourceRow(primary, app.clock, this.primarySample, app.source, app.problem)];
    if (this.shadow) rows.push(this._sourceRow(this.shadow.name, this.shadowClock, this.shadowSample, this.shadow, this.shadowProblem));
    const diff = this.shadow && this._sameTrack() ? app.clock.position() - this.shadowClock.position() : null;

    let endpoint = '<p>Checks whether this Development Mode app may read playback.</p>';
    if (this.endpoint?.pending) endpoint = '<p>Checking…</p>';
    else if (this.endpoint?.error) endpoint = `<p class="bad">${esc(this.endpoint.error)}</p>`;
    else if (this.endpoint?.results) {
      endpoint = Object.entries(this.endpoint.results)
        .map(([k, r]) => {
          const verdict = r.ok ? (r.status === 204 ? 'available (nothing playing)' : 'available') : `refused: ${esc(r.message)}`;
          return `<p class="${r.ok ? 'ok' : 'bad'}"><code>${k}</code> → ${esc(r.status)} ${verdict}${r.latency ? ` · ${r.latency} ms` : ''}</p>`;
        })
        .join('') + `<p>Checked ${this.endpoint.at}</p>`;
    }

    const fs = app.frameStats?.summary(performance.now());
    const render = fs
      ? `<p>${fs.fps.toFixed(0)} paints/s · ${fs.meanMs.toFixed(2)} ms average, ${fs.p95Ms.toFixed(2)} ms p95 · ${fs.longFrames} late frames (2 s) · ${innerWidth}×${innerHeight} @${devicePixelRatio}x</p>`
      : '';

    const iv = [...this.smtc.intervals].sort((a, b) => a - b);
    const smtc = iv.length
      ? `<p>Media session position updates every ~${(iv[iv.length >> 1] / 1000).toFixed(2)} s (median of ${iv.length}). Positions in between are extrapolated locally.</p>`
      : '<p>Media session update interval: no data yet.</p>';

    const sums = this._summaries();
    const sumRows = Object.entries(sums)
      .map(([n, s]) => `<tr><td>${n}</td><td>${s.n}</td><td>${fmt(s.mean)}</td><td>${fmt(s.median)}</td><td>${Math.round(s.sd)} ms</td><td>${Math.round(s.meanAbs)} ms</td></tr>`)
      .join('');
    const entries = Object.entries(sums).filter(([, s]) => s && s.n >= 10);
    let verdict = '';
    if (entries.length === 2) {
      const winner = entries[0][1].sd <= entries[1][1].sd ? entries[0] : entries[1];
      verdict = `<p class="ok">More consistent: <b>${winner[0]}</b> (spread ${Math.round(winner[1].sd)} ms). Its mean error is the offset to correct.</p>`;
    }

    const t = app.track;
    const rec = app.lyrics?.result?.record;
    this.parts.now.innerHTML = `
      <p data-part="from">From: ${esc(sourceLabel(app))}</p>
      <p>${t ? `${esc(t.title)} · ${esc(t.artist)} · ${time(t.durationMs)}` : 'No track'}</p>
      <p>Lyrics: ${esc(app.lyrics?.status || '–')}${rec ? ` · LRCLIB #${rec.id} (${rec.duration}s)` : ''}${app.lyrics?.offline ? ' · from cache, offline' : ''}</p>`;
    this.parts.endpoint.innerHTML = endpoint;
    this.parts.render.innerHTML = render;
    this.parts.sources.innerHTML = `
      <table>
        <tr><th>Source</th><th>State</th><th>Reported</th><th>Estimate</th><th>Drift</th><th>Resyncs</th><th>Age / RTT</th></tr>
        ${rows.join('')}
      </table>
      ${diff != null ? `<p>Difference between sources: <b>${fmt(diff)}</b></p>` : ''}
      ${smtc}`;
    this.parts.compare.textContent = this.shadow
      ? 'Stop comparing'
      : `Compare with ${primary === 'spotify' ? 'Windows media session' : 'Spotify Web API'}`;
    this.parts.taps.innerHTML = `
      ${sumRows ? `<table><tr><th>Source</th><th>Taps</th><th>Mean</th><th>Median</th><th>Spread</th><th>|Err|</th></tr>${sumRows}</table>` : ''}
      ${verdict}
      ${this.flash ? `<p class="tap-flash">${esc(this.flash)}</p>` : ''}`;
  }
}

// "Automatic · Edge on this PC", "Spotify account", …
function sourceLabel(app) {
  const src = app.source;
  if (!src) return 'nothing yet';
  const pb = app.playback;
  const where =
    src.name === 'spotify' ? 'Spotify account' : src.name === 'media-session' ? `${pb?.player || 'media player'} on this PC` : src.name === 'demo' ? 'demo' : 'waiting';
  return src.kind === 'auto' ? `Automatic · ${where}${src.followsAccount ? '' : ' (no login)'}` : where;
}
