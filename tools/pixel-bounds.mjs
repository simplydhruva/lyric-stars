// Checks of the Pixel scene in a real (headless) browser:
//  - text stays inside the safe area, and the logical screen fills 95 percent or more of the window, at several sizes and both Screen options
//  - pixels are crisp: every logical pixel is an exact scale x scale block on the real canvas (no smoothing, no blur)
//  - each word is bright cream on its start frame (read back from the logical screen, CRT off)
//   node --experimental-websocket tools/pixel-bounds.mjs
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const SONG = { title: 'Bounds Song', artist: 'Check', album: 'S' };
const LYRICS = [
  [4, 'Love is a burning fire tonight'],
  [12, 'In the middle of the night when the stars are bright and the world is quiet and still and nobody knows my name at all and the rain keeps falling'],
  [24, 'Café “Ñandú” Ωmega 愛 ♥ 100% 😀 don’t'],
  [30, 'Supercalifragilisticexpialidocious Pneumonoultramicroscopicsilicovolcanoconiosis Hippopotomonstrosesquippedaliophobia'],
];
const s = await startSession({ port: 5500 + Math.floor(Math.random() * 40), width: 1920, height: 1080 });
let bad = 0;
const fail = (m) => { bad++; console.log('FAIL', m); };
async function load(size, at, settings = {}) {
  const [w, h, d = 1] = size;
  await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d, mobile: false });
  await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', title: SONG.title, artist: SONG.artist, album: 'S', duration: '60', start: String(at), paused: '', seed: '3', scene: 'pixel', demoCover: 'bright' })}`);
  await waitFor('pixel', () => s.js(`document.documentElement.dataset.scene === 'pixel'`), 15000);
  await s.js(`globalThis.__pixelProbe = true; localStorage.setItem('ls.settings', JSON.stringify(${JSON.stringify(settings)}));`);
  if (Object.keys(settings).length) { await s.goto(s.base + '/?' + new URLSearchParams({ demo: '', title: SONG.title, artist: SONG.artist, album: 'S', duration: '60', start: String(at), paused: '', seed: '3', scene: 'pixel', demoCover: 'bright' })); await s.js('globalThis.__pixelProbe = true'); }
  await waitFor('stats', () => s.js(`!!globalThis.__pixelStats && globalThis.__pixelStats.fontsReady && globalThis.__pixelStats.main >= 0`), 15000);
  await sleep(500);
  return JSON.parse(await s.js(`JSON.stringify(globalThis.__pixelStats)`));
}
// every scale x scale block of the real canvas is one colour
const CRISP = (st) => `(() => {
  const c = document.getElementById('sky'); const g = c.getContext('2d');
  const { scale, lw, lh, ox, oy } = ${JSON.stringify({ scale: st.scale, lw: st.lw, lh: st.lh, ox: st.ox, oy: st.oy })};
  const d = g.getImageData(ox, oy, lw * scale, lh * scale).data; const W = lw * scale; let mixed = 0, total = 0;
  for (let y = 0; y < lh; y += 2) for (let x = 0; x < lw; x += 3) {
    total++; const i0 = ((y * scale) * W + x * scale) * 4; let ok = true;
    for (let yy = 0; yy < scale && ok; yy++) for (let xx = 0; xx < scale; xx++) { const i = ((y * scale + yy) * W + x * scale + xx) * 4; if (d[i] !== d[i0] || d[i+1] !== d[i0+1] || d[i+2] !== d[i0+2]) { ok = false; break; } }
    if (!ok) mixed++;
  }
  const out = { mixed, total, around: [ox, oy, c.width - ox - lw * scale, c.height - oy - lh * scale], cw: c.width, ch: c.height };
  return JSON.stringify(out); })()`;

try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  const sizes = [['1920x1080', [1920, 1080, 1]], ['2560x1440', [2560, 1440, 1]], ['700x900', [700, 900, 1]], ['1280x720@200%', [1280, 720, 2]], ['1920x1080@150%', [1920, 1080, 1.5]], ['400x800', [400, 800, 1]]];
  for (const [name, size] of sizes) {
    for (const screen of ['fill', 'portrait']) {
      for (const [lineName, at] of [['normal', 5.5], ['long', 14], ['symbols', 25.5], ['giant-words', 31.5]]) {
        const st = await load(size, at, { pixelScreen: screen });
        const r = JSON.parse(await s.js(CRISP(st)));
        const tag = `${name} ${screen} ${lineName}`;
        if (r.mixed) fail(`${tag}: ${r.mixed}/${r.total} sampled logical pixels are not one solid ${st.scale}x${st.scale} block`);
        if (screen === 'fill' && st.coverage < 0.95) fail(`${tag}: coverage ${st.coverage}`);
        if (st.rects) for (const [wi, rs] of st.rects.entries()) for (const q of rs) {
          if (q.x < st.safe.x0 - 2 || q.x + q.w > st.safe.x1 + 2 || q.y < 0 || q.y + q.h > st.lh) fail(`${tag}: word ${wi} outside the safe area ${JSON.stringify(q)} vs ${JSON.stringify(st.safe)}`);
        }
        console.log(`${tag}: scale ${st.scale} logical ${st.lw}x${st.lh} coverage ${(st.coverage * 100).toFixed(1)}% size ${st.size} rows ${st.rows}${st.truncated ? ' truncated' : ''} edge-leftover ${r.around.join('/')} crisp ${r.total - r.mixed}/${r.total}`);
      }
    }
  }
  // each word is bright cream on its start frame (CRT off so the scanlines do not darken it)
  const st0 = await load([1920, 1080, 1], 3, { pixelCrt: false });
  const starts = st0.starts;
  if (!starts?.length) fail('no word starts reported');
  else {
    let ok = 0;
    for (let i = 0; i < starts.length; i++) {
      const at = starts[i] / 1000;
      const st = await load([1920, 1080, 1], at, { pixelCrt: false });
      const probe = JSON.parse(await s.js(`(() => { const L = globalThis.__pixelCanvas; const g = L.getContext('2d'); const out = []; const rs = globalThis.__pixelStats.rects[${i}]; let hit = 0, n = 0;
        const want = globalThis.__pixelStats.bright.toLowerCase(); const hex = (r, gg, b) => '#' + [r, gg, b].map((v) => v.toString(16).padStart(2, '0')).join('');
        for (const q of rs) { const d = g.getImageData(q.x, q.y, q.w, q.h).data; for (let k = 0; k < d.length; k += 4) { n++; if (hex(d[k], d[k+1], d[k+2]) === want) hit++; } }
        return JSON.stringify({ hit, n }); })()`));
      if (probe.hit < 8) fail(`word ${i} is not bright cream on its start frame (${probe.hit} bright pixels of ${probe.n})`);
      else ok++;
    }
    console.log(`words bright on their start frame: ${ok}/${starts.length}`);
  }
  if (s.logs.length) { bad++; console.log('console errors:', s.logs.join(' | ')); }
  console.log(bad ? `${bad} FAILED` : 'ALL OK');
} finally {
  await s.cleanup();
}
process.exit(bad ? 1 : 0);
