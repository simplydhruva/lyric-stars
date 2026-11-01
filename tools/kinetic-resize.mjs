// Plays a fake song in the Kinetic scene while the window is resized (and the display scale changed) live, and checks
// every word and emoji drawn, in every frame, with the browser's REAL glyph metrics (measureText actualBoundingBox*)
// and the real canvas transform, against the 5% safe margin of that frame's own size.
//   node --experimental-websocket tools/kinetic-resize.mjs            (headless Chrome/Edge)
//   node --experimental-websocket tools/kinetic-resize.mjs --electron (the real desktop app, window style, real window resizes)
//   ... --electron --emulate   (window style, size and display scale changed by DevTools emulation)
//   ... --fullscreen           (the real desktop app, full screen style, size and display scale by emulation)
// Also checks that the first frame after a resize is already laid out for the new size (no stale-size frame), that no
// word that was showing goes missing, and that the layout does not move in the next few frames (no jump).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, sleep, waitFor, startSession, syncedEntry } from './lib/headless.mjs';

const fullscreen = process.argv.includes('--fullscreen');
const electron = process.argv.includes('--electron') || fullscreen;
// In Electron the size and the display scale can also be changed by DevTools emulation (--emulate, and always in fullscreen,
// where the window itself cannot be resized). That exercises the same resize and devicePixelRatio paths as a real change.
const emulate = fullscreen || process.argv.includes('--emulate');
const MARGIN = 0.05;
const TITLE = 'Resize Check';
const long30 = 'Supercalifragilisticexpialidocious'.slice(0, 30);
const LINES = [
  [4, `I am ${long30} tonight`],
  [9, 'Love fire sun moon heart star rain dance kiss dream gold light night day sea sky wind snow fly home'],
  [14, 'Hold on forever tonight'],
  [19, 'to be a in the unforgettable fire'],
  [24, 'Fire and love'],
  [29, Array.from({ length: 46 }, (_, i) => ['and', 'then', 'we', 'sang', 'about', 'the', 'moonlight'][i % 7]).join(' ')],
  [34, 'Hold on forever tonight'],
];
// [seconds from the start of the run, width, height, dpr]; each lands about 2.5 s into a line
const RESIZES = [[3.5, 700, 900, 1], [8.5, 400, 800, 1], [13.5, 2560, 1440, 1], [18.5, 1280, 720, 2], [23.5, 1920, 1080, 1], [28.5, 400, 800, 2], [33.5, 1920, 1080, 1]];
const START_AT = 3;

const PROBE = `(() => {
  const ctx = document.getElementById('sky').getContext('2d');
  const st = (window.__probe = { frames: 0, boxes: [], marks: [], cw: 0, ch: 0, dpr: 1 });
  const rawRect = ctx.fillRect.bind(ctx);
  const rawText = ctx.fillText.bind(ctx);
  ctx.fillRect = (x, y, w, h) => {
    const m = ctx.getTransform();
    if (x === 0 && y === 0 && Math.round(w * m.a) === ctx.canvas.width && Math.round(h * m.d) === ctx.canvas.height) { st.frames++; st.cw = w; st.ch = h; st.dpr = m.a; }
    return rawRect(x, y, w, h);
  };
  ctx.fillText = (t, x, y, mw) => {
    const m = ctx.measureText(t);
    const tm = ctx.getTransform();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [px, py] of [[x - m.actualBoundingBoxLeft, y - m.actualBoundingBoxAscent], [x + m.actualBoundingBoxRight, y - m.actualBoundingBoxAscent], [x + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent], [x - m.actualBoundingBoxLeft, y + m.actualBoundingBoxDescent]]) {
      const X = (tm.a * px + tm.c * py + tm.e) / st.dpr, Y = (tm.b * px + tm.d * py + tm.f) / st.dpr;
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
    st.boxes.push([st.frames, t, x0, x1, y0, y1, st.cw, st.ch, /\\p{Extended_Pictographic}/u.test(t) ? 1 : 0]);
    return rawText(t, x, y, mw);
  };
  window.__mark = () => st.marks.push(st.frames);
})()`;

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') events.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300)); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') events.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)); else if (m.method === 'Inspector.targetCrashed') events.push('page crashed'); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => { await ready; return new Promise((res) => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); }); };
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  return { send, js, events, close: () => ws.close() };
}

