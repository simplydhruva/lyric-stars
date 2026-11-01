// Spotify login with Authorization Code + PKCE. No client secret.
import { BUILT_IN_CLIENT_ID } from '../config.js';
import { store } from './settings.js';

export const MODIFY_SCOPE = 'user-modify-playback-state'; // play, pause, next, previous, seek
export const SCOPES = `user-read-playback-state user-read-currently-playing ${MODIFY_SCOPE}`;
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOKENS_KEY = 'ls.tokens';
const PENDING_KEY = 'ls.pkce';
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;
// Desktop app: login states start with "d." so the browser tab Spotify returns
// to knows to hand the code back to the app instead of logging in itself.
const DESKTOP_STATE_PREFIX = 'd.';

// The desktop app's bridge (electron/preload.cjs), or null in a normal browser.
const desktop = globalThis.lyricStars || null;
export const isDesktop = Boolean(desktop);

// Tokens: Electron secure storage on desktop, localStorage in the browser.
const tokenStore = desktop
  ? {
      get() {
        try {
          return JSON.parse(desktop.tokens.get() || 'null');
        } catch {
          return null;
        }
      },
      set: (t) => desktop.tokens.set(JSON.stringify(t)),
      remove: () => desktop.tokens.set(null),
    }
  : { get: () => store.get(TOKENS_KEY), set: (t) => store.set(TOKENS_KEY, t), remove: () => store.remove(TOKENS_KEY) };

if (desktop) {
  // Tokens saved in plain localStorage by an earlier build move to secure storage.
  const old = store.get(TOKENS_KEY);
  if (old) {
    if (!tokenStore.get()) tokenStore.set(old);
    store.remove(TOKENS_KEY);
  }
}

// The desktop window can be reloaded while the browser is open (the login is handed back to it),
// so there the pending login outlives the page, for a few minutes.
const pendingStorage = () => (desktop ? localStorage : sessionStorage);

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'wrong-client-id' | 'denied' | 'failed' | 'expired'
  }
}

export function redirectUri() {
  return `${location.origin}/`;
}

export function isValidClientIdFormat(id) {
  return /^[0-9a-f]{32}$/i.test(String(id || '').trim());
}

export function getClientId() {
  return BUILT_IN_CLIENT_ID || store.get('ls.clientId') || '';
}

export function hasBuiltInClientId() {
  return Boolean(BUILT_IN_CLIENT_ID);
}

export function setClientId(id) {
  store.set('ls.clientId', String(id).trim());
}

function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Returns 'browser' when the login continues in the system browser (desktop app).
export async function beginLogin() {
  const verifier = randomString(64);
  const state = (desktop ? DESKTOP_STATE_PREFIX : '') + randomString(16);
  pendingStorage().setItem(PENDING_KEY, JSON.stringify({ verifier, state, at: Date.now() }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
  });
  if (desktop) {
    // Spotify login (and Google/Apple/Facebook sign-in) belong in the real browser.
    desktop.openLogin(`${AUTH_URL}?${params}`);
    return 'browser';
  }
  location.assign(`${AUTH_URL}?${params}`);
  return 'page';
}

async function tokenRequest(body) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new AuthError('offline', 'Could not reach Spotify.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === 'invalid_client') {
      throw new AuthError('wrong-client-id', 'Spotify does not recognise this Client ID.');
    }
    if (data.error === 'invalid_grant') throw new AuthError('expired', data.error_description || 'Login expired.');
    throw new AuthError('failed', data.error_description || data.error || `Spotify returned ${res.status}.`);
  }
  return data;
}

function saveTokens(data, previous = {}) {
  const tokens = {
    access: data.access_token,
    refresh: data.refresh_token || previous.refresh,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    clientId: getClientId(),
    scope: data.scope || previous.scope, // what Spotify granted; logins from before the player bar lack the modify scope
  };
  tokenStore.set(tokens);
  return tokens;
}

// Handles ?code / ?error on the redirect. Returns true if a login just completed,
// 'handed-off' if this browser tab passed a desktop login back to the app.
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  history.replaceState(null, '', '/');
  const params = { code: q.get('code'), state: q.get('state'), error: q.get('error') };
  if (!desktop && params.state?.startsWith(DESKTOP_STATE_PREFIX)) return handOff(params);
  return completeLogin(params);
}

async function handOff(params) {
  let res;
  try {
    res = await fetch('/api/login-handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    throw new AuthError('failed', 'Could not reach the Lyric Stars app. Is it still open?');
  }
  if (!res.ok || !(await res.json().catch(() => ({}))).ok) {
    throw new AuthError('failed', 'The Lyric Stars app is not open. Open it and press Connect Spotify again.');
  }
  return 'handed-off';
}

// Finishes a login from the redirect's code/state/error (also called by the
// desktop app with what the browser tab handed over).
export async function completeLogin({ code, state, error } = {}) {
  const storage = pendingStorage();
  let pending = JSON.parse(storage.getItem(PENDING_KEY) || 'null');
  storage.removeItem(PENDING_KEY);
  if (pending && desktop && !(Date.now() - pending.at < PENDING_MAX_AGE_MS)) pending = null;
  if (error === 'access_denied') throw new AuthError('denied', 'Login was cancelled.');
  if (error === 'invalid_client') throw new AuthError('wrong-client-id', 'Spotify does not recognise this Client ID.');
  if (error) throw new AuthError('failed', `Spotify said: ${error}`);
  if (!pending || pending.state !== state) {
    throw new AuthError('failed', 'Login could not be verified. Please try again.');
  }
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: getClientId(),
    code_verifier: pending.verifier,
  });
  saveTokens(data);
  return true;
}

export function isLoggedIn() {
  const t = tokenStore.get();
  return Boolean(t && t.refresh && t.clientId === getClientId());
}

// True when the saved login was granted this scope. Older tokens record none.
export function hasScope(scope) {
  return Boolean(tokenStore.get()?.scope?.split(' ').includes(scope));
}

export function logout() {
  tokenStore.remove();
}

let refreshing = null;

async function refresh() {
  const t = tokenStore.get();
  if (!t?.refresh) throw new AuthError('expired', 'Not logged in.');
  const data = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: t.refresh,
    client_id: getClientId(),
  });
  return saveTokens(data, t);
}

// Returns a valid access token, refreshing silently when needed.
export async function getAccessToken({ force = false } = {}) {
  const t = tokenStore.get();
  if (!t) throw new AuthError('expired', 'Not logged in.');
  if (!force && t.expiresAt - Date.now() > 60_000) return t.access;
  refreshing ??= refresh().finally(() => (refreshing = null));
  try {
    return (await refreshing).access;
  } catch (e) {
    if (e.code !== 'offline') logout();
    throw e.code === 'offline' ? e : new AuthError('expired', 'Your Spotify login expired.');
  }
}
