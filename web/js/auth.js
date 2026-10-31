// Spotify login with Authorization Code + PKCE. No client secret.
import { BUILT_IN_CLIENT_ID } from '../config.js';
import { store } from './settings.js';

export const SCOPES = 'user-read-playback-state user-read-currently-playing';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOKENS_KEY = 'ls.tokens';
const PENDING_KEY = 'ls.pkce';

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

export async function beginLogin() {
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
  });
  location.assign(`${AUTH_URL}?${params}`);
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
  };
  store.set(TOKENS_KEY, tokens);
  return tokens;
}

// Handles ?code / ?error on the redirect. Returns true if a login just completed.
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  history.replaceState(null, '', '/');
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
  sessionStorage.removeItem(PENDING_KEY);
  const error = q.get('error');
  if (error === 'access_denied') throw new AuthError('denied', 'Login was cancelled.');
  if (error === 'invalid_client') throw new AuthError('wrong-client-id', 'Spotify does not recognise this Client ID.');
  if (error) throw new AuthError('failed', `Spotify said: ${error}`);
  if (!pending || pending.state !== q.get('state')) {
    throw new AuthError('failed', 'Login could not be verified. Please try again.');
  }
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code: q.get('code'),
    redirect_uri: redirectUri(),
    client_id: getClientId(),
    code_verifier: pending.verifier,
  });
  saveTokens(data);
  return true;
}

export function isLoggedIn() {
  const t = store.get(TOKENS_KEY);
  return Boolean(t && t.refresh && t.clientId === getClientId());
}

export function logout() {
  store.remove(TOKENS_KEY);
}

let refreshing = null;

async function refresh() {
  const t = store.get(TOKENS_KEY);
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
  const t = store.get(TOKENS_KEY);
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
