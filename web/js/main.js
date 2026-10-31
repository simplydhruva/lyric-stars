// App controller: wires sources -> clock -> lyrics -> renderer, and owns UI state.
import * as auth from './auth.js';
import { settings } from './settings.js';
import { PlaybackClock } from './sources/clock.js';
import { SpotifySource } from './sources/spotify.js';
import { MediaSessionSource } from './sources/mediaSession.js';
import { DemoSource } from './sources/demo.js';
import { fetchLyrics, LyricsError } from './lyrics/lrclib.js';
import * as cache from './cache.js';
import { buildTimeline, timelineKind } from './timing.js';
import { Renderer } from './renderer.js';
import { STATES, fill } from './states.js';
import { SpikePanel } from './spike.js';
import { SyncEditor } from './editor.js';
import * as corrections from './corrections.js';
import * as sync from './sync.js';
import { SettingsPanel } from './settings-panel.js';
import { resolveTheme } from './theme.js';
import { albumPalette } from './palette.js';
import { FrameStats } from './perf.js';

const $ = (id) => document.getElementById(id);

export const app = {
  source: null,
  clock: new PlaybackClock(),
  playback: null, // last sample
  track: null,
  lyrics: null, // { status, result, entry }
  timeline: null,
  baseLines: null, // timed lines from the lyric service, before the user's timings
  record: null, // the user's timings for this track (corrections.js)
  palette: null, // album art colors for this track, when album colors are on
  problem: null, // from the source
  authState: null, // 'setup' | 'connect' | error code
  authMessage: '',
  mode: settings.get('mode'),
  loadSeq: 0,
  retryTimer: null,
};

const renderer = new Renderer($('sky'));
const frameStats = (app.frameStats = new FrameStats());
const spike = new SpikePanel($('spike'), app);
const latency = new sync.DisplayLatency();

// Lyric time at a moment: where the song is, shifted by the offsets. Positive offsets show lyrics earlier.
function lyricTime(t) {
  return app.clock.position(t) + sync.globalOffset() + sync.songOffset(app.track?.key);
}
// Frames are drawn ahead by the display delay so a word reaches the screen as it is heard.
function drawPosition() {
  return lyricTime() + latency.ms;
}

const editor = new SyncEditor($('editor'), {
  state: () => ({ track: app.track, timeline: app.timeline, record: app.record }),
  lyricTime,
  drawPosition,
  offsets: () => ({ song: sync.songOffset(app.track?.key), global: sync.globalOffset(), display: latency.ms }),
  change: (record) => saveRecord(record),
  importText: (text) => importTimings(text),
  nudgeGlobal,
});

const settingsPanel = new SettingsPanel($('settings'), {
  onChange: onSettingChange,
  globalOffset: sync.globalOffset,
  nudgeGlobal,
  cacheStats: cache.stats,
  clearCache: cache.clearAll,
  canDisconnect: () => settings.get('source') === 'spotify' && auth.isLoggedIn(),
  disconnect,
});

function nudgeGlobal(ms) {
  const v = sync.setGlobalOffset(sync.globalOffset() + ms);
  toast(`Global offset ${sync.formatOffset(v)}`);
  editor.paint();
  return v;
}

// ---- visuals ---------------------------------------------------------------

function applyVisuals() {
  const g = (k) => settings.get(k);
  renderer.configure({
    theme: resolveTheme({ theme: g('theme'), customColor: g('customColor'), albumColors: g('albumColors') }, app.palette),
    font: g('font'),
    reduceMotion: g('reduceMotion'),
    backgroundStars: g('backgroundStars'),
  });
  updateCorner();
}

function loadPalette(track) {
  app.palette = null;
  if (!track?.art || !settings.get('albumColors')) return;
  albumPalette(track.art).then((palette) => {
    if (app.track?.key !== track.key) return;
    app.palette = palette;
    applyVisuals();
  });
}

function updateCorner() {
  const mode = settings.get('cornerInfo');
  const t = app.track;
  $('corner').hidden = mode === 'off' || !t;
  if (!t) return;
  $('corner-title').textContent = `${t.title} · ${t.artist}`;
  const art = $('corner-art');
  const showArt = mode === 'art' && Boolean(t.art);
  art.hidden = !showArt;
  if (showArt && art.getAttribute('src') !== t.art) art.src = t.art;
}

function onSettingChange(key) {
  if (key === 'source') startSource();
  else if (key === 'mode') {
    app.mode = settings.get('mode');
    updateView();
  } else if (key === 'albumColors') {
    loadPalette(app.track);
    applyVisuals();
  } else applyVisuals();
}

// ---- sources -------------------------------------------------------------

