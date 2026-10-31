import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, placeWindow, fullscreenDisplay, DEFAULT_STATE } from '../electron/layout.mjs';
import { parseVersion, isNewer, isValidRepo, checkForUpdate } from '../electron/updates.mjs';

const primary = { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const right = { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };

test('state: garbage falls back to defaults', () => {
  assert.deepEqual(normalizeState(null), DEFAULT_STATE);
  assert.deepEqual(normalizeState('nope'), DEFAULT_STATE);
  const s = normalizeState({ style: 'huge', window: { bounds: { x: 'a' } }, overlay: { opacity: 9, backdrop: -1 } });
  assert.equal(s.style, 'window');
  assert.equal(s.window.bounds, null);
  assert.equal(s.overlay.opacity, 1);
  assert.equal(s.overlay.backdrop, 0);
});

test('state: fullscreen is never a style to return to', () => {
  const s = normalizeState({ style: 'fullscreen', previousStyle: 'fullscreen' });
  assert.equal(s.style, 'fullscreen');
  assert.equal(s.previousStyle, 'window');
  assert.equal(normalizeState({ previousStyle: 'overlay' }).previousStyle, 'overlay');
});

test('placement: first launch centers the window, overlay sits low', () => {
  const w = placeWindow('window', null, [primary]);
  assert.deepEqual(w, { x: 410, y: 180, width: 1100, height: 680 });
  const o = placeWindow('overlay', null, [primary]);
  assert.equal(o.width, 760);
  assert.ok(o.y > 600 && o.y + o.height < 1040);
});

test('placement: saved bounds on a second monitor are kept', () => {
  const saved = { x: 2200, y: 100, width: 1200, height: 800 };
  assert.deepEqual(placeWindow('window', saved, [primary, right]), saved);
});

test('placement: unplugged monitor sends the window home', () => {
  const saved = { x: 2200, y: 100, width: 1200, height: 800 };
  assert.deepEqual(placeWindow('window', saved, [primary]), placeWindow('window', null, [primary]));
});

test('placement: mostly off-screen is pulled fully on screen', () => {
  const r = placeWindow('window', { x: 1300, y: 600, width: 1000, height: 600 }, [primary]);
  assert.deepEqual(r, { x: 920, y: 440, width: 1000, height: 600 });
});

test('placement: too big for a smaller screen is shrunk to fit', () => {
  const small = { id: 3, primary: true, workArea: { x: 0, y: 0, width: 1280, height: 680 } };
  const r = placeWindow('window', { x: 0, y: 0, width: 1900, height: 1000 }, [small]);
  assert.deepEqual(r, { x: 0, y: 0, width: 1280, height: 680 });
});

test('placement: a sliver left on screen is not trusted', () => {
  const r = placeWindow('overlay', { x: 1900, y: 900, width: 760, height: 260 }, [primary]);
  assert.deepEqual(r, placeWindow('overlay', null, [primary]));
});

test('fullscreen goes to the remembered screen if it is still there', () => {
  assert.equal(fullscreenDisplay(2, [primary, right], primary).id, 2);
  assert.equal(fullscreenDisplay(2, [primary], primary).id, 1);
  assert.equal(fullscreenDisplay(null, [primary, right], right).id, 2);
});

test('versions compare numerically', () => {
  assert.deepEqual(parseVersion('v1.10.0'), [1, 10, 0]);
  assert.equal(parseVersion('latest'), null);
  assert.ok(isNewer('v0.2.0', '0.1.9'));
  assert.ok(isNewer('1.10.0', '1.9.9'));
  assert.ok(!isNewer('0.1.0', '0.1.0'));
  assert.ok(!isNewer('0.0.9', '0.1.0'));
  assert.ok(!isNewer('garbage', '0.1.0'));
});

test('repo setting must look like owner/repo', () => {
  assert.ok(isValidRepo('someone/lyric-stars'));
  assert.ok(!isValidRepo(''));
  assert.ok(!isValidRepo('someone/lyric-stars/../x'));
  assert.ok(!isValidRepo('https://github.com/a/b'));
});

const reply = (status, body) => async () => ({ status, ok: status < 300, json: async () => body });

test('update check: empty repo never touches the network', async () => {
  let called = false;
  const r = await checkForUpdate({ repo: '', currentVersion: '0.1.0', fetchFn: async () => (called = true) });
  assert.equal(r.disabled, true);
  assert.equal(called, false);
});

test('update check: newer release, and links stay on the project page', async () => {
  const r = await checkForUpdate({
    repo: 'me/ls',
    currentVersion: '0.1.0',
    fetchFn: reply(200, { tag_name: 'v0.2.0', html_url: 'https://evil.example/download' }),
  });
  assert.deepEqual(r, { available: true, version: '0.2.0', url: 'https://github.com/me/ls/releases/latest' });
  const ok = await checkForUpdate({
    repo: 'me/ls',
    currentVersion: '0.1.0',
    fetchFn: reply(200, { tag_name: 'v0.2.0', html_url: 'https://github.com/me/ls/releases/tag/v0.2.0' }),
  });
  assert.equal(ok.url, 'https://github.com/me/ls/releases/tag/v0.2.0');
});

test('update check: prereleases, no releases and errors', async () => {
  const pre = await checkForUpdate({ repo: 'me/ls', currentVersion: '0.1.0', fetchFn: reply(200, { tag_name: 'v0.2.0', prerelease: true }) });
  assert.equal(pre.available, false);
  assert.equal((await checkForUpdate({ repo: 'me/ls', currentVersion: '0.1.0', fetchFn: reply(404, {}) })).available, false);
  await assert.rejects(checkForUpdate({ repo: 'me/ls', currentVersion: '0.1.0', fetchFn: reply(500, {}) }));
});
