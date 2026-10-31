// Screenshots of every scene at the screen sizes and Windows scaling levels that matter.
//   node --experimental-websocket tools/shots.mjs OUT_DIR [scene ...]
// Sizes are CSS pixels; "@1.5" is Windows scaling of 150% (a 1920x1080 screen then gives a 1280x720 page).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';
import { SCENE_IDS } from '../web/js/scenes/index.js';

const out = process.argv[2];
if (!out) {
  console.log('usage: node tools/shots.mjs OUT_DIR [scene ...]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const ALL = SCENE_IDS;
const scenes = process.argv.length > 3 ? process.argv.slice(3) : ALL;
const SIZES = [
  { name: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { name: '2560x1440', w: 2560, h: 1440, dpr: 1 },
  { name: '1080p-at-150pct', w: 1280, h: 720, dpr: 1.5 },
  { name: '1080p-at-200pct', w: 960, h: 540, dpr: 2 },
  { name: '1440p-at-150pct', w: 1707, h: 960, dpr: 1.5 },
  { name: '700x900', w: 700, h: 900, dpr: 1 },
];
const SONG = { title: 'Shot Song', artist: 'Check', album: 'S' };
const LYRICS = [
  [4, 'Hold me in the light tonight'],
  [9, 'Stars are falling slow and bright'],
  [14, 'Sing it back to me again'],
  [19, 'We walked through the endless city lights remembering every single promise we made under the quiet midnight sky'],
  [26, 'Hold me in the light tonight'],
  [31, 'And everything you do, yeah they were all yellow and gold'],
  [36, 'Hold me in the light tonight'],
];
const AT = Number(process.env.AT || 11.2); // seconds into the song: part-way through line 2

const s = await startSession({ port: 5200, width: 1280, height: 720 });
let errors = 0;
try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  for (const size of SIZES) {
    await s.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: size.dpr, mobile: false });
    for (const scene of scenes) {
      const q = new URLSearchParams({ demo: '', ...SONG, duration: '60', start: String(AT), paused: '', seed: '7', scene });
      await s.goto(`${s.base}/?${q}`);
      await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === '${scene}'`), 10000);
      await sleep(1300);
      const info = await s.js(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, cw: document.getElementById('sky').width, ch: document.getElementById('sky').height })`);
      const shot = await s.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(out, `${scene}-${size.name}.png`);
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
      const ok = info.w === size.w && info.dpr === size.dpr && info.cw === Math.round(size.w * size.dpr);
      if (!ok) errors++;
      console.log(`  ${ok ? 'ok  ' : 'BAD '} ${scene} ${size.name}: page ${info.w}x${info.h} @${info.dpr}, canvas ${info.cw}x${info.ch}`);
    }
  }
  if (s.logs.length) {
    errors++;
    console.log('console errors:', s.logs.join(' | '));
  }
} finally {
  await s.cleanup();
}
console.log(errors ? `shots: ${errors} problems` : 'shots: all sizes rendered, no console errors');
process.exit(errors ? 1 : 0);
