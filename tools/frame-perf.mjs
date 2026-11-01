// Frame time of one scene over a stretch of real playback, in the real app (headless browser).
//   node --experimental-websocket tools/frame-perf.mjs --scene orbit [--seconds 60] [--label before] [--set '{"sky":"off"}'] [--lyrics file.json]
// Reports, over every animation frame: the time the app's own frame code took (avg, worst) and the gap between
// frames (avg, worst, how many were over 25 ms). The gap includes painting, so it is what the eye sees as stutter.
import { readFileSync } from 'node:fs';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const scene = opt('scene', 'orbit');
const seconds = Number(opt('seconds', 60));
const label = opt('label', scene);
const SONG = { title: 'Perf Song', artist: 'Check', album: 'S' };
const words = 'we run the night and all the stars come down to hold us in the light tonight'.split(' ');
const fast = (t, n) => [t, words.slice(0, n).join(' ')];
const LYRICS = opt('lyrics') ? JSON.parse(readFileSync(opt('lyrics'), 'utf8')) : Array.from({ length: 20 }, (_, i) => fast(3 + i * 3, 8 + (i % 5) * 2));

const s = await startSession({ port: 5300 + Math.floor(Math.random() * 90), width: 1280, height: 720 });
try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  await s.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__perf = { starts: [], cost: [], on: false };
      window.requestAnimationFrame = (cb) => raf((t) => {
        const t0 = performance.now();
        cb(t);
        if (window.__perf.on) { window.__perf.starts.push(t0); window.__perf.cost.push(performance.now() - t0); }
      });
    })()`,
  });
  const url = `${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: '120', start: '2', seed: '7', scene })}`;
  if (opt('set')) {
    await s.goto(url);
    await s.js(`localStorage.setItem('ls.settings', JSON.stringify(${opt('set')}))`);
  }
  await s.goto(url);
  await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === '${scene}'`), 15000);
  await sleep(1500);
  await s.js('window.__perf.on = true');
  await sleep(seconds * 1000);
  const r = await s.js(`(() => { const p = window.__perf; p.on = false; return { starts: p.starts, cost: p.cost }; })()`);
  const gaps = r.starts.slice(1).map((t, i) => t - r.starts[i]);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
  const f = (v) => v.toFixed(2);
  console.log(`${label}: ${scene}, ${seconds} s, ${r.cost.length} frames (${f((r.cost.length / seconds))} per second)`);
  console.log(`  app frame code : avg ${f(avg(r.cost))} ms, 99th ${f(pct(r.cost, 0.99))} ms, worst ${f(Math.max(...r.cost))} ms`);
  console.log(`  gap between frames: avg ${f(avg(gaps))} ms, 99th ${f(pct(gaps, 0.99))} ms, worst ${f(Math.max(...gaps))} ms, over 25 ms: ${gaps.filter((g) => g > 25).length}`);
  if (s.logs.length) console.log('console errors:', s.logs.join(' | '));
} finally {
  await s.cleanup();
}
