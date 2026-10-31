// Stress and soak test. First a burst of abuse (V and M hammered, resizing while playing, reduce-motion toggled),
// then the demo song loops for N minutes (default 10) while V and M are pressed now and then, sampling the
// page's JS heap, main-thread busy time and frames per second every 30 s.
//   node --experimental-websocket tools/soak.mjs [--minutes 10]
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';
import { SCENE_IDS } from '../web/js/scenes/index.js';

const i = process.argv.indexOf('--minutes');
const minutes = i > 0 ? Number(process.argv[i + 1]) : 10;
const SONG = { title: 'Soak Song', artist: 'Check', album: 'S' };
const WORDS = ['Hold me in the light tonight', 'Stars are falling slow and bright', 'Sing it back to me again', 'We walked through the endless city lights remembering every single promise we made'];
const LYRICS = Array.from({ length: 14 }, (_, n) => [n * 4 + 1, WORDS[n % WORDS.length]]);

const s = await startSession({ port: 5201, width: 1280, height: 720 });
let bad = 0;
const fail = (m) => {
  bad++;
  console.log(`  FAIL ${m}`);
};
const lit = () =>
  s.js(`(() => { const c = document.getElementById('sky'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 28) if (d[i] > 90) n++; return n; })()`);
const metrics = async () => Object.fromEntries((await s.send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]));

try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  const q = new URLSearchParams({ demo: '', ...SONG, duration: '60', start: '5', scene: 'constellation' });
  await s.goto(`${s.base}/?${q}`);
  await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden`), 10000);
  await s.send('Performance.enable');
  await s.js(`window.__f = 0; (function t() { window.__f++; requestAnimationFrame(t); })()`);

  console.log('burst: V and M hammered (200 key presses, no pause between)');
  for (let n = 0; n < 100; n++) {
    await s.key('v');
    await s.key('m');
  }
  await sleep(1200);
  const scene = await s.js(`document.documentElement.dataset.scene`);
  if (!SCENE_IDS.includes(scene)) fail(`odd scene "${scene}"`);
  if ((await lit()) < 5) fail('nothing drawn after the key burst');
  console.log(`  scene after the burst: ${scene}, lit samples ${await lit()}`);

  console.log('burst: resize while playing, in every scene');
  for (const sc of SCENE_IDS) {
    for (let n = 0; n < SCENE_IDS.length && (await s.js(`document.documentElement.dataset.scene`)) !== sc; n++) await s.key('v');
    for (const [w, h] of [[1920, 1080], [700, 900], [320, 480], [2560, 1440], [900, 300], [1280, 720]]) {
      await s.resize(w, h);
      await sleep(250);
    }
    if ((await lit()) < 5) fail(`${sc}: nothing drawn after resizing`);
  }

  console.log('burst: reduce-motion on and off while playing');
  for (const v of ['reduce', 'no-preference', 'reduce']) {
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] });
    await sleep(600);
    if ((await lit()) < 5) fail(`nothing drawn with reduce-motion ${v}`);
  }
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  if (s.logs.length) fail(`console errors: ${s.logs.join(' | ')}`);

  console.log(`\nsoak: ${minutes} min, song looping, V and M every 20 s`);
  await s.resize(1280, 720);
  const rows = [];
  let m0 = await metrics();
  let f0 = await s.js('window.__f');
  let t0 = Date.now();
  const first = { heap: m0.JSHeapUsedSize, t: t0 };
  const end = t0 + minutes * 60_000;
  let tick = 0;
  while (Date.now() < end) {
    for (let k = 0; k < 3 && Date.now() < end; k++) {
      await sleep(10_000);
      tick++;
      await s.key(tick % 4 === 0 ? 'm' : 'v');
    }
    if (Date.now() >= end - 1000 && rows.length) break;
    const m1 = await metrics();
    const f1 = await s.js('window.__f');
    const t1 = Date.now();
    const wall = (t1 - t0) / 1000;
    rows.push({
      min: ((t1 - first.t) / 60000).toFixed(1),
      heapMB: (m1.JSHeapUsedSize / 1048576).toFixed(1),
      busy: (((m1.TaskDuration - m0.TaskDuration) / wall) * 100).toFixed(1),
      fps: ((f1 - f0) / wall).toFixed(1),
      scene: await s.js(`document.documentElement.dataset.scene`),
    });
    const r = rows[rows.length - 1];
    console.log(`  ${r.min.padStart(4)} min  heap ${r.heapMB} MB  main-thread busy ${r.busy}%  ${r.fps} fps  scene ${r.scene}`);
    m0 = m1;
    f0 = f1;
    t0 = t1;
  }
  const heaps = rows.map((r) => Number(r.heapMB));
  const fps = rows.map((r) => Number(r.fps));
  const busy = rows.map((r) => Number(r.busy));
  console.log(`\nheap: start ${(first.heap / 1048576).toFixed(1)} MB, min ${Math.min(...heaps)} max ${Math.max(...heaps)} last ${heaps.at(-1)} MB`);
  console.log(`fps: min ${Math.min(...fps)} avg ${(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1)}; main-thread busy: avg ${(busy.reduce((a, b) => a + b, 0) / busy.length).toFixed(1)}% max ${Math.max(...busy)}%`);
  if ((await lit()) < 5) fail('nothing drawn at the end');
  if (s.logs.length) fail(`console errors: ${s.logs.join(' | ')}`);
} finally {
  await s.cleanup();
}
console.log(bad ? `soak: ${bad} problems` : 'soak: finished cleanly');
process.exit(bad ? 1 : 0);
