// Screenshots and checks of the Pixel scene: sizes, palettes, HUD/CRT on and off, five fake covers and none, long line, idle gap.
//   node --experimental-websocket tools/pixel-shots.mjs OUT_DIR [--only basic|palettes|sizes|covers|options]
// Pictures are PNG (the point is to see crisp pixels). Each prints a line with the scene's own numbers.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const out = process.argv[2];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : 'all';
if (!out) {
  console.log('usage: node --experimental-websocket tools/pixel-shots.mjs OUT_DIR [--only basic|palettes|sizes|covers|options]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const SONG = { title: 'Pixel Song With A Rather Long Title', artist: 'The Check Band', album: 'S' };
const LYRICS = [
  [8, 'Love is a burning fire tonight'],
  [13, 'Dancing under the moon and the stars'],
  [26, 'In the middle of the night when the stars are bright and the world is quiet and still and nobody knows my name at all and the rain keeps falling'],
  [38, 'Hold me closer tonight'],
  [42, 'Tears fall like rain'],
];
const s = await startSession({ port: 5400 + Math.floor(Math.random() * 50), width: 1920, height: 1080 });
const log = [];
async function load(opts = {}) {
  const { cover, size = [1920, 1080, 1], at = 9.2, settings = {}, hold = 700 } = opts;
  const [w, h, d = 1] = size;
  await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d, mobile: false });
  const q = { demo: '', ...SONG, duration: '60', start: String(at), paused: '', seed: '7', scene: 'pixel', ...(cover ? { demoCover: cover } : {}) };
  await s.goto(`${s.base}/?${new URLSearchParams(q)}`);
  await waitFor('app', () => s.js(`document.documentElement.dataset.scene === 'pixel'`), 15000);
  await s.js(`localStorage.setItem('ls.settings', JSON.stringify(${JSON.stringify(settings)}))`);
  if (Object.keys(settings).length) await s.goto(`${s.base}/?${new URLSearchParams(q)}`);
  await waitFor('stats', () => s.js(`!!globalThis.__pixelStats && globalThis.__pixelStats.fontsReady`), 15000);
  await sleep(hold);
  return JSON.parse(await s.js(`JSON.stringify(globalThis.__pixelStats)`));
}
async function shot(name, opts) {
  const st = await load(opts);
  const r = await s.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(out, `${name}.png`);
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('saved', file, '|', `scale=${st.scale} logical=${st.lw}x${st.lh} cover=${(st.coverage * 100).toFixed(1)}% main=${st.main} idle=${st.idle} size=${st.size} rows=${st.rows} sprites=${st.sprites}`);
  log.push({ name, ...st });
  return st;
}
try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  if (only === 'all' || only === 'basic') {
    await shot('normal-line', { cover: 'bright', at: 9.4 });
    await shot('long-wrapped', { cover: 'blue', at: 29 });
    await shot('idle', { cover: 'red', at: 22.5 });
    await shot('dissolve', { cover: 'bright', at: 12.9, hold: 40 });
  }
  if (only === 'all' || only === 'sizes') {
    for (const [n, sz] of [['2560x1440', [2560, 1440, 1]], ['700x900', [700, 900, 1]], ['1280x720-200pct', [1280, 720, 2]], ['1920x1080-150pct', [1920, 1080, 1.5]]]) await shot(`size-${n}`, { cover: 'busy', size: sz });
  }
  if (only === 'all' || only === 'covers') {
    for (const c of ['bright', 'dark', 'red', 'blue', 'busy', null]) await shot(`cover-${c || 'none'}-idle`, { cover: c || undefined, at: 22.5 });
  }
  if (only === 'all' || only === 'palettes') {
    for (const p of ['dreamy', 'sunset', 'green']) await shot(`palette-${p}`, { cover: 'bright', at: 9.4, settings: { pixelPalette: p } });
    await shot('palette-dreamy-album-red', { cover: 'red', at: 9.4, settings: { pixelAlbum: true } });
    await shot('font-silkscreen', { cover: 'bright', at: 9.4, settings: { pixelFont: 'silk' } });
  }
  if (only === 'all' || only === 'options') {
    for (const [n, st] of [['nohud', { pixelHud: false }], ['nocrt', { pixelCrt: false }], ['plain', { pixelHud: false, pixelCrt: false }], ['portrait', { pixelScreen: 'portrait' }], ['chunky', { pixelSize: 'chunky' }], ['fine', { pixelSize: 'fine' }]]) await shot(`opt-${n}`, { cover: 'blue', at: 9.4, settings: st });
    await shot('opt-portrait-idle', { cover: 'red', at: 22.5, settings: { pixelScreen: 'portrait' } });
    await shot('opt-nohud-idle-nocover', { at: 22.5, settings: { pixelHud: false } });
  }
  writeFileSync(path.join(out, 'index.json'), JSON.stringify(log, null, 1));
  if (s.logs.length) console.log('console errors:', s.logs.join(' | '));
} finally {
  await s.cleanup();
}
