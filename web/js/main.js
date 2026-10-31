// App controller: wires sources -> clock -> lyrics -> renderer, and owns UI state.
import * as auth from './auth.js';
import { settings, store } from './settings.js';
import { PlaybackClock } from './sources/clock.js';
import { SpotifySource } from './sources/spotify.js';
import { MediaSessionSource } from './sources/mediaSession.js';
import { DemoSource } from './sources/demo.js';
import { AutoSource } from './sources/auto.js';
import { fetchLyrics, LyricsError } from './lyrics/lrclib.js';
import * as cache from './cache.js';
import { buildTimeline, timelineKind } from './timing.js';
import { Renderer } from './renderer.js';
import { STATES, SCENE_LABELS, fill } from './states.js';
import { NowPlaying } from './now-playing.js';
import { PlayerBar } from './player-bar.js';
import { PlayerControl } from './player-control.js';
import { commands as spotifyCommands } from './spotify-control.js';
import { SpikePanel, sourceLabel } from './spike.js';
import { buildReport, formatReport, watchErrors, recordError } from './report.js';
import { SyncEditor } from './editor.js';
import * as corrections from './corrections.js';
import * as sync from './sync.js';
import { SettingsPanel } from './settings-panel.js';
import { resolveTheme } from './theme.js';
import { albumPalette } from './palette.js';
import { FrameStats } from './perf.js';

const $ = (id) => document.getElementById(id);
// The desktop app's bridge (electron/preload.cjs), or null in a normal browser.
const desktop = globalThis.lyricStars || null;

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
  plays: Math.floor(Math.random() * 1e9), // counts track changes; seeds each play's sky
  retryTimer: null,
  desktop: desktop?.info() || null, // { style, overlay, update, ... } from the desktop shell
};

watchErrors();
const renderer = new Renderer($('sky'));
const frameStats = (app.frameStats = new FrameStats());
const spike = new SpikePanel($('spike'), app);
const latency = new sync.DisplayLatency();

// Diagnostics → Copy report.
app.makeReport = () =>
  formatReport(
    buildReport({
      app,
      env: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        online: navigator.onLine,
        screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
        window: `${innerWidth}×${innerHeight}`,
      },
      settings: store.get('ls.settings') || {},
      offsets: { global: sync.globalOffset(), song: sync.songOffset(app.track?.key), display: Math.round(latency.ms) },
      sourceLabel: sourceLabel(app),
      loggedIn: auth.isLoggedIn(),
      builtInClientId: auth.hasBuiltInClientId(),
      timingKind: app.timeline ? timelineKind(app.timeline) : null,
    })
  );

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
  canDisconnect: () => accountShown(),
  disconnect,
  desktop: desktop && (() => ({ info: app.desktop, bridge: desktop })),
});

// ---- player: the no-lyrics scene and the control bar ---------------------------

const nowPlaying = new NowPlaying($('np'), { onRetry: retryLyrics });
const bar = new PlayerBar($('player'), {
  previous: () => control.previous(),
  playPause: () => control.playPause(),
  next: () => control.next(),
  seek: (ms) => control.seek(ms),
});
const COMMANDS = ['play', 'pause', 'next', 'previous', 'seek'];
const control = new PlayerControl({
  // The demo has its own pretend player; everything else goes to the Spotify account.
  sender: Object.fromEntries(
    COMMANDS.map((name) => [name, (...args) => (app.source?.name === 'demo' ? app.source.commands() : spotifyCommands)[name](...args)])
  ),
  state: () => {
    const track = app.playback?.kind === 'track' ? app.playback.track : null;
    return {
      available: controlsAvailable(),
      trackKey: track?.key,
      durationMs: track?.durationMs || 0,
      isPlaying: app.clock.playing,
      positionMs: app.clock.position(),
    };
  },
  apply: applyPlayback,
  refresh: () => app.source?.pollNow?.(),
  onError: onControlError,
});

function controlsAvailable() {
  if (app.authState || app.playback?.kind !== 'track') return false;
  return app.source?.name === 'demo' || accountShown();
}

