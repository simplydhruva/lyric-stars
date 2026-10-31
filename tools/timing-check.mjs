// Checks, scene by scene, that each word shows up on its exact start time. The demo song is paused at an
// exact position and the sky canvas is compared one millisecond before a word starts, on its start, and one
// frame (17 ms) later. Reduce motion is on so the background holds still and any pixel change is the lyrics.
//   every scene except karaoke and stack: the word must appear (the picture changes) at the start itself.
//   karaoke / stack: the word is already on screen dim; its fill must have begun one frame after the start.
// `npm run timing`
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';
import { SCENE_IDS } from '../web/js/scenes/index.js';

const SONG = { title: 'Timing Song', artist: 'Check', album: 'T' };
const LYRICS = [
  [4, 'Hold me in the light tonight'],
  [9, 'Stars are falling slow and bright'],
  [14, 'Sing it back to me again'],
  [19, 'Never let it go away'],
];
const SCENES = SCENE_IDS;
const APPEARS = new Set(SCENE_IDS.filter((id) => id !== 'karaoke' && id !== 'stack'));

const sum = (s) =>
  s.js(`(() => {
    const c = document.getElementById('sky');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    return h;
  })()`);

const s = await startSession({ port: 5198, reduceMotion: true });
let bad = 0;
try {
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  // The page draws a little ahead of the song (about 1.5 screen refreshes) so a word reaches the screen as it is
  // heard. So "drawn at X ms" means the page is started X minus that lead earlier. The lead is measured once.
  let lead = 25;
  const open = async (scene, drawnMs) => {
    const q = new URLSearchParams({ demo: '', ...SONG, duration: '60', start: String((drawnMs - lead) / 1000), paused: '', seed: '7', scene });
    await s.goto(`${s.base}/?${q}`);
    await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === '${scene}'`), 8000);
    await sleep(900); // the lead settles to the screen's refresh rate after about half a second
    const now = await s.js(`import('/js/main.js').then((m) => m.app.displayLatencyMs())`);
    if (Math.abs(now - lead) > 0.4) {
      lead = now; // measured more exactly: redo this frame with it
      return open(scene, drawnMs);
    }
    return sum(s);
  };
  // The real word start times, from the app's own timing code.
  await s.goto(`${s.base}/?demo=&title=x`);
  await sleep(500);
  const words = await s.js(`import('/js/timing.js').then((m) => {
    const t = m.buildTimeline(${JSON.stringify(LYRICS.map(([sec, text]) => ({ time: sec * 1000, text })))}, { trackDurationMs: 60000 });
    return t.map((l, li) => l.words.map((w, wi) => ({ li, wi, text: w.text, start: Math.round(w.start) }))).flat();
  })`);
  // First word, a middle word and the last word of lines 2 to 4.
  const picks = [];
  for (const li of [1, 2, 3]) {
    const ws = words.filter((w) => w.li === li);
    picks.push(ws[0], ws[Math.floor(ws.length / 2)], ws[ws.length - 1]);
  }
  console.log(`${picks.length} words per scene, e.g. "${picks[1].text}" starts at ${picks[1].start} ms`);
  for (const scene of SCENES) {
    let ok = 0;
    for (const w of picks) {
      const before = await open(scene, w.start - 1);
      const at = await open(scene, w.start);
      const later = await open(scene, w.start + 17);
      const pass = APPEARS.has(scene) ? before !== at : before !== later;
      if (pass) ok++;
      else {
        bad++;
        console.log(`  FAIL ${scene}: "${w.text}" at ${w.start} ms  before=${before} at=${at} +17ms=${later}`);
      }
    }
    console.log(`${scene}: ${ok}/${picks.length} words changed the picture ${APPEARS.has(scene) ? 'on their exact start' : 'within one frame of their start'}`);
  }
  if (s.logs.length) {
    bad++;
    console.log('console errors:', s.logs.join(' | '));
  }
} finally {
  await s.cleanup();
}
console.log(bad ? `timing: ${bad} problems` : 'timing: every word on time in every scene');
process.exit(bad ? 1 : 0);
