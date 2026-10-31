// Screenshots of every theme (and the album-color theme, using a fake cover) in every scene.
//   node --experimental-websocket tools/themes.mjs OUT_DIR
// Checks that the lyrics really change color with the theme, and that the page makes no errors.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const out = process.argv[2];
if (!out) {
  console.log('usage: node tools/themes.mjs OUT_DIR');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

// A small PNG with three bands (purple, teal, purple), standing in for an album cover.
function coverPng() {
  const size = 64;
  const bands = [[120, 60, 200], [40, 190, 170], [120, 60, 200]];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) bands[Math.floor((x / size) * 3)].forEach((v, i) => (raw[y * (size * 3 + 1) + 1 + x * 3 + i] = v));
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SCENES = ['constellation', 'karaoke', 'stack', 'kinetic'];
const THEMES = [
  ['gold', { theme: 'gold' }],
  ['ice', { theme: 'ice' }],
  ['rose', { theme: 'rose' }],
  ['sunset', { theme: 'sunset' }],
  ['custom', { theme: 'custom', customColor: '#7bd88f' }],
  ['album', { theme: 'gold', albumColors: true }],
];
const SONG = { title: 'Theme Song', artist: 'Check', album: 'S' };
const LYRICS = [[4, 'Hold me in the light tonight'], [9, 'Stars are falling slow and bright'], [14, 'Sing it back to me again'], [19, 'Never let it go away']];

const s = await startSession({ port: 5213, width: 1280, height: 720 });
let bad = 0;
try {
  const png = coverPng().toString('base64');
  await s.send('Fetch.enable', { patterns: [{ urlPattern: 'https://i.scdn.co/*' }] });
  s.on('Fetch.requestPaused', (p) =>
    s.send('Fetch.fulfillRequest', {
      requestId: p.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: png,
    })
  );
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  await s.goto(`${s.base}/?prep`);
  // Mean colour of the bright pixels on the canvas: what the lyrics look like.
  const tint = () =>
    s.js(`(() => { const c = document.getElementById('sky'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 330) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return n ? [r / n, g / n, b / n].map(Math.round) : null; })()`);
  const seen = {};
  for (const [name, setting] of THEMES) {
    await s.js(`localStorage.setItem('ls.settings', ${JSON.stringify(JSON.stringify(setting))})`);
    for (const scene of SCENES) {
      const q = new URLSearchParams({ demo: '', ...SONG, duration: '60', start: '11.2', paused: '', seed: '7', scene, art: 'https://i.scdn.co/image/fake' });
      await s.goto(`${s.base}/?${q}`);
      await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === '${scene}'`), 10000);
      await sleep(1500);
      const c = await tint();
      (seen[scene] ||= {})[name] = c;
      const shot = await s.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(out, `theme-${name}-${scene}.png`), Buffer.from(shot.result.data, 'base64'));
      console.log(`  ${scene.padEnd(14)} ${name.padEnd(7)} lyrics colour ${c ? c.join(',') : 'none drawn'}`);
      if (!c) bad++;
    }
  }
  // Each theme should give lyrics a different tint in every scene.
  for (const scene of SCENES) {
    const names = Object.keys(seen[scene]);
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const a = seen[scene][names[i]];
        const b = seen[scene][names[j]];
        if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 8) {
          bad++;
          console.log(`  FAIL ${scene}: ${names[i]} and ${names[j]} look the same (${a} vs ${b})`);
        }
      }
  }
  if (s.logs.length) {
    bad++;
    console.log('console errors:', s.logs.join(' | '));
  }
} finally {
  await s.cleanup();
}
console.log(bad ? `themes: ${bad} problems` : 'themes: every theme tints every scene, no errors');
process.exit(bad ? 1 : 0);
