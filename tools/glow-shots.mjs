// Before/after pictures for blur and glow: the constellation (and a second scene) at 1920x1080 and at a 1920x1080
// screen with 200% Windows scaling (a 960x540 page at devicePixelRatio 2). Each size gives the whole frame and a crop
// of real device pixels around the sung word, to judge how crisp the text and stars are.
//   node --experimental-websocket tools/glow-shots.mjs OUT_DIR [scene ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const out = process.argv[2];
if (!out) {
  console.log('usage: node --experimental-websocket tools/glow-shots.mjs OUT_DIR [scene ...]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const scenes = process.argv.length > 3 ? process.argv.slice(3) : ['constellation', 'karaoke'];
const SIZES = [
  { name: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { name: '1080p-at-200pct', w: 960, h: 540, dpr: 2 },
];
const SONG = { title: 'Shot Song', artist: 'Check', album: 'S' };
const LYRICS = [
  [4, 'Hold me in the light tonight'],
  [9, 'Stars are falling slow and bright'],
  [14, 'Sing it back to me again'],
  [19, 'We walked through the endless city lights'],
];
const AT = 10.4; // part-way through the second line

const s = await startSession({ port: 5201, width: 1280, height: 720 });
let bad = 0;
try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  for (const size of SIZES) {
    await s.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: size.dpr, mobile: false });
    for (const scene of scenes) {
      const q = new URLSearchParams({ demo: '', ...SONG, duration: '60', start: String(AT), paused: '', seed: '7', scene });
      await s.goto(`${s.base}/?${q}`);
      await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === '${scene}'`), 10000);
      await sleep(1500);
      const info = await s.js(`({ w: innerWidth, dpr: devicePixelRatio, cw: document.getElementById('sky').width, ch: document.getElementById('sky').height })`);
      const full = await s.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(out, `${scene}-${size.name}.png`), Buffer.from(full.result.data, 'base64'));
      // Real device pixels (scale 1 of the device) around the middle of the sky.
      const clip = { x: size.w * 0.3, y: size.h * 0.32, width: size.w * 0.4, height: size.h * 0.3, scale: 1 };
      const crop = await s.send('Page.captureScreenshot', { format: 'png', clip });
      writeFileSync(path.join(out, `${scene}-${size.name}-crop.png`), Buffer.from(crop.result.data, 'base64'));
      // Numbers behind the picture: how much of the sky is not black, and how bright the darkest quarter is.
      const dark = await s.js(`(() => { const c = document.getElementById('sky'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0, sum = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; if (v > 0) lit++; sum += v; n++; } return { nonBlack: +(100 * lit / n).toFixed(2), meanLevel: +(sum / n / 3).toFixed(2) }; })()`);
      const ok = info.cw === Math.round(size.w * size.dpr);
      if (!ok) bad++;
      console.log(`  ${ok ? 'ok  ' : 'BAD '} ${scene} ${size.name}: page ${info.w} @${info.dpr}, canvas ${info.cw}x${info.ch}; ${dark.nonBlack}% of pixels not pure black, mean level ${dark.meanLevel}/255`);
    }
  }
  if (s.logs.length) {
    bad++;
    console.log('console errors:', s.logs.join(' | '));
  }
} finally {
  await s.cleanup();
}
console.log(bad ? `glow-shots: ${bad} problem(s)` : `glow-shots: pictures are in ${out}`);
process.exit(bad ? 1 : 0);
