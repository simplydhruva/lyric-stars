// Pixel check of the lyric canvas. `node tools/visual.mjs --out DIR` saves PNGs of a fixed
// set of frames; `--compare DIR` renders them again and reports any difference.
// Used to prove a refactor leaves a scene looking exactly the same. The images depend on the
// browser, so compare only on the same machine, and do not commit them.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n) && args[args.indexOf(n) + 1];
const outDir = flag('--out');
const compareDir = flag('--compare');
const sceneArg = flag('--scene'); // optional: pass ?scene=… once scenes exist
if (!outDir && !compareDir) {
  console.log('usage: node tools/visual.mjs --out DIR | --compare DIR [--scene name]');
  process.exit(2);
}

const SONG = { title: 'Baseline Song', artist: 'Visual Check', album: 'Frames' };
const LYRICS = [
  [5, 'Look at the stars tonight'],
  [9, 'They shine for you alone'],
  [13, 'And everything you do'],
  [17, 'Yeah they were all yellow'],
  [21, 'A very long line that keeps going and going and going so that it has to be placed across the whole of the sky somehow'],
  [26, 'Short'],
];
// Positions 3 s after a line starts: every word has settled, so frames do not depend on timing jitter.
// Reduce motion is on for every frame: the drifting background is then still, so the pixels repeat exactly.
const FRAMES = [
  { name: 'line1-settled', at: 8, reduce: true },
  { name: 'line2-settled', at: 12, reduce: true },
  { name: 'long-line-settled', at: 25, reduce: true },
  { name: 'before-first-line', at: 1, reduce: true },
  { name: 'last-line', at: 28, reduce: true },
];
const SIZES = [[1280, 720], [700, 900]];

async function capture(frame, [w, h]) {
  const s = await startSession({ width: w, height: h, reduceMotion: frame.reduce });
  try {
    await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
    const q = new URLSearchParams({ demo: '', ...SONG, duration: '60', start: String(frame.at), paused: '', seed: '12345' });
    if (sceneArg) q.set('scene', sceneArg);
    await s.goto(`${s.base}/?${q}`);
    await waitFor('the lyrics', () => s.js(`document.getElementById('card').hidden`), 8000);
    await sleep(1200); // a few frames, so the canvas is painted
    const url = await s.js(`document.getElementById('sky').toDataURL('image/png')`);
    return { png: Buffer.from(url.split(',')[1], 'base64'), errors: [...s.logs] };
  } finally {
    await s.cleanup();
  }
}

let differ = 0;
if (outDir) mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  for (const frame of FRAMES) {
    const name = `${frame.name}-${size[0]}x${size[1]}.png`;
    const { png, errors } = await capture(frame, size);
    if (errors.length) console.log(`  console errors in ${name}:\n    ${errors.join('\n    ')}`);
    if (outDir) {
      writeFileSync(path.join(outDir, name), png);
      console.log(`  saved ${name} (${png.length} bytes)`);
    } else {
      const file = path.join(compareDir, name);
      const same = existsSync(file) && readFileSync(file).equals(png);
      if (!same) {
        differ++;
        writeFileSync(path.join(compareDir, name.replace('.png', '.now.png')), png);
      }
      console.log(`  ${same ? 'same   ' : 'DIFFERS'} ${name}`);
    }
  }
}
if (compareDir) console.log(differ ? `visual: ${differ} differ` : 'visual: all frames identical');
process.exit(differ ? 1 : 0);
