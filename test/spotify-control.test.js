import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../web/js/settings.js';
import { MODIFY_SCOPE, SCOPES, hasScope } from '../web/js/auth.js';
import { describeFailure, sendCommand, commands } from '../web/js/spotify-control.js';

const TOKENS = (scope) => ({ access: 'tok', refresh: 'ref', expiresAt: Date.now() + 3_600_000, clientId: 'b8103b5f8c55484fb593fb98ba857d40', scope });
const realFetch = globalThis.fetch;
let calls;

function fakeFetch(...responses) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 204 };
    if (r instanceof Error) throw r;
    return {
      ok: r.status < 300,
      status: r.status,
      headers: { get: (h) => (h === 'Retry-After' && r.retryAfter ? String(r.retryAfter) : null) },
      json: async () => {
        if (!r.body) throw new Error('no body');
        return r.body;
      },
    };
  };
}

beforeEach(() => store.set('ls.tokens', TOKENS(SCOPES)));
afterEach(() => {
  globalThis.fetch = realFetch;
  store.remove('ls.tokens');
});

test('the login asks for permission to control playback', () => {
  assert.ok(SCOPES.split(' ').includes(MODIFY_SCOPE));
});

test('hasScope is false for a login saved before the scope existed', () => {
  assert.equal(hasScope(MODIFY_SCOPE), true);
  store.set('ls.tokens', TOKENS(undefined));
  assert.equal(hasScope(MODIFY_SCOPE), false);
  store.set('ls.tokens', TOKENS('user-read-playback-state user-read-currently-playing'));
  assert.equal(hasScope(MODIFY_SCOPE), false);
});

test('each command uses the right method and endpoint', async () => {
  fakeFetch();
  await commands.play();
  await commands.pause();
  await commands.next();
  await commands.previous();
  await commands.seek(12345.6);
  const seen = calls.map((c) => `${c.init.method} ${c.url.replace('https://api.spotify.com/v1/me/player', '')}`);
  assert.deepEqual(seen, ['PUT /play', 'PUT /pause', 'POST /next', 'POST /previous', 'PUT /seek?position_ms=12346']);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('without the scope nothing is sent and the error says to reconnect', async () => {
  store.set('ls.tokens', TOKENS(undefined));
  fakeFetch();
  await assert.rejects(sendCommand('next'), { code: 'scope' });
  assert.equal(calls.length, 0);
});

test('a 401 refreshes the token and retries once', async () => {
  fakeFetch({ status: 401 }, { status: 200, body: { access_token: 'fresh', expires_in: 3600 } }, { status: 204 });
  await sendCommand('pause');
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /accounts\.spotify\.com\/api\/token/);
  assert.equal(calls[2].init.headers.Authorization, 'Bearer fresh');
});

test('a second 401 gives up with a reconnect message', async () => {
  fakeFetch({ status: 401 }, { status: 200, body: { access_token: 'fresh', expires_in: 3600 } }, { status: 401 });
  await assert.rejects(sendCommand('pause'), { code: 'expired' });
  assert.equal(calls.length, 3);
});

test('failures become clear messages', () => {
  const premium = describeFailure(403, { error: { message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } });
  assert.equal(premium.code, 'premium');
  assert.match(premium.message, /Premium/);
  assert.equal(describeFailure(403, { error: { message: 'Insufficient client scope' } }).code, 'scope');
  assert.equal(describeFailure(404, { error: { reason: 'NO_ACTIVE_DEVICE' } }).code, 'no-device');
  assert.equal(describeFailure(0).code, 'offline');
  assert.equal(describeFailure(502).code, 'failed');
  const limited = describeFailure(429, null, 7000);
  assert.equal(limited.code, 'rate-limited');
  assert.match(limited.message, /7s/);
  const refused = describeFailure(403, { error: { message: 'Player command failed: Restriction violated' } });
  assert.equal(refused.code, 'refused');
  assert.match(refused.message, /Restriction violated/);
});

test('a refusal from Spotify is passed on with its reason', async () => {
  fakeFetch({ status: 403, body: { error: { message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } } });
  await assert.rejects(sendCommand('next'), { code: 'premium' });
});

test('a dropped connection reads as offline', async () => {
  fakeFetch(new TypeError('fetch failed'));
  await assert.rejects(sendCommand('next'), { code: 'offline' });
});