// Show a press at once; the next poll from the source confirms it.
function applyPlayback({ isPlaying, positionMs }) {
  const pb = app.playback;
  if (pb?.kind !== 'track') return;
  const at = performance.now();
  app.playback = { ...pb, isPlaying, positionMs, at };
  app.clock.update({ positionMs, at, isPlaying, trackKey: pb.track.key });
  updateView();
}

function onControlError(e) {
  recordError(`control: ${e.code || 'error'}`);
  showControls();
  if (e.code === 'scope') {
    // Logins from before the player bar can't control playback; ask Spotify again.
    bar.say('Lyric Stars needs your permission to control Spotify. Opening the Spotify login…');
    setTimeout(() => actions.login(), 1500);
  } else bar.say(e.message || 'Spotify could not do that.');
}

function retryLyrics() {
  nowPlaying.busy = true;
  actions['retry-lyrics']();
}

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
    spread: g('spread'),
    chaos: g('chaos'),
    transparent: app.desktop?.style === 'overlay',
  });
  nowPlaying.setStill(Boolean(g('reduceMotion')));
  updateCorner();
}

// Desktop shell state: display style, overlay look, update notice.
function applyDesktop(info) {
  const prev = app.desktop;
  app.desktop = info;
  const overlay = info.style === 'overlay';
  const root = document.documentElement;
  root.classList.toggle('overlay', overlay);
  root.classList.toggle('click-through', overlay && info.overlay.clickThrough);
  root.style.setProperty('--backdrop', String(info.overlay.backdrop));
  $('grip').hidden = !overlay;
  $('btn-overlay').hidden = false;
  $('btn-overlay').textContent = overlay ? 'Window' : 'Overlay';
  $('btn-fullscreen').hidden = overlay;
  $('btn-fullscreen').textContent = info.style === 'fullscreen' ? 'Exit fullscreen' : 'Fullscreen';
  if (prev && overlay && info.overlay.clickThrough !== prev.overlay.clickThrough) {
    toast(info.overlay.clickThrough ? `Click-through on · ${shortcut(info.shortcuts.toggleClickThrough)} turns it off` : 'Click-through off');
  }
  if (info.update?.available && !prev?.update?.available) toast(`Lyric Stars ${info.update.version} is available · Settings → Desktop app`);
  applyVisuals();
  // Don't rebuild the panel under a slider being dragged.
  if (!document.activeElement?.matches('#settings input[type=range]')) settingsPanel.render();
}

const shortcut = (accel) => accel.replace('Control', 'Ctrl');


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
  } else if (key === 'fullFrameRate') fullFrameRate = settings.get('fullFrameRate');
  else applyVisuals();
}

// ---- sources -------------------------------------------------------------

function startSource() {
  app.source?.stop();
  app.source = null;
  app.problem = null;
  app.playback = null;
  if (app.track) onTrackChange(null); // the new source says what is playing
  const kind = settings.get('source');
  const handlers = { onSample, onProblem };
  if (new URLSearchParams(location.search).has('demo')) {
    app.source = new DemoSource(handlers);
  } else if (kind === 'media-session') {
    app.source = new MediaSessionSource(handlers);
  } else if (kind === 'auto' && ON_WINDOWS && (auth.isLoggedIn() || settings.get('noLogin'))) {
    app.source = new AutoSource(handlers, { useAccount: auth.isLoggedIn() });
  } else {
    // Automatic on Windows offers "Use without logging in" first; setup waits for Connect.
    if (!auth.getClientId()) return setAuthState(kind === 'auto' && ON_WINDOWS ? 'connect' : 'setup');
    // Keep a login error (and its message) on screen until the user acts on it.
    if (!auth.isLoggedIn()) return app.authState && app.authState !== 'setup' ? setAuthState(app.authState, app.authMessage) : setAuthState('connect');
    app.source = new SpotifySource(handlers);
  }
  app.authState = null;
  app.source.start();
  spike.onSourceChanged();
  updateView();
}

// Automatic needs the Windows media session; elsewhere it is the Spotify account.
const ON_WINDOWS = /Windows/.test(navigator.userAgent);

