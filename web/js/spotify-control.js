// Playback commands for the Spotify Web API: play, pause, next, previous, seek.
// They need the user-modify-playback-state scope, which logins from before the
// player bar do not have; the caller sends the user through login again for that.
import { getAccessToken, hasScope, MODIFY_SCOPE, AuthError } from './auth.js';

const BASE = 'https://api.spotify.com/v1/me/player';
const ROUTES = {
  play: ['PUT', 'play'],
  pause: ['PUT', 'pause'],
  next: ['POST', 'next'],
  previous: ['POST', 'previous'],
  seek: ['PUT', 'seek'],
};

export class ControlError extends Error {
  // code: 'scope' | 'premium' | 'no-device' | 'rate-limited' | 'refused' | 'offline' | 'expired' | 'failed'
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// A plain message for a failed command. status 0 means the request never got through.
export function describeFailure(status, body, retryAfterMs) {
  const detail = body?.error?.message || (typeof body?.error === 'string' ? body.error : '') || '';
  const reason = body?.error?.reason || '';
  if (status === 0) return new ControlError('offline', 'Can’t reach Spotify. Check your connection.');
  if (status === 429) {
    const s = Math.max(1, Math.ceil((retryAfterMs || 5000) / 1000));
    return new ControlError('rate-limited', `Spotify asked us to slow down. Try again in ${s}s.`);
  }
  if (status === 403 && /scope/i.test(detail)) {
    return new ControlError('scope', 'Lyric Stars needs your permission to control Spotify.');
  }
  if (status === 403 && (reason === 'PREMIUM_REQUIRED' || /premium/i.test(detail))) {
    return new ControlError('premium', 'Spotify only lets Premium accounts control playback.');
  }
  if (status === 404 || reason === 'NO_ACTIVE_DEVICE') {
    return new ControlError('no-device', 'Spotify has no active player. Start a song on one of your devices first.');
  }
  if (status === 403) {
    const why = detail.replace(/^Player command failed:\s*/i, '');
    return new ControlError('refused', `Spotify refused that${why ? `: ${why}` : ''}.`);
  }
  if (status >= 500) return new ControlError('failed', 'Spotify isn’t responding. Try again in a moment.');
  return new ControlError('failed', `Spotify could not do that${detail ? `: ${detail}` : ` (error ${status})`}.`);
}

// name: a key of ROUTES. params: query string values (seek takes position_ms).
export async function sendCommand(name, params = {}) {
  const [method, path] = ROUTES[name];
  if (!hasScope(MODIFY_SCOPE)) throw describeFailure(403, { error: { message: 'Insufficient client scope' } });
  const query = new URLSearchParams(params).toString();
  const url = `${BASE}/${path}${query ? `?${query}` : ''}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let token;
    try {
      token = await getAccessToken({ force: attempt > 0 });
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      throw e.code === 'offline' ? describeFailure(0) : new ControlError('expired', 'Your Spotify login expired. Reconnect to keep control.');
    }
    let res;
    try {
      res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw describeFailure(0);
    }
    if (res.status === 401) continue; // refresh once; a second 401 falls out to the message below
    if (res.ok) return;
    const body = await res.json().catch(() => null);
    const retryAfter = Number(res.headers.get('Retry-After'));
    throw describeFailure(res.status, body, retryAfter > 0 ? retryAfter * 1000 : undefined);
  }
  throw new ControlError('expired', 'Your Spotify login expired. Reconnect to keep control.');
}

export const commands = {
  play: () => sendCommand('play'),
  pause: () => sendCommand('pause'),
  next: () => sendCommand('next'),
  previous: () => sendCommand('previous'),
  seek: (ms) => sendCommand('seek', { position_ms: Math.max(0, Math.round(ms)) }),
};
