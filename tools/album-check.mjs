// Album colours: five fake covers of different colours (plus a grey one and one that cannot be read) are served in
// place of Spotify's image host, and the real app is shown with each. Checks the palette that was extracted and that
// the stars on screen took its colour, saves a screenshot of each scene with each cover.
//   node --experimental-websocket tools/album-check.mjs OUT_DIR [scene ...]
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const out = process.argv[2];
if (!out) {
  console.log('usage: node tools/album-check.mjs OUT_DIR [scene ...]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const scenes = process.argv.length > 3 ? process.argv.slice(3) : ['constellation', 'kinetic', 'karaoke', 'neon'];

// 64x64 PNG: the main colour on top, a second colour at the bottom (both fully inside the picture).
function png(top, bottom) {
  const w = 64;
  const raw = Buffer.alloc((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(y < 40 ? top : bottom, y * (w * 3 + 1) + 1 + x * 3);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(w, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// name -> [top colour, bottom colour, expected hue family (or null), served with CORS?]
const COVERS = {
  red: [[200, 30, 40], [120, 20, 30], 'red', true],
  green: [[40, 170, 70], [20, 100, 50], 'green', true],
  blue: [[40, 90, 220], [20, 50, 140], 'blue', true],
  purple: [[150, 50, 200], [90, 30, 130], 'purple', true],
  orange: [[240, 140, 30], [160, 80, 20], 'orange', true],
  grey: [[128, 128, 128], [90, 90, 90], null, true],
  flaky: [[40, 90, 220], [20, 50, 140], 'blue', true], // the first request fails (500), later ones work
  blocked: [[200, 30, 40], [120, 20, 30], null, false], // no CORS header: the picture shows but its pixels cannot be read
};
const hueOf = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return -1;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const FAMILY = { red: [345, 15], orange: [15, 45], green: [90, 160], blue: [200, 250], purple: [260, 310] };
const inFamily = (h, fam) => { const [a, b] = FAMILY[fam]; return a > b ? h >= a || h <= b : h >= a && h <= b; };

const SONG = { title: 'Cover Song', artist: 'Check', album: 'S' };
const LYRICS = [[3, 'Hold me in the light tonight'], [8, 'Stars are falling slow and bright'], [13, 'Sing it back to me again'], [18, 'We walked through the city']];
const s = await startSession({ port: 5400 + Math.floor(Math.random() * 90), width: 1280, height: 720 });
let bad = 0;
let flakyFailed = false;
try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  s.on('Fetch.requestPaused', (p) => {
    const name = p.request.url.split('/image/')[1]?.split('?')[0];
    const c = COVERS[name];
    if (!c) return s.send('Fetch.continueRequest', { requestId: p.requestId });
    if (name === 'flaky' && !flakyFailed) {
      flakyFailed = true;
      return s.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 500, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' });
    }
    const headers = [{ name: 'Content-Type', value: 'image/png' }, ...(c[3] ? [{ name: 'Access-Control-Allow-Origin', value: '*' }] : [])];
    return s.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: headers, body: png(c[0], c[1]).toString('base64') });
  });
  await s.send('Fetch.enable', { patterns: [{ urlPattern: 'https://i.scdn.co/*' }] });
  for (const [name, [, , fam]] of Object.entries(COVERS)) {
    const url = `https://i.scdn.co/image/${name}`;
    for (const scene of scenes) {
      await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: '60', start: '9.5', paused: '', seed: '7', scene, art: url })}`);
      await s.js(`(() => { const a = JSON.parse(localStorage.getItem('ls.settings') || '{}'); a.albumColors = true; localStorage.setItem('ls.settings', JSON.stringify(a)); })()`);
      await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: '60', start: '9.5', paused: '', seed: '7', scene, art: url })}`);
      await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === '${scene}'`), 10000);
      await sleep(name === 'flaky' ? 5500 : 1500);
      const shot = await s.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(out, `${scene}-${name}.png`), Buffer.from(shot.result.data, 'base64'));
      if (scene !== scenes[0]) continue;
      // what the app extracted, and the colour of the brightest lit pixel on screen
      let pal = await s.js(`import('/js/palette.js').then((m) => m.albumPalette(${JSON.stringify(url)}))`);
      if (name === 'flaky') { console.log(`  (first read of the flaky cover: ${JSON.stringify(pal)})`); pal = await s.js(`import('/js/palette.js').then((m) => m.albumPalette(${JSON.stringify(url)}))`); }
      const lit = await s.js(`(() => { const c = document.getElementById('sky'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, Math.round(c.height * 0.8)).data; let best = [0, 0, 0], bs = 0; for (let i = 0; i < d.length; i += 4) { const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); const v = Math.max(d[i], d[i + 1], d[i + 2]); const sc = sat * 2 + v; if (v > 110 && sat > 30 && sc > bs) { bs = sc; best = [d[i], d[i + 1], d[i + 2]]; } } return best; })()`);
      const h = hueOf(lit);
      const ok = fam ? pal.length > 0 && inFamily(hueOf(pal[0]), fam) && inFamily(h, fam) : pal.length === 0;
      if (!ok) bad++;
      console.log(`  ${ok ? 'ok  ' : 'BAD '} ${name.padEnd(7)} palette ${JSON.stringify(pal)} -> brightest coloured pixel ${JSON.stringify(lit)} (hue ${Math.round(h)})`);
    }
  }
  const warn = s.logs.filter((l) => !/Failed to load resource|CORS|tainted/i.test(l));
  if (warn.length) console.log('console errors:', warn.join(' | '));
} finally {
  await s.cleanup();
}
console.log(bad ? `album-check: ${bad} problems` : 'album-check: every cover tinted the sky as expected');
process.exit(bad ? 1 : 0);
