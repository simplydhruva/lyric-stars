// Short check of the Pixel scene in the real desktop app: it draws, stays crisp, survives resizes, and keeps its frame rate.
//   node --experimental-websocket tools/pixel-electron.mjs [OUT_DIR]
// Own port (5215), own data folder, the demo song; the app and its settings are untouched. Closes the window at the end.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, sleep, waitFor, syncedEntry } from './lib/headless.mjs';

const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PAGE_PORT = 9343;
const MAIN_PORT = 9344;
let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    return new Promise((res) => {
      pending.set(++id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  return { send, js, close: () => ws.close() };
}

const work = mkdtempSync(path.join(tmpdir(), 'lyricstars-pixel-'));
mkdirSync(path.join(work, 'desktop'), { recursive: true });
writeFileSync(path.join(work, 'desktop', 'desktop.json'), JSON.stringify({ style: 'window' }));
const start = '/?demo=&title=Pixel+Electron&artist=Check&duration=300&start=6&seed=7&scene=pixel&demoCover=busy';
const proc = spawn(ELECTRON, ['.', `--remote-debugging-port=${PAGE_PORT}`, `--inspect=${MAIN_PORT}`], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, LYRICSTARS_PORT: '5215', LYRICSTARS_DATA: work, LYRICSTARS_START: start },
});
let page, main;
// Every sampled logical pixel must be an exact scale x scale block on the real canvas.
const CRISP = `(() => { const c = document.getElementById('sky'); const st = globalThis.__pixelStats; const s = st.scale; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let bad = 0, n = 0;
  for (let k = 0; k < 400; k++) { const lx = (k * 37) % (st.lw - 2), ly = (k * 53) % (st.lh - 2); const x0 = st.ox + lx * s, y0 = st.oy + ly * s; const i0 = (y0 * c.width + x0) * 4; n++;
    for (const [dx, dy] of [[s - 1, 0], [0, s - 1], [s - 1, s - 1], [(s >> 1), (s >> 1)]]) { const i = ((y0 + dy) * c.width + x0 + dx) * 4; if (d[i] !== d[i0] || d[i + 1] !== d[i0 + 1] || d[i + 2] !== d[i0 + 2]) { bad++; break; } } }
  return { bad, n, scale: s, lw: st.lw, lh: st.lh, coverage: st.coverage }; })()`;
try {
  await waitFor('the server', async () => (await fetch('http://127.0.0.1:5215/api/cache-stats')).ok, 40000);
  const lines = [[4, 'Hold me in the light tonight'], [9, 'Stars are falling slow and bright'], [14, 'Sing it back to me again'], [30, 'In the middle of the night when the stars are bright and the world is quiet and still and nobody knows my name at all']];
  await fetch('http://127.0.0.1:5215/api/cache/' + encodeURIComponent('lyrics:demo:Pixel Electron'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(syncedEntry('Pixel Electron', 'Check', lines)) });
  const pt = await waitFor('the page', async () => (await (await fetch(`http://127.0.0.1:${PAGE_PORT}/json`)).json()).find((t) => t.type === 'page'), 40000);
  const pg = cdp(pt.webSocketDebuggerUrl);
  await pg.send('Page.reload');
  pg.close();
  const pageTarget = await waitFor('the page', async () => (await (await fetch(`http://127.0.0.1:${PAGE_PORT}/json`)).json()).find((t) => t.type === 'page'), 40000);
  const mainTarget = await waitFor('the main process', async () => (await (await fetch(`http://127.0.0.1:${MAIN_PORT}/json`)).json())[0], 10000);
  page = cdp(pageTarget.webSocketDebuggerUrl);
  main = cdp(mainTarget.webSocketDebuggerUrl);
  await waitFor('pixel scene', () => page.js(`document.documentElement.dataset.scene === 'pixel' && !!globalThis.__pixelStats && globalThis.__pixelStats.fontsReady`), 60000);
  await sleep(1500);
  const mainJs = (body) => main.js(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows()[0]; ${body} })()`);
  const info = await page.js(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, cw: document.getElementById('sky').width, ch: document.getElementById('sky').height })`);
  console.log(`  page ${info.w}x${info.h} @${info.dpr}, canvas ${info.cw}x${info.ch}`);
  const sizes = [[null, 'as opened'], [[1000, 700], '1000x700'], [[700, 900], '700x900'], [[1400, 800], '1400x800']];
  for (const [sz, label] of sizes) {
    if (sz) {
      await mainJs(`w.setContentSize(${sz[0]}, ${sz[1]});`);
      await sleep(1200);
    }
    const r = JSON.parse(JSON.stringify(await page.js(CRISP)));
    check(`${label}: crisp (exact blocks)`, r.bad === 0, `${r.n - r.bad}/${r.n} blocks, scale ${r.scale}, logical ${r.lw}x${r.lh}, coverage ${(r.coverage * 100).toFixed(1)}%`);
    check(`${label}: fills at least 95% of the window`, r.coverage >= 0.95);
    if (out) {
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(out, `electron-pixel-${label.replace(/\s+/g, '-')}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
  // Frame rate over 10 s, drawn frames counted by requestAnimationFrame, plus the app's own draw time.
  await mainJs(`w.setContentSize(1280, 720);`);
  await sleep(1200);
  const fps = await page.js(`new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const t0 = last; (function t(now) { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 10000) requestAnimationFrame(t); else res({ fps: n / ((now - t0) / 1000), worst }); })(performance.now()); })`);
  check('frame rate over 10 s', fps.fps > 50, `${fps.fps.toFixed(1)} fps, longest gap ${fps.worst.toFixed(1)} ms`);
  const errs = await page.js(`globalThis.__pixelStats.fontsReady`);
  check('fonts loaded in the real app', errs === true);
} catch (e) {
  check('ran to the end', false, e.message);
} finally {
  page?.close();
  main?.close();
  proc.kill();
  await sleep(1200);
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {}
}
console.log(bad ? `\npixel-electron: ${bad} problems` : '\npixel-electron: the Pixel scene rendered, resized and held its frame rate');
process.exit(bad ? 1 : 0);