function accountShown() {
  return settings.get('source') !== 'media-session' && auth.isLoggedIn();
}

function setAuthState(state, message = '') {
  app.authState = state;
  app.authMessage = message;
  updateView();
}

function onProblem(problem) {
  const prev = app.problem?.code;
  if (problem && problem.code !== prev) recordError(`source: ${problem.code}${problem.message ? ` (${problem.message})` : ''}`);
  app.problem = problem;
  if (problem?.code === 'rate-limited') problem.until = Date.now() + problem.retryInMs;
  if (problem?.code === 'expired') auth.logout();
  if (prev !== problem?.code) updateView();
}

function onSample(sample) {
  if (control.holding(sample)) return; // older than the button just pressed
  app.playback = sample;
  if (sample.kind === 'track') {
    if (sample.track.key !== app.track?.key) onTrackChange(sample.track);
    else if (sample.track.art !== app.track.art || sample.track.artLarge !== app.track.artLarge) {
      // The cover showed up after the song did (the PC's Spotify app has none; the account does).
      app.track = sample.track;
      loadPalette(sample.track);
      applyVisuals();
    }
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
  app.plays++;
  nowPlaying.busy = false;
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
    recordError(`lyrics: ${e.kind} (${e.message})`);
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
  renderer.setTimeline(app.timeline, `${app.track?.key}|${app.plays}`);
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
  if (pb.kind === 'idle') {
    if (app.source?.kind === 'auto') return app.source.followsAccount ? 'idle' : 'idle-local';
    return app.source?.name === 'media-session' ? 'idle-media-session' : 'idle';
  }
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

// The scene's status text when it should be on screen, else null.
function sceneFor(key) {
  if (!app.track || app.playback?.kind !== 'track') return null;
  if (key === 'notfound' || key === 'instrumental') return nowPlaying.busy ? SCENE_LABELS.searching : SCENE_LABELS[key];
  if (key == null && nowPlaying.busy && app.lyrics?.status === 'loading') return SCENE_LABELS.searching;
  return null;
}

const TIMING_LABELS ={ word: 'word-timed', yours: 'your timing', estimated: 'estimated' };

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

  // No lyrics to show: a now-playing scene takes the place of the empty screen.
  if (app.lyrics?.status !== 'loading') nowPlaying.busy = false;
  const sceneLabel = sceneFor(key);
  if (sceneLabel) {
    nowPlaying.show({ track: app.track, identity: `${app.track.key}|${app.plays}`, label: sceneLabel, busy: nowPlaying.busy });
    nowPlaying.setPlaying(Boolean(app.playback.isPlaying));
  } else if (nowPlaying.visible) nowPlaying.hide();
  document.body.classList.toggle('np-on', Boolean(sceneLabel));
  bar.setAvailable(control.available);

  const s = key && key !== 'setup' && !sceneLabel ? STATES[key] : null;
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
    // "Use without logging in" needs the Windows media session.
    const local = $('card-local');
    local.hidden = !s.local || !ON_WINDOWS;
    if (s.local) {
      local.textContent = s.local.label;
      local.dataset.action = s.local.action;
    }
  }

  let ck = chipKey();
  if (sceneLabel && (ck === 'loading' || ck === 'paused')) ck = null; // the scene already says so
  $('chip').hidden = !ck;
  if (ck) $('chip').textContent = fill(STATES[ck].chip, vars);

  $('timing').hidden = !app.timeline;
  if (app.timeline) $('timing').textContent = TIMING_LABELS[timelineKind(app.timeline)];
  $('btn-wrong').hidden = app.lyrics?.result?.record?.id == null || app.lyrics.status === 'notfound' || app.lyrics.own;
  $('btn-mode').textContent = app.mode === 'word' ? 'Word by word' : 'Line by line';
  $('btn-disconnect').hidden = !accountShown();
}

// Keep the rate-limit countdown ticking.
setInterval(() => app.problem?.code === 'rate-limited' && updateView(), 1000);

// ---- actions ---------------------------------------------------------------

