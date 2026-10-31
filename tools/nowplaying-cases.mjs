// The "now playing" scene for every no-lyrics case, driven through the real Spotify source with the fake song
// source: lyrics not found, lyrics service error (502), instrumental, found but not timed. Checks the label, the
// largest cover, that Pause freezes the movement and that reduce motion turns it off; saves a picture of each case.
//   node --experimental-websocket tools/nowplaying-cases.mjs OUT_DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startSession, waitFor, sleep } from './lib/headless.mjs';
import { FakeSpotify, installFake, seedLogin } from './lib/fake-spotify.mjs';

const out = process.argv[2];
if (!out) {
  console.log('usage: node --experimental-websocket tools/nowplaying-cases.mjs OUT_DIR');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const svg = (size, a, b) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="50%" cy="50%" r="28%" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="${size / 40}"/></svg>`)}`;
const IMAGES = [
  { url: svg(300, '#c0392b', '#2c3e50'), width: 300, height: 300 },
  { url: svg(640, '#c0392b', '#2c3e50'), width: 640, height: 640 },
  { url: svg(64, '#c0392b', '#2c3e50'), width: 64, height: 64 },
];
const base = { type: 'track', album: 'Cover Album', artist: 'Test Band', duration_ms: 200_000, images: IMAGES, lyrics: null };
const CASES = [
  { name: 'not-found', label: 'Lyrics not found', song: { ...base, id: 'c1', name: 'Song With No Lyrics' } },
  { name: 'service-error', label: 'Lyrics service unreachable', song: { ...base, id: 'c2', name: 'Song While Service Is Down', service: 'error' } },
  { name: 'instrumental', label: 'Instrumental', song: { ...base, id: 'c3', name: 'Song Without Words', instrumental: true } },
  { name: 'not-timed', label: 'Lyrics found but not timed', song: { ...base, id: 'c4', name: 'Song With Plain Lyrics', plain: 'one\ntwo\nthree' } },
];

let bad = 0;
const check = (ok, text) => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`);
};

for (const c of CASES) {
  console.log(c.name);
  const s = await startSession({ port: 5202, width: 1280, height: 720 });
  try {
    const fake = new FakeSpotify([c.song]);
    await installFake(s, fake);
    await s.goto(`${s.base}/?mockprep`);
    await seedLogin(s);
    await s.goto(`${s.base}/`);
    await waitFor('the label', () => s.js(`document.querySelector('.np-label')?.textContent === ${JSON.stringify(c.label)}`), 20000);
    check(true, `label "${c.label}"`);
    const info = await s.js(`({ title: document.querySelector('.np-title').textContent, artist: document.querySelector('.np-artist').textContent, src: document.querySelector('.np-cover img')?.src || '', retry: !!document.querySelector('.np-retry') && getComputedStyle(document.querySelector('.np-retry')).display !== 'none' })`);
    check(info.title === c.song.name && info.artist === c.song.artist, `shows "${info.title}" by ${info.artist}`);
    check(info.src === IMAGES[1].url, 'cover is the largest image (640 px)');
    check(info.retry, 'Retry button is there');
    await sleep(800);
    const moving = await s.js(`(() => { const a = getComputedStyle(document.querySelector('.np-float')).transform; return new Promise((r) => setTimeout(() => r(a !== getComputedStyle(document.querySelector('.np-float')).transform), 900)); })()`);
    check(moving, 'cover floats while playing');
    writeFileSync(path.join(out, `${c.name}.png`), Buffer.from((await s.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

    if (c.name === 'not-found') {
      fake.pause();
      await sleep(7000); // the app polls Spotify every few seconds
      const frozen = await s.js(`(() => { const a = getComputedStyle(document.querySelector('.np-float')).transform; return new Promise((r) => setTimeout(() => r(a === getComputedStyle(document.querySelector('.np-float')).transform), 1200)); })()`);
      check(frozen, 'Pause freezes the cover');
      fake.play();
      await s.js(`localStorage.setItem('ls.settings', JSON.stringify({ ...(JSON.parse(localStorage.getItem('ls.settings') || '{}')), reduceMotion: true }))`);
      await s.goto(`${s.base}/`);
      await waitFor('the label again', () => s.js(`document.querySelector('.np-label')?.textContent === ${JSON.stringify(c.label)}`), 20000);
      await sleep(800);
      const still = await s.js(`(() => { const a = getComputedStyle(document.querySelector('.np-float')).transform; return new Promise((r) => setTimeout(() => r(a === getComputedStyle(document.querySelector('.np-float')).transform), 1200)); })()`);
      check(still, 'reduce motion keeps the cover still');
    }
    if (c.name === 'service-error') {
      const first = fake.requests.filter((r) => r.includes('lrclib')).length;
      await s.js(`document.querySelector('.np-retry').click()`);
      await sleep(1500);
      check(fake.requests.filter((r) => r.includes('lrclib')).length > first, 'Retry asks the lyrics service again');
      const cached = await s.js(`(async () => (await indexedDB.databases?.() || []).map((d) => d.name).join(','))()`);
      console.log(`  (databases: ${cached})`);
    }
    if (s.logs.length) {
      bad++;
      console.log('  console errors:', s.logs.join(' | '));
    }
  } finally {
    await s.cleanup();
  }
}
console.log(bad ? `nowplaying-cases: ${bad} problem(s)` : `nowplaying-cases: all ok, pictures in ${out}`);
process.exit(bad ? 1 : 0);
