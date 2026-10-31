// Shared helpers for the browser checks (smoke test, visual comparison): start the real
// server on a scratch folder, launch headless Chrome or Edge, and drive it over the DevTools protocol.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const rel = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'];
  const unix = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return [process.env.CHROME_PATH, ...rel.flatMap((r) => pf.map((p) => path.join(p, r))), ...unix].find((p) => p && existsSync(p));
}

export async function waitFor(what, fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Starts everything and returns { base, page, cleanup, ... }. Call cleanup() when done.
export async function startSession({ port = 5196, width = 1280, height = 720, reduceMotion = false } = {}) {
  const browserPath = findBrowser();
  if (!browserPath) throw Object.assign(new Error('no Chrome or Edge found (set CHROME_PATH)'), { code: 'NO_BROWSER' });
  const work = mkdtempSync(path.join(tmpdir(), 'lyricstars-'));
  const procs = [];
  const cleanup = async () => {
    for (const p of procs) p.kill();
    await sleep(500);
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  };
  try {
    const server = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), LYRICSTARS_DATA: path.join(work, 'data') },
      stdio: 'ignore',
    });
    procs.push(server);
    const base = `http://127.0.0.1:${port}`;
    await waitFor('the server', async () => (await fetch(`${base}/api/cache-stats`)).ok, 15000);

    const profile = path.join(work, 'profile');
    const chrome = spawn(
      browserPath,
      ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'],
      { stdio: 'ignore' }
    );
    procs.push(chrome);
    const dbg = await waitFor('the browser', () => {
      const f = path.join(profile, 'DevToolsActivePort');
      return existsSync(f) ? readFileSync(f, 'utf8').split('\n')[0] : null;
    }, 20000);
    const target = await waitFor('a page', async () => (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page'));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('could not connect to the browser'));
    });
    let id = 0;
    const pending = new Map();
    const logs = [];
    const listeners = new Map(); // CDP event name -> handler
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id) pending.get(d.id)?.(d);
      else if (listeners.has(d.method)) listeners.get(d.method)(d.params);
      else if (d.method === 'Runtime.exceptionThrown') logs.push(`exception: ${d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text}`);
      else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(d.params.type)) logs.push(`console.${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`);
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
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (reduceMotion) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

    return {
      base,
      send,
      js,
      on: (method, fn) => listeners.set(method, fn),
      logs, // console errors and uncaught exceptions seen so far
      goto: (url) => send('Page.navigate', { url }),
      key: async (k, code) => {
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, text: k.length === 1 ? k : undefined });
      },
      move: (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
      click: async (x, y) => {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      },
      resize: (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }),
      putCache: async (key, entry) => {
        const res = await fetch(`${base}/api/cache/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
        if (!res.ok) throw new Error(`could not seed the cache (${res.status})`);
      },
      cleanup: async () => {
        ws.close();
        await cleanup();
      },
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

// A saved "found" result for a demo song, so nothing depends on the lyrics service.
// lines: [[seconds, text], ...]
export function syncedEntry(title, artist, lines) {
  return {
    savedAt: Date.now(),
    track: { title, artists: [artist] },
    result: { status: 'synced', lines: lines.map(([s, text]) => ({ time: s * 1000, text })), record: { id: 1 } },
  };
}