function startSource() {
  app.source?.stop();
  app.source = null;
  app.problem = null;
  app.playback = null;
  const kind = settings.get('source');
  const handlers = { onSample, onProblem };
  if (new URLSearchParams(location.search).has('demo')) {
    app.source = new DemoSource(handlers);
  } else if (kind === 'media-session') {
    app.source = new MediaSessionSource(handlers);
  } else {
    if (!auth.getClientId()) return setAuthState('setup');
    if (!auth.isLoggedIn()) return setAuthState(app.authState && app.authState !== 'setup' ? app.authState : 'connect');
    app.source = new SpotifySource(handlers);
  }
  app.authState = null;
  app.source.start();
  spike.onSourceChanged();
  updateView();
}

function setAuthState(state, message = '') {
  app.authState = state;
  app.authMessage = message;
  updateView();
}

function onProblem(problem) {
  const prev = app.problem?.code;
  app.problem = problem;
  if (problem?.code === 'rate-limited') problem.until = Date.now() + problem.retryInMs;
  if (problem?.code === 'expired') auth.logout();
  if (prev !== problem?.code) updateView();
}

function onSample(sample) {
  app.playback = sample;
  if (sample.kind === 'track') {
    if (sample.track.key !== app.track?.key) onTrackChange(sample.track);
    app.clock.update({
      positionMs: sample.positionMs,
      at: sample.at,
      isPlaying: sample.isPlaying,
      trackKey: sample.track.key,
    });
  } else {
    if (app.track) onTrackChange(null);
    app.clock.update({ positionMs: 0, isPlaying: false, trackKey: sample.kind });
  }
  spike.onSample(sample);
  updateView();
}

function onTrackChange(track) {
  app.track = track;
  app.lyrics = null;
  app.timeline = null;
  app.baseLines = null;
  app.record = null;
  renderer.setTimeline(null); // never leave the previous song's lyrics on screen
  editor.onTrackChange();
  loadPalette(track);
  applyVisuals();
  clearTimeout(app.retryTimer);
  if (track) loadLyrics(track);
}

// ---- lyrics ----------------------------------------------------------------

async function loadLyrics(track, { force = false } = {}) {
  const seq = ++app.loadSeq;
  app.lyrics = { status: 'loading' };
  updateView();
  const cached = await cache.getLyrics(track);
  if (seq !== app.loadSeq) return;
  if (cached?.fresh && !force) return applyLyrics(track, cached.entry, false);

  try {
    const result = await fetchLyrics(track, { rejectIds: cached?.entry.rejectIds || [] });
    if (seq !== app.loadSeq) return;
    const entry = await cache.putLyrics(track, result, { rejectIds: cached?.entry.rejectIds || [] });
    applyLyrics(track, entry, false);
  } catch (e) {
    if (seq !== app.loadSeq) return;
    if (!(e instanceof LyricsError)) throw e;
    if (cached) return applyLyrics(track, cached.entry, e.kind === 'offline');
    app.lyrics = { status: e.kind === 'offline' ? 'lyrics-offline' : 'lyrics-service-down' };
    app.retryTimer = setTimeout(() => app.track?.key === track.key && loadLyrics(track), 15_000);
    updateView();
  }
}

async function applyLyrics(track, entry, offline) {
  const seq = app.loadSeq;
  const result = entry.result;
  const saved = await cache.getValue(corrections.key(track));
  if (seq !== app.loadSeq) return;
  app.lyrics = { status: result.status, result, entry, offline };
  app.baseLines = result.status === 'synced' ? result.lines : null;
  const recordId = result.record?.id ?? null;
  // Timings saved for other lyrics (the match changed since) are not applied to these.
  const usable = saved && (saved.ownLyrics || corrections.apply(app.baseLines, saved));
  app.record = usable ? saved : app.baseLines ? corrections.create(track, app.baseLines, { recordId }) : null;
  rebuildTimeline();
  spike.onLyrics();
}

function rebuildTimeline() {
  const lines = app.record ? corrections.apply(app.baseLines, app.record) : app.baseLines;
  if (app.record?.ownLyrics) app.lyrics = { ...app.lyrics, status: 'synced', own: true };
  app.timeline = lines ? buildTimeline(lines, { trackDurationMs: app.track?.durationMs }) : null;
  renderer.setTimeline(app.timeline);
  editor.paint();
  updateView();
}

async function saveRecord(record) {
  const track = app.track;
  if (!track) return;
  app.record = record;
  rebuildTimeline();
  try {
    await cache.putValue(corrections.key(track), record);
  } catch {
    editor.say('Could not save your timings. Is the Lyric Stars server still running?');
  }
}