const actions = {
  login: async () => {
    if (!auth.getClientId()) return setAuthState('setup');
    if ((await auth.beginLogin()) === 'browser') setAuthState('login-in-browser');
  },
  setup: () => setAuthState('setup'),
  // Follow this PC only, no account: the fallback for anyone not on the user list.
  'use-local': () => {
    if (app.problem?.code === 'not-allowlisted' || app.problem?.code === 'refused') auth.logout();
    settings.set('noLogin', true);
    if (settings.get('source') === 'spotify') settings.set('source', 'auto');
    app.authState = null;
    startSource();
  },
  'use-spotify': () => {
    settings.set('source', 'spotify');
    startSource();
  },
  'retry-source': () => startSource(),
  'retry-lyrics': () => app.track && loadLyrics(app.track, { force: true }),
};

for (const id of ['card-button', 'card-local']) $(id).addEventListener('click', (e) => actions[e.currentTarget.dataset.action]?.());

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
  if (desktop) return desktop.toggleFullscreen();
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

$('btn-mode').addEventListener('click', toggleMode);
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
$('btn-overlay').addEventListener('click', () => desktop?.toggleOverlay());
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
  settings.set('noLogin', false);
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
  else if (k === 'o' && desktop) desktop.toggleOverlay();
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
  } else if (control.available && playerKey(e, k)) {
    e.preventDefault();
    if (!e.repeat) {
      if (e.target.closest?.('#player')) e.target.blur(); // or Space would also press the focused button
      if (k === ' ') control.playPause();
      else if (k === 'arrowleft') control.previous();
      else control.next();
    }
  } else return;
  showControls();
});

// Space, Left and Right drive the player, except Space on a button elsewhere, which presses it.
function playerKey(e, k) {
  if (k === 'arrowleft' || k === 'arrowright') return true;
  return k === ' ' && !(e.target.closest?.('button') && !e.target.closest('#player'));
}

// Controls hide after 3 seconds without mouse movement and return on movement.
let hideTimer;
function showControls() {
  document.body.classList.remove('controls-hidden', 'idle-cursor');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (document.querySelector('#controls:hover, #player:hover, #player.has-message')) return showControls();
    document.body.classList.add('controls-hidden', 'idle-cursor');
  }, 3000);
}
window.addEventListener('mousemove', showControls);
window.addEventListener('pointerdown', showControls);

// ---- frame loop --------------------------------------------------------------

let frameCount = 0;
let fullFrameRate = settings.get('fullFrameRate');
function frame(now) {
  latency.tick(now);
  const stride = fullFrameRate ? 1 : sync.frameStride(latency.refreshMs);
  const t0 = performance.now();
  if (frameCount++ % stride === 0 && renderer.draw(drawPosition(), { mode: app.mode, playing: app.clock.playing, now })) frameStats.add(now, performance.now() - t0);
  const position = app.clock.position();
  nowPlaying.frame(now, position);
  bar.frame(position, app.track?.durationMs, app.clock.playing);
  spike.frame(position);
  editor.frame();
  requestAnimationFrame(frame);
}

// ---- boot ----------------------------------------------------------------------

async function boot() {
  showControls();
  applyVisuals();
  // Follow Windows "Animation effects" while the user hasn't chosen.
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyVisuals);
  if (desktop) {
    applyDesktop(app.desktop);
    desktop.onState(applyDesktop);
    // The browser tab Spotify returned to handed the login back to us.
    desktop.onLogin((params) => finishLogin(auth.completeLogin(params)));
  }
  const result = await finishLogin(auth.handleRedirect(), { start: false });
  if (result === 'handed-off') {
    // This is the browser tab of a desktop login; the app takes it from here.
    setAuthState('login-handed-off');
    return;
  }
  startSource();
  requestAnimationFrame(frame);
}

async function finishLogin(promise, { start = true } = {}) {
  let result;
  try {
    result = await promise;
    if (result) app.authState = null;
  } catch (e) {
    const code = e.code === 'denied' ? 'login-denied' : e.code === 'wrong-client-id' ? 'wrong-client-id' : 'login-failed';
    app.authState = code;
    app.authMessage = e.message;
  }
  if (start) startSource();
  return result;
}

boot();
