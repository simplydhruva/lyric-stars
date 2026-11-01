// Screenshots of the Reel scene for looking at it by eye: five fake covers, several screen sizes, the special moments
// (hard cut, mid zoom, RGB split, masked hero, double exposure, long line, a line of 3 fonts, a missing-glyph line).
//   node --experimental-websocket tools/reel-shots.mjs OUT_DIR [--only covers|moments|sizes|fonts|fixes] [--reduce]
// Pictures are JPEG: the film grain makes PNGs very slow to encode. Prints one line per picture.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const out = process.argv[2];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : 'all';
if (!out) {
  console.log('usage: node --experimental-websocket tools/reel-shots.mjs OUT_DIR [--only covers|moments|sizes|fonts]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const SONG = { title: 'Reel Song', artist: 'Check', album: 'S' };
const LYRICS = [
  [3, 'Love is a burning fire tonight'],
  [8, 'Dancing under the moon and the stars'],
  [13, 'Tears fall like rain on the ocean'],
  [18, 'In the middle of the night when the stars are bright and the world is quiet and still and nobody knows my name at all'],
  [23, 'Kiss me in the sunshine, dream of me'],
  [28, 'Café “Ñandú” Ωmega 愛 ♥ 100% 😀 don’t'],
  [33, 'Hold me closer tonight'],
];
const COVERS = ['bright', 'dark', 'red', 'blue', 'busy'];

const s = await startSession({ port: 5300 + Math.floor(Math.random() * 50), width: 1920, height: 1080, reduceMotion: process.argv.includes('--reduce') });
const log = [];
async function load(cover, size, at, hold = 900) {
  const [w, h, d = 1] = size;
  await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d, mobile: false });
  await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: '60', start: String(at), paused: '', seed: '7', scene: 'reel', demoCover: cover })}`);
  await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === 'reel'`), 15000);
  await waitFor('reel stats', () => s.js(`!!globalThis.__reelStats && globalThis.__reelStats.li >= 0 && globalThis.__reelStats.cover === true`), 15000);
  await sleep(hold);
  return JSON.parse(await s.js(`JSON.stringify(globalThis.__reelStats)`));
}
async function shot(name, cover, size, at, hold) {
  const st = await load(cover, size, at, hold);
  const r = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  const file = path.join(out, `${name}.jpg`);
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  const info = `${name}: line ${st.li} ${st.kind} fonts[${st.fonts}] strong=${st.strong} ghost=${st.ghost} masked=${st.masked} sprites=${st.sprites} canvases=${st.canvases}`;
  console.log('saved', file, '|', info);
  log.push({ name, file, ...st });
  return st;
}

try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  const FHD = [1920, 1080, 1];
  if (only === 'all' || only === 'covers') {
    for (const c of COVERS) {
      await shot(`cover-${c}-a`, c, FHD, 4.4);
      await shot(`cover-${c}-b`, c, FHD, 10.5);
    }
  }
  if (only === 'all' || only === 'moments') {
    // learn what each line uses on the dark cover
    const info = [];
    for (let i = 0; i < LYRICS.length; i++) info.push(await load('dark', FHD, LYRICS[i][0] + 1.5, 300));
    console.log('lines:', info.map((x, i) => `${i}:${x.kind}${x.strong ? '*' : ''}${x.ghost ? 'g' : ''}${x.masked ? 'M' : ''}`).join(' '));
    const strong = info.findIndex((x) => x.strong);
    const ghost = info.findIndex((x, i) => x.ghost && i > 0);
    if (strong >= 0) {
      const t0 = LYRICS[strong][0];
      const hs = info[strong].heroStart / 1000;
      await shot('moment-hard-cut', 'dark', FHD, t0 + 0.03, 300);
      await shot('moment-mid-zoom', 'dark', FHD, t0 + 0.075, 300);
      await shot('moment-rgb-split', 'dark', FHD, hs + 0.035, 300);
    }
    if (ghost >= 0) await shot('moment-double-exposure', 'dark', FHD, LYRICS[ghost][0] + 0.15, 300);
    for (const c of ['dark', 'red', 'blue', 'busy']) {
      const m = [];
      for (let i = 0; i < LYRICS.length; i++) m.push(await load(c, FHD, LYRICS[i][0] + 2.5, 300));
      const k = m.findIndex((x) => x.masked);
      console.log(`masks on ${c}:`, m.map((x, i) => `${i}${x.masked ? 'M' : '-'}`).join(' '));
      if (k >= 0) {
        await shot(`moment-masked-${c}`, c, FHD, LYRICS[k][0] + 2.5, 400);
        break;
      }
    }
    await shot('moment-long-line', 'blue', FHD, 18 + 6.5);
  }
  if (only === 'all' || only === 'fonts') {
    await shot('line-missing-glyphs', 'dark', FHD, 28 + 4);
    for (let i = 0; i < LYRICS.length; i++) {
      const st = await shot(`lines-${i}`, 'red', FHD, LYRICS[i][0] + 4.2, 300);
      void st;
    }
  }
  if (only === 'fixes') {
    // the two layout fixes: the BURNING line, and the very long line, at three sizes
    await shot('fix-burning', 'busy', FHD, 4.4);
    await shot('fix-long-1920', 'blue', FHD, 22.9);
    await shot('fix-long-700x900', 'blue', [700, 900, 1], 22.9);
    await shot('fix-long-1280x720-200pct', 'blue', [1280, 720, 2], 22.9);
  }
  if (only === 'all' || only === 'sizes') {
    for (const [name, size] of [['2560x1440', [2560, 1440, 1]], ['700x900', [700, 900, 1]], ['1280x720-at-200pct', [1280, 720, 2]], ['1920x1080-at-150pct', [1920, 1080, 1.5]]]) {
      await shot(`size-${name}-a`, 'red', size, 9.8);
      await shot(`size-${name}-long`, 'busy', size, 24.5);
    }
  }
  writeFileSync(path.join(out, 'index.json'), JSON.stringify(log, null, 1));
  if (s.logs.length) console.log('console errors:', s.logs.join(' | '));
} finally {
  await s.cleanup();
}