function importTimings(text) {
  const track = app.track;
  const record = corrections.parseImport(text, track, app.baseLines);
  if (Number.isFinite(record.offsetMs)) sync.setSongOffset(track.key, record.offsetMs);
  delete record.offsetMs;
  saveRecord(record);
  const timed = corrections.timedLineCount(record);
  return record.ownLyrics
    ? `Using your lyrics for this song (${record.lines.length} lines, ${timed} with word times).`
    : `Imported word times for ${timed} lines.`;
}

function nudgeSongOffset(ms) {
  if (!app.track) return;
  const v = sync.setSongOffset(app.track.key, sync.songOffset(app.track.key) + ms);
  toast(`Offset ${sync.formatOffset(v)} for this song`);
  editor.paint();
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1600);
}

async function rejectCurrentLyrics() {
  const track = app.track;
  const id = app.lyrics?.result?.record?.id;
  if (!track || id == null) return;
  const rejectIds = [...new Set([...(app.lyrics.entry?.rejectIds || []), id])];
  await cache.putLyrics(track, { status: 'notfound' }, { rejectIds, savedAt: 0 });
  app.timeline = null;
  app.baseLines = null;
  app.record = null;
  renderer.setTimeline(null);
  loadLyrics(track, { force: true });
}

// ---- view ------------------------------------------------------------------

function currentStateKey() {
  if (app.authState) {
    if (app.authState === 'wrong-client-id' && auth.hasBuiltInClientId()) return 'wrong-client-id-builtin';
    return app.authState;
  }
  const p = app.problem?.code;
  if (['expired', 'not-allowlisted', 'refused', 'media-session-unavailable'].includes(p)) return p;
  const pb = app.playback;
  if (!pb) return null;
  if (pb.kind === 'idle') return app.source?.name === 'media-session' ? 'idle-media-session' : 'idle';
  if (pb.kind === 'ad' || pb.kind === 'podcast') return pb.kind;
  const ls = app.lyrics?.status;
  if (['notfound', 'plain', 'instrumental', 'lyrics-offline', 'lyrics-service-down'].includes(ls)) return ls;
  return null;
}

function chipKey() {
  const p = app.problem?.code;
  if (p === 'rate-limited' || p === 'spotify-down') return p;
  if (p === 'offline' || app.lyrics?.offline) return 'offline';
  if (app.lyrics?.status === 'loading') return 'loading';
  if (app.playback?.buffering) return 'buffering';
  if (app.playback?.kind === 'track' && !app.playback.isPlaying) return 'paused';
  return null;
}

const TIMING_LABELS = { word: 'word-timed', yours: 'your timing', estimated: 'estimated' };

function updateView() {
  const key = currentStateKey();
  const vars = {
    message: app.authMessage || app.problem?.message || '',
    title: app.playback?.track?.title || 'Podcast episode',
    track: app.track ? `${app.track.title} · ${app.track.artist}` : '',
    seconds: app.problem?.until ? Math.max(0, Math.ceil((app.problem.until - Date.now()) / 1000)) : '',
  };

  $('setup').hidden = key !== 'setup';
  if (key === 'setup') {
    $('redirect-uri').textContent = auth.redirectUri();
    $('client-id').value ||= auth.getClientId();
  }

  const s = key && key !== 'setup' ? STATES[key] : null;
  const card = $('card');
  card.hidden = !s;
  if (s) {
    card.classList.toggle('soft', Boolean(s.soft));
    $('card-title').textContent = fill(s.title, vars);
    $('card-text').textContent = fill(s.text, vars);
    const b = $('card-button');
    b.hidden = !s.button;
    if (s.button) {
      b.textContent = s.button.label;
      b.dataset.action = s.button.action;
    }
  }

  const ck = chipKey();
  $('chip').hidden = !ck;
  if (ck) $('chip').textContent = fill(STATES[ck].chip, vars);

  $('timing').hidden = !app.timeline;
  if (app.timeline) $('timing').textContent = TIMING_LABELS[timelineKind(app.timeline)];
  $('btn-wrong').hidden = app.lyrics?.result?.record?.id == null || app.lyrics.status === 'notfound' || app.lyrics.own;
  $('btn-mode').textContent = app.mode === 'word' ? 'Word by word' : 'Line by line';
  $('btn-disconnect').hidden = settings.get('source') !== 'spotify' || !auth.isLoggedIn();
}

// Keep the rate-limit countdown ticking.
setInterval(() => app.problem?.code === 'rate-limited' && updateView(), 1000);

// ---- actions ---------------------------------------------------------------

