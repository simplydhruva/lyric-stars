import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, redact, recordError, recentErrors } from '../web/js/report.js';

test('redact hides anything that looks like a credential, at any depth', () => {
  const out = redact({ a: 1, accessToken: 'x', nested: { refresh_token: 'y', list: [{ clientId: 'z', ok: true }] }, code_verifier: 'v' });
  assert.deepEqual(out, { a: 1, accessToken: '[hidden]', nested: { refresh_token: '[hidden]', list: [{ clientId: '[hidden]', ok: true }] }, code_verifier: '[hidden]' });
});

test('report: app state without secrets, recent errors kept', () => {
  recordError('lyrics: service-down (502)');
  const app = {
    desktop: { version: '0.9.0', style: 'overlay', overlay: { opacity: 0.8 } },
    playback: { kind: 'track', isPlaying: true, positionMs: 1234.6, player: 'Spotify', token: 'leak?' },
    track: { title: 'Yellow', artist: 'Coldplay', album: 'Parachutes', durationMs: 266773, key: 'spotify:1' },
    lyrics: { status: 'synced', result: { record: { id: 42, duration: 267 } } },
    timeline: [],
    clock: { stats: { lastDrift: 12.4, resyncs: 2 } },
    problem: null,
    authState: null,
  };
  const r = buildReport({ app, settings: { theme: 'gold' }, loggedIn: true, builtInClientId: true, sourceLabel: 'Automatic · Spotify on this PC', timingKind: 'word' });
  assert.equal(r.version, '0.9.0');
  assert.equal(r.playback.positionMs, 1235);
  assert.equal(r.lyrics.lrclibId, 42);
  assert.equal(r.timing, 'word');
  assert.equal(r.login.loggedIn, true);
  assert.ok(!JSON.stringify(r).includes('leak?'));
  assert.equal(recentErrors().at(-1).message, 'lyrics: service-down (502)');
  assert.equal(r.errors.at(-1).message, 'lyrics: service-down (502)');
});
