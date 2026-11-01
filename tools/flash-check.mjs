// Checks the sync flash: [ and ] nudge the song's offset and a ring of light shows for about half a second,
// then is gone again; \ resets. Also with reduce-motion on, in every scene, and with no errors.
//   node --experimental-websocket tools/flash-check.mjs
import { startSession, syncedEntry, waitFor, sleep } from './lib/headless.mjs';
import { SCENE_IDS } from '../web/js/scenes/index.js';

const SONG = { title: 'Flash Song', artist: 'Check', album: 'S' };
const LYRICS = [[4, 'Hold me in the light tonight'], [9, 'Stars are falling slow and bright'], [14, 'Sing it back to me again']];
const s = await startSession({ port: 5214, width: 1280, height: 720 });
let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
// A fingerprint of the canvas: sum of all channel values, sampled.
const print = () => s.js(`(() => { const c = document.getElementById('sky'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] * 3 + d[i + 2] * 7; return n; })()`);
const offset = () => s.js(`(JSON.parse(localStorage.getItem('ls.offsets') || '{}'))['demo:${SONG.title}'] || 0`);

try {
  // The drifting background would change the picture by itself; the flash is what is being measured.
  await s.goto(`${s.base}/?prep`);
  await s.js(`localStorage.setItem('ls.settings', JSON.stringify({ sky: 'off' }))`);
  await s.putCache(`lyrics:demo:${SONG.title}`, syncedEntry(SONG.title, SONG.artist, LYRICS));
  for (const scene of SCENE_IDS) {
    for (const reduce of [false, true]) {
      console.log(`\n[${scene}${reduce ? ', reduce motion' : ''}]`);
      await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
      const q = new URLSearchParams({ demo: '', ...SONG, duration: '60', start: '10', paused: '', seed: '7', scene });
      await s.goto(`${s.base}/?${q}`);
      await waitFor('lyrics', () => s.js(`document.getElementById('card').hidden && document.documentElement.dataset.scene === '${scene}'`), 10000);
      await sleep(1500);
      const base = await offset();
      await s.key(']', 'BracketRight');
      await sleep(200);
      const during = await print();
      check('] moves the song offset 50 ms later', (await offset()) === base - 50, `${base} -> ${await offset()}`);
      await sleep(1600);
      const after1 = await print();
      await sleep(400);
      const after2 = await print();
      check('the flash is showing 200 ms after the key', during !== after1);
      check('the flash is gone after a second (picture is steady)', after1 === after2);
      await s.key('[', 'BracketLeft');
      await sleep(200);
      const during2 = await print();
      await sleep(1600);
      check('[ brings it back and flashes too', (await offset()) === base && during2 !== (await print()));
      await s.key(']', 'BracketRight');
      await sleep(300);
      await s.key('\\', 'Backslash');
      await sleep(200);
      const during3 = await print();
      check('\ resets the offset', (await offset()) === 0);
      await sleep(1600);
      check('reset flashes too', during3 !== (await print()));
    }
  }
  if (s.logs.length) check('no console errors', false, s.logs.join(' | '));
  else check('no console errors', true);
} finally {
  await s.cleanup();
}
console.log(bad ? `\nflash: ${bad} problems` : '\nflash: nudge, flash and reset work in every scene');
process.exit(bad ? 1 : 0);
