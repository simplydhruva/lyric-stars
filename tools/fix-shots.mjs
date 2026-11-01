// Screenshots of one scene at chosen moments, with chosen settings. Used to look at a change by eye.
//   node --experimental-websocket tools/fix-shots.mjs OUT_DIR --scene kinetic --at 4.2,9.2 [--size 1920x1080@1]
//        [--set '{"emojis":true}'] [--lyrics file.json] [--name label] [--hold 900] [--cover bright|dark|red|blue|busy]
// lyrics file: [[seconds, "text"], ...]. Prints one line per screenshot.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const args = process.argv.slice(2);
const out = args[0];
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
if (!out) {
  console.log('usage: node tools/fix-shots.mjs OUT_DIR --scene ID --at 4.2,9.2 [--size 1920x1080@1] [--set JSON] [--lyrics FILE] [--name LABEL]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const scene = opt('scene', 'kinetic');
const ats = opt('at', '11.2').split(',').map(Number);
const [, sw, sh, sd] = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(opt('size', '1280x720@1'));
const set = JSON.parse(opt('set', '{}'));
const label = opt('name', scene);
const hold = Number(opt('hold', 1300));
const SONG = { title: 'Shot Song', artist: 'Check', album: 'S' };
const LYRICS = opt('lyrics') ? JSON.parse(readFileSync(opt('lyrics'), 'utf8')) : [
  [4, 'Love is a burning fire tonight'],
  [9, 'Dancing under the moon and the stars'],
  [14, 'Tears fall like rain on the ocean'],
  [19, 'Kiss me in the sunshine, dream of me'],
  [24, 'We walked through the endless city lights'],
  [29, 'Hold me in the light tonight'],
];

const s = await startSession({ port: 5230 + Math.floor(Math.random() * 50), width: Number(sw), height: Number(sh) });
try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  await s.send('Emulation.setDeviceMetricsOverride', { width: Number(sw), height: Number(sh), deviceScaleFactor: Number(sd || 1), mobile: false });
  for (const at of ats) {
    await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: '60', start: String(at), paused: '', seed: '7', scene, ...(opt('cover') ? { demoCover: opt('cover') } : {}) })}`);
    await sleep(400);
    await s.js(`(() => { const all = JSON.parse(localStorage.getItem('ls.settings') || '{}'); Object.assign(all, ${JSON.stringify(set)}); localStorage.setItem('ls.settings', JSON.stringify(all)); })()`);
    await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: '60', start: String(at), paused: '', seed: '7', scene, ...(opt('cover') ? { demoCover: opt('cover') } : {}) })}`);
    await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === '${scene}'`), 10000);
    await sleep(hold);
    const jpeg = opt('format', 'png') === 'jpeg'; // film grain makes a PNG of a big picture very slow to encode
    const shot = await s.send('Page.captureScreenshot', jpeg ? { format: 'jpeg', quality: 92 } : { format: 'png' });
    const file = path.join(out, `${label}-${String(at).replace('.', '_')}s.${jpeg ? 'jpg' : 'png'}`);
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('saved', file);
  }
  if (s.logs.length) console.log('console errors:', s.logs.join(' | '));
} finally {
  await s.cleanup();
}
