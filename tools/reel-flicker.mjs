// A real frame capture of the Reel scene for the "no more than 3 flashes a second" rule (WCAG 2.3.1): the song plays in
// real time, and every animation frame the page reads back the visible canvas, shrunk to 48x27, and works out its relative
// luminance. A "flash" is a pair of opposite changes of at least 10% (of full white, with the darker side below 0.8).
// The worst one-second window is reported. Lines come every 1.2 s with hard cuts, so this is a worst case.
//   node --experimental-websocket tools/reel-flicker.mjs [--seconds 40] [--reduce] [--cover busy]
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const seconds = Number(arg('--seconds', 40));
const reduce = process.argv.includes('--reduce');
const cover = arg('--cover', 'bright');
const SONG = { title: 'Flicker Song', artist: 'Check', album: 'S' };
const WORDS = ['burning', 'fire', 'love', 'tonight', 'dancing', 'moon', 'stars', 'rain', 'ocean', 'kiss', 'dream', 'closer'];
const LYRICS = [];
for (let i = 0; i < Math.ceil(seconds / 1.2) + 2; i++) LYRICS.push([1 + i * 1.2, `${WORDS[i % 12]} ${WORDS[(i * 5 + 3) % 12]} and the ${WORDS[(i * 7 + 1) % 12]} tonight`]);

const s = await startSession({ port: 5430, width: 1280, height: 720, reduceMotion: reduce });
const SAMPLER = `(() => {
  const cv = document.querySelector('canvas');
  const sm = document.createElement('canvas'); sm.width = 48; sm.height = 27;
  const g = sm.getContext('2d', { willReadFrequently: true });
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const series = [];
  const t0 = performance.now();
  let stop = false;
  const tick = () => {
    g.drawImage(cv, 0, 0, 48, 27);
    const d = g.getImageData(0, 0, 48, 27).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    series.push([performance.now() - t0, sum / (d.length / 4)]);
    if (!stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  globalThis.__flicker = { series, stop: () => { stop = true; } };
})()`;

try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: String(seconds + 5), start: '0', seed: '7', scene: 'reel', demoCover: cover })}`);
  await waitFor('reel', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === 'reel'`), 15000);
  await s.js(SAMPLER);
  await sleep(seconds * 1000);
  const series = JSON.parse(await s.js(`globalThis.__flicker.stop(), JSON.stringify(globalThis.__flicker.series)`));
  // flashes: opposite luminance swings of >= 0.1, the darker side < 0.8 (use the swing between local extremes)
  const events = [];
  let last = series[0], mode = 0; // mode: 1 rising, -1 falling
  let startPt = series[0];
  for (let i = 1; i < series.length; i++) {
    const p = series[i];
    if (mode >= 0 && p[1] >= last[1]) { mode = 1; last = p; continue; }
    if (mode <= 0 && p[1] <= last[1]) { mode = -1; last = p; continue; }
    // direction reversed: [startPt -> last] was a swing
    if (Math.abs(last[1] - startPt[1]) >= 0.1 && Math.min(last[1], startPt[1]) < 0.8) events.push({ t: last[0], dir: mode, size: Math.abs(last[1] - startPt[1]) });
    startPt = last; last = p; mode = mode === 1 ? -1 : 1;
  }
  let worst = 0, worstAt = 0;
  for (let i = 0; i < events.length; i++) {
    // a flash is two opposite changes; count the swings in the window, flashes = swings / 2 (rounded up)
    const inWin = events.filter((e) => e.t >= events[i].t && e.t < events[i].t + 1000);
    const f = Math.ceil(inWin.length / 2);
    if (f > worst) { worst = f; worstAt = events[i].t; }
  }
  const lums = series.map((p) => p[1]);
  const fps = (series.length / (series[series.length - 1][0] / 1000)).toFixed(1);
  console.log(`${reduce ? 'reduce motion' : 'normal'}, cover ${cover}: ${series.length} frames over ${(series[series.length - 1][0] / 1000).toFixed(1)} s (${fps} fps captured)`);
  console.log(`luminance range ${Math.min(...lums).toFixed(3)}..${Math.max(...lums).toFixed(3)}; big swings (>=10%): ${events.length}; most flashes in any 1 s window: ${worst}${worst ? ` (at ${(worstAt / 1000).toFixed(1)} s)` : ''}`);
  console.log(worst > 3 ? 'FAIL: more than 3 flashes in a second' : 'ok: no more than 3 flashes in any second');
  if (s.logs.length) console.log('console errors:', s.logs.join(' | '));
  process.exitCode = worst > 3 ? 1 : 0;
} finally {
  await s.cleanup();
}
