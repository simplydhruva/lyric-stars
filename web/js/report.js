// "Copy report" in Diagnostics: what a friend pastes to the owner when something is off.
// Built on demand from local state only; nothing is sent anywhere. Never includes tokens,
// the Client ID or the PKCE verifier.

const MAX_ERRORS = 20;
const errors = [];

export function recordError(message) {
  errors.push({ at: new Date().toISOString(), message: String(message).slice(0, 300) });
  if (errors.length > MAX_ERRORS) errors.shift();
}

export function watchErrors(target = globalThis) {
  target.addEventListener?.('error', (e) => recordError(e.error?.stack || e.message));
  target.addEventListener?.('unhandledrejection', (e) => recordError(`unhandled: ${e.reason?.stack || e.reason}`));
}

export const recentErrors = () => errors.slice();

// Keys whose values must never leave the machine, wherever they turn up.
const SECRET = /token|verifier|secret|code_challenge|authorization|client_?id|refresh|access/i;

export function redact(value, depth = 0) {
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET.test(k) ? '[hidden]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

const round = (v) => (typeof v === 'number' ? Math.round(v) : v);

// parts: plain values gathered by the caller (main app state, diagnostics, environment).
export function buildReport(parts) {
  const { app, env = {}, settings = {}, offsets = {}, sourceLabel = '', loggedIn = false, builtInClientId = false } = parts;
  const pb = app.playback;
  const rec = app.lyrics?.result?.record;
  const frame = app.frameStats?.summary?.(performance.now());
  const report = {
    report: 'Lyric Stars',
    at: new Date().toISOString(),
    version: app.desktop?.version || 'browser',
    env,
    desktop: app.desktop ? { style: app.desktop.style } : null,
    login: { loggedIn, builtInClientId, authState: app.authState || null },
    source: sourceLabel,
    problem: app.problem ? { code: app.problem.code, message: app.problem.message } : null,
    playback: pb
      ? { kind: pb.kind, isPlaying: pb.isPlaying, positionMs: round(pb.positionMs), player: pb.player, buffering: pb.buffering }
      : null,
    track: app.track
      ? { title: app.track.title, artist: app.track.artist, album: app.track.album, durationMs: app.track.durationMs, key: app.track.key }
      : null,
    lyrics: app.lyrics
      ? { status: app.lyrics.status, offline: Boolean(app.lyrics.offline), lrclibId: rec?.id, lrclibDuration: rec?.duration, own: Boolean(app.lyrics.own) }
      : null,
    timing: app.timeline ? parts.timingKind : null,
    offsets,
    clock: app.clock?.stats ? { lastDrift: round(app.clock.stats.lastDrift), resyncs: app.clock.stats.resyncs } : null,
    rendering: frame ? { fps: round(frame.fps), meanMs: +frame.meanMs.toFixed(2), p95Ms: +frame.p95Ms.toFixed(2), lateFrames: frame.longFrames } : null,
    memoryMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    settings,
    errors: recentErrors(),
  };
  return redact(report);
}

export function formatReport(report) {
  return `Lyric Stars report (paste this to the person who sent you the app)\n${JSON.stringify(report, null, 2)}`;
}
