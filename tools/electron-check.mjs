// Launches the real desktop app (electron/main.mjs) three times, once per display style, and checks it.
//   node --experimental-websocket tools/electron-check.mjs [OUT_DIR]
// It uses its own port (5210), its own data folder and the demo song, so your real app and settings are untouched.
// The page is driven over Electron's remote-debugging port, the main process over its inspector port.
// Windows flags (always on top, click-through) are read straight from the window with the Win32 API.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, sleep, waitFor, syncedEntry } from './lib/headless.mjs';

const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
// LYRICSTARS_EXE=<path to Lyric Stars.exe> checks an installed copy instead of the source tree.
const INSTALLED = process.env.LYRICSTARS_EXE;
const ELECTRON = INSTALLED || path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_ARG = INSTALLED ? [] : ['.'];
const PAGE_PORT = 9333;
const MAIN_PORT = 9334;
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

// WS_EX_TOPMOST = 0x8, WS_EX_TRANSPARENT = 0x20 (what click-through sets), WS_EX_LAYERED = 0x80000.
const PS = `
param([long]$h)
Add-Type -Namespace W -Name N -MemberDefinition '[DllImport("user32.dll")] public static extern long GetWindowLongPtr(System.IntPtr h, int i); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);'
$ex = [W.N]::GetWindowLongPtr([System.IntPtr]$h, -20)
"$ex $([W.N]::IsWindowVisible([System.IntPtr]$h))"
`;
const psFile = path.join(tmpdir(), 'ls-winflags.ps1');
writeFileSync(psFile, PS);
function winFlags(handle) {
  const [ex, visible] = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, String(handle)], { encoding: 'utf8' }).trim().split(' ');
  const n = Number(ex);
  return { topmost: (n & 0x8) !== 0, clickThrough: (n & 0x20) !== 0, visible: visible === 'True' };
}

async function run(style) {
  console.log(`\n[${style}]`);
  const work = mkdtempSync(path.join(tmpdir(), 'lyricstars-electron-'));
  mkdirSync(path.join(work, 'desktop'), { recursive: true });
  writeFileSync(path.join(work, 'desktop', 'desktop.json'), JSON.stringify({ style }));
  const start = '/?demo=&title=Electron+Check&artist=Check&duration=120&start=6&seed=7&scene=karaoke';
  const proc = spawn(ELECTRON, [...APP_ARG, `--remote-debugging-port=${PAGE_PORT}`, `--inspect=${MAIN_PORT}`], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, LYRICSTARS_PORT: '5210', LYRICSTARS_DATA: work, LYRICSTARS_START: start },
  });
  let page, main;
  try {
    // Seed the lyrics through the app's own server so the check does not depend on the network.
    await waitFor('the server', async () => (await fetch('http://127.0.0.1:5210/api/cache-stats')).ok, 20000);
    const lines = [[4, 'Hold me in the light tonight'], [9, 'Stars are falling slow and bright'], [14, 'Sing it back to me again'], [19, 'Never let it go away']];
    await fetch('http://127.0.0.1:5210/api/cache/' + encodeURIComponent('lyrics:demo:Electron Check'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(syncedEntry('Electron Check', 'Check', lines)) });
    const pt = await waitFor('the page', async () => (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'), 20000);
    const pg = cdp(pt.webSocketDebuggerUrl);
    await pg.send('Page.reload');
    pg.close();
    const pageTarget = await waitFor('the page', async () => (await (await fetch(`http://127.0.0.1:${PAGE_PORT}/json`)).json()).find((t) => t.type === 'page'), 20000);
    const mainTarget = await waitFor('the main process', async () => (await (await fetch(`http://127.0.0.1:${MAIN_PORT}/json`)).json())[0], 10000);
    page = cdp(pageTarget.webSocketDebuggerUrl);
    main = cdp(mainTarget.webSocketDebuggerUrl);
    await waitFor('lyrics drawn', () => page.js(`document.getElementById('card')?.hidden === true && document.documentElement.dataset.scene === 'karaoke'`), 20000);
    await sleep(1500);

    const mainJs = (body) =>
      main.js(`(() => { const { BrowserWindow, screen } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows()[0]; ${body} })()`);
    const info = await mainJs(`
      const d = screen.getDisplayMatching(w.getBounds());
      return { n: BrowserWindow.getAllWindows().length, top: w.isAlwaysOnTop(), full: w.isFullScreen(), bounds: w.getBounds(), display: d.bounds, frame: !w.isMenuBarVisible && w.getBounds().height !== w.getContentBounds().height, content: w.getContentBounds(), opacity: w.getOpacity(), handle: Number(w.getNativeWindowHandle().readBigUInt64LE(0)), visible: w.isVisible(), title: w.getTitle() };`);
    const sty = await page.js(`window.lyricStars.info().style`);
    check('opens exactly one window and the page reports the style', info.n === 1 && sty === style, `windows ${info.n}, style ${sty}`);
    check('window is visible', info.visible);
    const lit = await page.js(`(() => { const c = document.getElementById('sky'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 28) if (d[i] > 90) n++; return n; })()`);
    check('lyrics are drawn in the real app', lit > 15, `${lit} lit samples`);
    const errs = await page.js(`document.title`);
    const sizes = await page.js(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, cw: document.getElementById('sky').width })`);
    console.log(`  window ${info.bounds.width}x${info.bounds.height} at ${info.bounds.x},${info.bounds.y}; page ${sizes.w}x${sizes.h} @${sizes.dpr}; display ${info.display.width}x${info.display.height}; title "${errs}"`);

    if (style === 'fullscreen') {
      check('fullscreen: Electron says full screen', info.full);
      check('fullscreen: covers the whole display', info.bounds.width === info.display.width && info.bounds.height === info.display.height, `${info.bounds.width}x${info.bounds.height} vs ${info.display.width}x${info.display.height}`);
    } else if (style === 'window') {
      check('window: normal framed window, not full screen', !info.full && info.bounds.width < info.display.width);
      check('window: not forced on top', !info.top);
    } else {
      check('overlay: always on top (Electron)', info.top);
      const f = winFlags(info.handle);
      check('overlay: always on top (Windows topmost flag)', f.topmost);
      check('overlay: frameless transparent window', info.content.width === info.bounds.width && info.content.height === info.bounds.height, `bounds ${info.bounds.width}x${info.bounds.height}`);
      check('overlay: click-through starts off', !f.clickThrough);
      await page.js(`window.lyricStars.setOverlay({ clickThrough: true })`);
      await sleep(600);
      const on = winFlags(info.handle);
      check('overlay: click-through on makes clicks pass through (Windows transparent flag)', on.clickThrough && on.topmost, JSON.stringify(on));
      const moved = await page.js(`window.lyricStars.info().overlay.clickThrough`);
      check('overlay: the page is told click-through is on', moved === true);
      await page.js(`window.lyricStars.setOverlay({ clickThrough: false })`);
      await sleep(600);
      check('overlay: click-through off again', !winFlags(info.handle).clickThrough);
    }
    if (out) {
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(out, `electron-${style}.png`);
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
      console.log(`  screenshot ${file}`);
    }
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
}

for (const style of ['window', 'fullscreen', 'overlay']) await run(style);
console.log(bad ? `\nelectron: ${bad} problems` : '\nelectron: all three display styles opened and behaved');
process.exit(bad ? 1 : 0);
