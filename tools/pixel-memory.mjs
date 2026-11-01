// 10-minute memory loop in the Pixel scene: the demo song loops (with instrumental gaps), the window is
// resized now and then. Every 30 s: JS heap, cached canvases (from the scene's own counters), frames per second.
//   node --experimental-websocket tools/pixel-memory.mjs [--minutes 10]
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';
const i = process.argv.indexOf('--minutes');
const minutes = i > 0 ? Number(process.argv[i + 1]) : 10;
const SONG = { title: 'Pixel Soak', artist: 'Check', album: 'S' };
const W = ['Hold me in the light tonight', 'Stars are falling slow and bright', 'Sing it back to me again', 'We walked through the endless city lights remembering every single promise we made'];
const LYRICS = Array.from({ length: 8 }, (_, n) => [n * 7 + 1, W[n % W.length]]);
const s = await startSession({ port: 5213, width: 1280, height: 720 });
const metrics = async () => Object.fromEntries((await s.send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]));
try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: '60', start: '2', scene: 'pixel', demoCover: 'busy' })}`);
  await waitFor('reel', () => s.js(`!!globalThis.__pixelStats && globalThis.__pixelStats.fontsReady`), 15000);
  await s.send('Performance.enable');
  await s.js(`window.__f = 0; (function t() { window.__f++; requestAnimationFrame(t); })()`);
  const rows = [];
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < minutes * 60000) {
    const f0 = await s.js('window.__f');
    for (let k = 0; k < 6; k++) {
      await sleep(5000);
      if (++n % 12 === 0) await s.send('Emulation.setDeviceMetricsOverride', { width: n % 24 === 0 ? 1280 : 1000, height: n % 24 === 0 ? 720 : 800, deviceScaleFactor: 1, mobile: false });
    }
    const f1 = await s.js('window.__f');
    const m = await metrics();
    const st = JSON.parse(await s.js('JSON.stringify(globalThis.__pixelStats)'));
    const row = { min: ((Date.now() - t0) / 60000).toFixed(1), heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), canvases: st.canvases, sprites: st.sprites, texts: st.texts, main: st.main, fps: +((f1 - f0) / 30).toFixed(1) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const h = rows.map((r) => r.heapMB);
  console.log(`heap first ${h[0]} MB, last ${h[h.length - 1]} MB, max ${Math.max(...h)} MB; canvases max ${Math.max(...rows.map((r) => r.canvases))}`);
  if (s.logs.length) console.log('console errors:', s.logs.join(' | '));
} finally {
  await s.cleanup();
}