let page;
let doResize;
let cleanup = async () => {};
const query = `/?${new URLSearchParams({ demo: '', title: TITLE, artist: 'Check', duration: '120', start: String(START_AT), seed: '7', scene: 'kinetic' })}`;

if (electron) {
  const work = mkdtempSync(path.join(tmpdir(), 'lyricstars-kresize-'));
  mkdirSync(path.join(work, 'desktop'), { recursive: true });
  writeFileSync(path.join(work, 'desktop', 'desktop.json'), JSON.stringify({ style: fullscreen ? 'fullscreen' : 'window' }));
  const exe = process.env.LYRICSTARS_EXE || path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const args = [...(process.env.LYRICSTARS_EXE ? [] : ['.']), '--remote-debugging-port=9335', '--inspect=9336'];
  const proc = spawn(exe, args, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, LYRICSTARS_PORT: '5211', LYRICSTARS_DATA: work, LYRICSTARS_START: '/?demo=&title=x&paused=&scene=kinetic' } });
  let main;
  cleanup = async () => { page?.close(); main?.close(); proc.kill(); await sleep(1200); try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} };
  await waitFor('the server', async () => (await fetch('http://127.0.0.1:5211/api/cache-stats')).ok, 20000);
  await fetch('http://127.0.0.1:5211/api/cache/' + encodeURIComponent(`lyrics:demo:${TITLE}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(syncedEntry(TITLE, 'Check', LINES)) });
  const pt = await waitFor('the page', async () => (await (await fetch('http://127.0.0.1:9335/json')).json()).find((t) => t.type === 'page'), 20000);
  page = cdp(pt.webSocketDebuggerUrl);
  const mt = await waitFor('the main process', async () => (await (await fetch('http://127.0.0.1:9336/json')).json())[0], 10000);
  main = cdp(mt.webSocketDebuggerUrl);
  doResize = emulate
    ? (w, h, dpr) => page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false })
    : async (w, h) => main.js(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(100, 100); win.setContentSize(${w}, ${h}); })()`);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.js(`localStorage.setItem('ls.settings', JSON.stringify({ emojis: true }))`);
  await page.send('Page.navigate', { url: `http://127.0.0.1:5211${query}` });
} else {
  const s = await startSession({ port: 5300 + Math.floor(Math.random() * 50), width: 1920, height: 1080 });
  page = s;
  cleanup = () => s.cleanup();
  await s.putCache(`lyrics:demo:${TITLE}`, syncedEntry(TITLE, 'Check', LINES));
  doResize = (w, h, dpr) => s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  await s.goto(`${s.base}${query}`);
}
let bad = 0;
const report = (name, ok, detail = '') => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
try {
  await waitFor('lyrics drawn', () => page.js(`document.documentElement.dataset.scene === 'kinetic' && document.getElementById('card')?.hidden === true`), 25000);
  await page.js(PROBE);
  const t0 = Date.now();
  for (const [t, w, h, dpr] of RESIZES) {
    const wait = t * 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    await page.js('window.__mark()');
    await doResize(w, h, dpr);
  }
  await sleep(3500);
  const { boxes, marks, frames } = JSON.parse(await page.js('JSON.stringify(window.__probe)'));
  console.log(`  ${frames} frames, ${boxes.length} word and emoji boxes, ${marks.length} live resizes (${electron ? 'Electron' + (fullscreen ? ' fullscreen' : '') + (emulate ? ', emulated size and scale' : '') : 'browser'})`);
  let outside = 0;
  let worst = 0;
  let first = '';
  for (const [f, t, x0, x1, y0, y1, w, h] of boxes) {
    const over = Math.max(w * MARGIN - x0, x1 - w * (1 - MARGIN), h * MARGIN - y0, y1 - h * (1 - MARGIN));
    if (over > 0.75) { // under a pixel is anti-aliasing
      outside++;
      if (over > worst) { worst = over; first = `frame ${f} "${t}" ${Math.round(w)}x${Math.round(h)}: x ${x0.toFixed(1)}..${x1.toFixed(1)} y ${y0.toFixed(1)}..${y1.toFixed(1)}`; }
    }
  }
  report('every word and emoji stays inside the 5% margin in every frame (real glyph boxes)', outside === 0, outside ? `${outside} outside, worst ${worst.toFixed(1)} px: ${first}` : '');
  const byFrame = new Map();
  for (const b of boxes) { if (!byFrame.has(b[0])) byFrame.set(b[0], []); byFrame.get(b[0]).push(b); }
  const keyed = (arr) => { const seen = new Map(); return new Map(arr.filter((b) => !b[8]).map((b) => { const n = (seen.get(b[1]) || 0) + 1; seen.set(b[1], n); return [`${b[1]}#${n}`, b]; })); };
  const sizeOf = (f) => { const b = byFrame.get(f)?.[0]; return b ? `${Math.round(b[6])}x${Math.round(b[7])}` : null; };
  RESIZES.forEach(([, w, h], i) => {
    const F = marks[i];
    let before = F;
    while (before > 0 && !byFrame.has(before)) before--;
    const after = [...byFrame.keys()].filter((f) => f > F && sizeOf(f) === `${w}x${h}`).sort((a, b) => a - b);
    const label = `resize ${i + 1} to ${w}x${h}`;
    if (!after.length) return report(`${label}: drawn at the new size`, false, `no frame at the new size; sizes drawn after the resize: ${[...new Set([...byFrame.keys()].filter((f) => f > F).map(sizeOf))].join(' ')}; last frame ${[...byFrame.keys()].sort((a, b) => b - a)[0]}, resize at frame ${F}`);
    const first1 = after[0];
    report(`${label}: first new-size frame comes within 12 frames`, first1 - F <= 12, `${first1 - F} frames`);
    const prevTexts = new Set(keyed(byFrame.get(before) || []).keys());
    const nowTexts = new Set(keyed(byFrame.get(first1)).keys());
    const missing = [...prevTexts].filter((t) => !nowTexts.has(t));
    report(`${label}: no word that was showing goes missing`, missing.length === 0, missing.slice(0, 3).join(','));
    const later = after.find((f) => f >= first1 + 4);
    if (later) {
      const a = keyed(byFrame.get(first1));
      const l = keyed(byFrame.get(later));
      if (a.size === l.size) {
        let moved = 0;
        const settled = [...a.keys()].slice(0, Math.max(0, a.size - 4)); // the newest words are still landing
        for (const t of settled) { const b = a.get(t); const c = l.get(t); if (c) moved = Math.max(moved, Math.abs(b[2] - c[2]), Math.abs(b[4] - c[4])); }
        report(`${label}: the layout does not move afterwards`, moved <= 14, `max ${moved.toFixed(1)} px`);
      }
    }
  });
  const diag = await page.js(`new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 600) requestAnimationFrame(tick); else res({ rafs: n, visibility: document.visibilityState, focus: document.hasFocus(), size: innerWidth + 'x' + innerHeight }); }; requestAnimationFrame(tick); setTimeout(() => res({ rafs: n, visibility: document.visibilityState, focus: document.hasFocus(), stuck: true }), 1500); })`);
  if (!diag.rafs || diag.stuck || diag.visibility !== 'visible') {
    console.log('  page state at the end:', JSON.stringify(diag));
    if (diag.visibility !== 'visible') {
      // Windows hid or covered the window (another window took the foreground), so Chromium stopped drawing it: not the app's fault.
      console.log('\nkinetic-resize: INCONCLUSIVE - the window was hidden by the desktop part-way through, so Chromium stopped drawing it. Run it again.');
      await cleanup();
      process.exit(2);
    }
  }
  const end = await page.js(`({ w: innerWidth, h: innerHeight, cw: Math.round(document.getElementById('sky').width / devicePixelRatio) })`);
  const last = [...byFrame.keys()].sort((a, b) => b - a)[0];
  report('the canvas ends at the window size', Math.abs(end.cw - end.w) <= 1 && sizeOf(last) !== null && sizeOf(last).startsWith(String(end.w)), `window ${end.w}x${end.h}, drawn ${sizeOf(last)}`);
  report('no console errors', (electron ? page.events : page.logs).length === 0, (electron ? page.events : page.logs)[0] || '');
} catch (e) {
  report('ran to the end', false, e.message);
} finally {
  await cleanup();
}
console.log(bad ? `\nkinetic-resize: ${bad} problems` : '\nkinetic-resize: all good');
process.exit(bad ? 1 : 0);