const actions = {
  login: () => auth.beginLogin(),
  setup: () => setAuthState('setup'),
  'use-media-session': () => {
    settings.set('source', 'media-session');
    startSource();
  },
  'use-spotify': () => {
    settings.set('source', 'spotify');
    startSource();
  },
  'retry-source': () => startSource(),
  'retry-lyrics': () => app.track && loadLyrics(app.track, { force: true }),
};

$('card-button').addEventListener('click', (e) => actions[e.currentTarget.dataset.action]?.());

$('copy-redirect').addEventListener('click', async (e) => {
  try {
    await navigator.clipboard.writeText(auth.redirectUri());
    e.currentTarget.textContent = 'Copied';
  } catch {
    e.currentTarget.textContent = 'Select and copy';
  }
});

$('setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('client-id').value.trim();
  const err = $('setup-error');
  if (!auth.isValidClientIdFormat(id)) {
    err.textContent = 'That doesn’t look like a Client ID. It should be 32 letters and numbers, from your app’s Settings page.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  auth.setClientId(id);
  auth.logout();
  setAuthState('connect');
});

function toggleMode() {
  app.mode = app.mode === 'word' ? 'line' : 'word';
  settings.set('mode', app.mode);
  settingsPanel.render();
  updateView();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

$('btn-mode').addEventListener('click', toggleMode);
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
$('btn-wrong').addEventListener('click', rejectCurrentLyrics);
$('btn-spike').addEventListener('click', toggleSpike);
$('btn-editor').addEventListener('click', toggleEditor);

// The two panels share Space, so only one is open at a time.
function toggleSpike() {
  if (editor.visible) editor.toggle();
  spike.toggle();
}
function toggleEditor() {
  if (spike.visible) spike.toggle();
  editor.toggle();
}
$('btn-settings').addEventListener('click', () => settingsPanel.toggle());
$('btn-disconnect').addEventListener('click', disconnect);

function disconnect() {
  auth.logout();
  app.source?.stop();
  app.source = null;
  onTrackChange(null);
  app.playback = null;
  setAuthState('connect');
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    const step = e.shiftKey ? sync.FINE_STEP_MS : sync.OFFSET_STEP_MS;
    nudgeSongOffset(e.code === 'BracketLeft' ? step : -step);
  } else if (k === 'f') toggleFullscreen();
  else if (k === 'm') toggleMode();
  else if (k === 'd') toggleSpike();
  else if (k === 'e') toggleEditor();
  else if (k === 's') settingsPanel.toggle();
  else if (k === 'escape' && (settingsPanel.visible || editor.visible || spike.visible)) {
    if (settingsPanel.visible) settingsPanel.toggle();
    if (editor.visible) editor.toggle();
    if (spike.visible) spike.toggle();
  }
  else if (k === ' ' && editor.visible) {
    e.preventDefault();
    if (!e.repeat) editor.tap(e.timeStamp);
  } else if (k === 'backspace' && editor.visible) {
    e.preventDefault();
    editor.undo();
  } else if (k === ' ' && spike.visible) {
    e.preventDefault();
    spike.tap();
  } else if (app.source?.name === 'demo' && (k === 'p' || k === 'arrowleft' || k === 'arrowright')) {
    // Demo only: P pauses, arrows seek 10 s, to exercise re-sync.
    if (k === 'p') app.source.togglePause();
    else app.source.seek(k === 'arrowleft' ? -10_000 : 10_000);
  } else return;
  showControls();
});

// Controls hide after a few seconds without mouse movement.
let hideTimer;
function showControls() {
  document.body.classList.remove('controls-hidden', 'idle-cursor');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (document.querySelector('#controls:hover')) return showControls();
    document.body.classList.add('controls-hidden', 'idle-cursor');
  }, 3000);
}
window.addEventListener('mousemove', showControls);
window.addEventListener('pointerdown', showControls);

// ---- frame loop --------------------------------------------------------------

function frame(now) {
  latency.tick(now);
  const t0 = performance.now();
  if (renderer.draw(drawPosition(), { mode: app.mode, playing: app.clock.playing, now })) frameStats.add(now, performance.now() - t0);
  spike.frame(app.clock.position());
  editor.frame();
  requestAnimationFrame(frame);
}

// ---- boot ----------------------------------------------------------------------

async function boot() {
  showControls();
  applyVisuals();
  // Follow Windows "Animation effects" while the user hasn't chosen.
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyVisuals);
  try {
    await auth.handleRedirect();
    app.authState = null;
  } catch (e) {
    const code = e.code === 'denied' ? 'login-denied' : e.code === 'wrong-client-id' ? 'wrong-client-id' : 'login-failed';
    app.authState = code;
    app.authMessage = e.message;
  }
  startSource();
  requestAnimationFrame(frame);
}

boot();
