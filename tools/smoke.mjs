// Browser smoke test: starts the real server on a scratch data folder, opens the demo
// in headless Chrome (or Edge) and drives the now-playing scene and the player bar.
// Run with `npm run smoke`. It needs a Chromium browser; set CHROME_PATH to pick one.
// Without one it skips locally, and fails when CI is set.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT) || 5196;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const rel = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'];
  const unix = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return [process.env.CHROME_PATH, ...rel.flatMap((r) => pf.map((p) => path.join(p, r))), ...unix].find((p) => p && existsSync(p));
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log('smoke: no Chrome or Edge found (set CHROME_PATH); skipped');
  process.exit(process.env.CI ? 1 : 0);
}

const work = mkdtempSync(path.join(tmpdir(), 'lyricstars-smoke-'));
const procs = [];
let failed = 0;

async function waitFor(what, fn, ms = 6000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const SONG = { title: 'Zzqx Vwkp Nonexistent', artist: 'Qqjx Wvz', album: 'Nothing Album' };

async function main() {
  const data = path.join(work, 'data');
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), LYRICSTARS_DATA: data },
    stdio: 'ignore',
  });
  procs.push(server);
  const base = `http://127.0.0.1:${PORT}`;
  await waitFor('the server', async () => (await fetch(`${base}/api/cache-stats`)).ok, 15000);

  // A saved "not found" so the test never depends on the lyrics service being reachable.
  const key = encodeURIComponent(`lyrics:demo:${SONG.title}`);
  const put = await fetch(`${base}/api/cache/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ savedAt: Date.now(), track: { title: SONG.title, artists: [SONG.artist] }, result: { status: 'notfound' } }),
  });
  if (!put.ok) throw new Error(`could not seed the cache (${put.status})`);

  const profile = path.join(work, 'profile');
  const chrome = spawn(
    browserPath,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,720', 'about:blank'],
    { stdio: 'ignore' }
  );
  procs.push(chrome);
  const port = await waitFor('the browser', () => {
    const f = path.join(profile, 'DevToolsActivePort');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n')[0] : null;
  }, 20000);
  const page = await waitFor('a page', async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not connect to the browser'));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    pending.get(d.id)?.(d);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'script error');
    return r.result?.result?.value;
  };
  const key_ = async (k, code) => {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, text: k === ' ' ? ' ' : undefined });
  };
  const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const click = async (x, y) => {
    await move(x, y);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const box = (sel) => js(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, width: r.width }; })()`);
  const text = (sel) => js(`document.querySelector('${sel}').textContent`);
  const seconds = async () => {
    const [m, s] = (await text('.pb-elapsed')).split(':').map(Number);
    return m * 60 + s;
  };

  await send('Page.enable');
  const q = new URLSearchParams({ demo: '', ...SONG, duration: '268' });
  await send('Page.navigate', { url: `${base}/?${q}` });

  console.log('Now-playing scene and player bar');
  await step('scene shows the song and "Lyrics not found"', async () => {
    await waitFor('the scene', () => js(`!document.getElementById('np').hidden && document.querySelector('.np-label').textContent === 'Lyrics not found'`));
    assertEq(await text('.np-title'), SONG.title);
    assertEq(await text('.np-artist'), SONG.artist);
    assertEq(await text('.np-album'), SONG.album);
  });
  await step('a cover that fails to load leaves the gold star', async () => {
    assertEq(await js(`getComputedStyle(document.querySelector('.np-fallback')).display !== 'none'`), true);
  });
  await step('the bar is visible', async () => {
    assertEq(await js(`!document.getElementById('player').hidden`), true);
  });
  await step('Space pauses and dims the scene, then plays again', async () => {
    await key_(' ', 'Space');
    await waitFor('paused', () => js(`document.getElementById('np').classList.contains('paused') && document.querySelector('.pb-main').getAttribute('aria-label') === 'Play'`));
    await key_(' ', 'Space');
    await waitFor('playing', () => js(`!document.getElementById('np').classList.contains('paused') && document.querySelector('.pb-main').getAttribute('aria-label') === 'Pause'`));
  });
  await step('clicking the progress bar seeks', async () => {
    const t = await box('.pb-track');
    await click(t.left + t.width * 0.5, t.y);
    await waitFor('the seek', async () => Math.abs((await seconds()) - 134) <= 3);
  });
  await step('Retry searches again, then the label returns', async () => {
    const r = await box('.np-retry');
    await click(r.x, r.y);
    await waitFor('searching', () => js(`document.querySelector('.np-label').textContent === 'Searching…'`));
    await waitFor('the result', () => js(`document.querySelector('.np-label').textContent === 'Lyrics not found'`));
  });
  await step('the bar fades after 3 s without movement and returns on movement', async () => {
    await move(20, 20);
    await waitFor('the fade', () => js(`document.body.classList.contains('controls-hidden')`), 7000);
    await move(300, 300);
    await waitFor('the bar to return', () => js(`!document.body.classList.contains('controls-hidden')`));
  });

  ws.close();
}

function assertEq(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

try {
  await main();
} catch (e) {
  failed++;
  console.log(`  FAIL setup: ${e.message}`);
} finally {
  for (const p of procs) p.kill();
  await sleep(500);
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
console.log(failed ? `smoke: ${failed} failed` : 'smoke: all passed');
process.exit(failed ? 1 : 0);
