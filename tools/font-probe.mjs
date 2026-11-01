// Measures each Reel font in the browser: cap height and "stem weight" (how much of a letter's box is ink), so the
// size correction table in web/js/scenes/reel-fonts.js rests on measured numbers.  node --experimental-websocket tools/font-probe.mjs
import { startSession, sleep } from './lib/headless.mjs';
const s = await startSession({ port: 5300 + Math.floor(Math.random() * 50), width: 800, height: 600 });
try {
  await s.goto(`${s.base}/?demo`);
  await sleep(500);
  const r = await s.js(`(async () => {
    const names = ['Anton','Bebas Neue','Archivo Black','Rubik Mono One','Permanent Marker','Bangers','Special Elite','Bungee','Alfa Slab One','Bowlby One'];
    const out = {};
    for (const n of names) {
      await document.fonts.load('200px "' + n + '"');
      const c = document.createElement('canvas'); c.width = 600; c.height = 600;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.font = '200px "' + n + '"'; g.textBaseline = 'alphabetic'; g.fillStyle = '#000';
      const m = g.measureText('H');
      const cap = m.actualBoundingBoxAscent / 200;
      const x = g.measureText('x').actualBoundingBoxAscent / 200;
      g.clearRect(0, 0, 600, 600); g.fillText('H', 50, 400);
      const d = g.getImageData(0, 0, 600, 600).data; let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 128) ink++;
      const box = m.actualBoundingBoxAscent * (m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
      out[n] = { loaded: document.fonts.check('20px "' + n + '"'), cap: +cap.toFixed(3), x: +x.toFixed(3), ink: +(ink / box).toFixed(3), wH: +(m.width / 200).toFixed(3) };
    }
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 1));
} finally { await s.cleanup(); }
