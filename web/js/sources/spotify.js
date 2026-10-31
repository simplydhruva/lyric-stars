// Spotify Web API playback source (GET /v1/me/player).
import { getAccessToken, AuthError } from '../auth.js';

const PLAYER_URL = 'https://api.spotify.com/v1/me/player?additional_types=episode';
export const CURRENTLY_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode';

const INTERVAL = { playing: 2000, paused: 4000, idle: 5000, hidden: 6000, error: 5000 };

export class ApiError extends Error {
  constructor(status, message, retryAfterMs) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Shared request helper: handles token refresh, rate limits and error bodies.
export async function spotifyGet(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken({ force: attempt > 0 });
    const sentAt = performance.now();
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new ApiError(0, 'offline');
    }
    const receivedAt = performance.now();
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 204) return { status: 204, data: null, sentAt, receivedAt };
    const data = await res.json().catch(() => null);
    if (res.ok) return { status: res.status, data, sentAt, receivedAt };
    const retryAfter = Number(res.headers.get('Retry-After'));
    throw new ApiError(
      res.status,
      data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${res.status}`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
    );
  }
  throw new AuthError('expired', 'Your Spotify login expired.');
}

export function classifyForbidden(message) {
  return /not registered|not been registered|developer dashboard|allowlist|allow list/i.test(message || '')
    ? 'not-allowlisted'
    : 'refused';
}

export function trackFromItem(item) {
  const artists = (item.artists || []).map((a) => a.name);
  return {
    key: item.id ? `sp:${item.id}` : `uri:${item.uri}`,
    id: item.id,
    title: item.name,
    artists,
    artist: artists.join(', '),
    album: item.album?.name || '',
    durationMs: item.duration_ms,
    art: item.album?.images?.at(-1)?.url,
  };
}

export class SpotifySource {
  constructor({ onSample, onProblem }) {
    this.name = 'spotify';
    this.onSample = onSample;
    this.onProblem = onProblem;
    this.timer = null;
    this.running = false;
    this.lastProgress = null;
    this.stalls = 0;
    this.serverErrors = 0;
    this.last = null; // diagnostic info for the spike panel
    this._onVisible = () => document.visibilityState === 'visible' && this.pollNow();
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this._onVisible);
    this.pollNow();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this._onVisible);
  }

  pollNow() {
    clearTimeout(this.timer);
    this._poll();
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    if (!this.running) return;
    if (document.visibilityState === 'hidden') ms = Math.max(ms, INTERVAL.hidden);
    this.timer = setTimeout(() => this._poll(), ms);
  }

  async _poll() {
    if (!this.running || this.inFlight) return;
    this.inFlight = true;
    try {
      const r = await spotifyGet(PLAYER_URL);
      this.serverErrors = 0;
      this.last = { status: r.status, latency: Math.round(r.receivedAt - r.sentAt), at: Date.now() };
      this.onProblem(null);
      this._schedule(this._handle(r));
    } catch (e) {
      this._schedule(this._fail(e));
    } finally {
      this.inFlight = false;
    }
  }

  // Returns the delay before the next poll.
  _handle({ data, sentAt, receivedAt }) {
    if (!data || (!data.item && data.currently_playing_type !== 'ad')) {
      this.onSample({ kind: 'idle' });
      return INTERVAL.idle;
    }
    const at = (sentAt + receivedAt) / 2; // best guess for when progress_ms was true
    const isPlaying = Boolean(data.is_playing);
    const base = { at, isPlaying, positionMs: data.progress_ms || 0, device: data.device?.name };
    if (data.currently_playing_type === 'ad') {
      this.onSample({ ...base, kind: 'ad' });
      return INTERVAL.playing;
    }
    if (data.currently_playing_type === 'episode') {
      this.onSample({ ...base, kind: 'podcast', track: { key: `ep:${data.item.id}`, title: data.item.name } });
      return INTERVAL.paused;
    }
    const track = trackFromItem(data.item);
    // Playing but progress frozen across polls: buffering.
    const stalled = isPlaying && this.lastProgress && this.lastProgress.key === track.key &&
      this.lastProgress.pos === base.positionMs;
    this.stalls = stalled ? this.stalls + 1 : 0;
    this.lastProgress = { key: track.key, pos: base.positionMs };
    const buffering = this.stalls >= 1;
    this.onSample({ ...base, kind: 'track', track, isPlaying: isPlaying && !buffering, buffering });

    if (!isPlaying) return INTERVAL.paused;
    // Catch the next track quickly when this one is about to end.
    const remaining = track.durationMs - base.positionMs - (performance.now() - at);
    return remaining > 0 && remaining < INTERVAL.playing ? remaining + 300 : INTERVAL.playing;
  }

  _fail(e) {
    if (e instanceof AuthError) {
      this.onProblem({ code: e.code === 'offline' ? 'offline' : 'expired', message: e.message });
      if (e.code === 'offline') return INTERVAL.error;
      this.stop();
      return 0;
    }
    this.last = { status: e.status, message: e.message, at: Date.now() };
    if (e.status === 0) {
      this.onProblem({ code: 'offline' });
      return INTERVAL.error;
    }
    if (e.status === 429) {
      const wait = e.retryAfterMs || 10_000;
      this.onProblem({ code: 'rate-limited', retryInMs: wait });
      return wait;
    }
    if (e.status === 403) {
      this.onProblem({ code: classifyForbidden(e.message), message: e.message });
      this.stop();
      return 0;
    }
    this.serverErrors++;
    if (this.serverErrors >= 3) this.onProblem({ code: 'spotify-down', message: e.message });
    return Math.min(30_000, INTERVAL.error * this.serverErrors);
  }
}
