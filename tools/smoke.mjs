// Browser smoke test: starts the real server on a scratch data folder, opens the demo in headless
// Chrome (or Edge) and drives the now-playing scene, the player bar and the scene switcher.
// Run with `npm run smoke`. It needs a Chromium browser; set CHROME_PATH to pick one.
// Without one it skips locally, and fails when CI is set.
import { startSession, syncedEntry, waitFor, sleep, findBrowser } from './lib/headless.mjs';
import { SCENES } from '../web/js/scenes/index.js';

const PORT = Number(process.env.SMOKE_PORT) || 5196;

if (!findBrowser()) {
  console.log('smoke: no Chrome or Edge found (set CHROME_PATH); skipped');
  process.exit(process.env.CI ? 1 : 0);
}

let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

function assertEq(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const SONG = { title: 'Zzqx Vwkp Nonexistent', artist: 'Qqjx Wvz', album: 'Nothing Album' };

async function nowPlaying() {
  const s = await startSession({ port: PORT });
  try {
    const { js, key, move, click } = s;
    const box = (sel) => js(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, width: r.width }; })()`);
    const text = (sel) => js(`document.querySelector('${sel}').textContent`);
    const seconds = async () => {
      const [m, sec] = (await text('.pb-elapsed')).split(':').map(Number);
      return m * 60 + sec;
    };

    // A saved "not found" so the test never depends on the lyrics service being reachable.
    await s.putCache(`lyrics:demo:${SONG.title}`, { savedAt: Date.now(), track: { title: SONG.title, artists: [SONG.artist] }, result: { status: 'notfound' } });
    await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', ...SONG, duration: '268' })}`);

    console.log('Now-playing scene and player bar');
    await step('scene shows the song and "Lyrics not found"', async () => {
      await waitFor('the scene', () => js(`!document.getElementById('np').hidden && document.querySelector('.np-label').textContent === 'Lyrics not found'`), 20000); // a cold CI runner can be slow
      assertEq(await text('.np-title'), SONG.title);
      assertEq(await text('.np-artist'), SONG.artist);
      assertEq(await text('.np-album'), SONG.album);
    });
    await step('a cover that fails to load leaves the gold star', async () => {
      assertEq(await js(`getComputedStyle(document.querySelector('.np-fallback')).display !== 'none'`), true);
    });
    await step('the bar is visible', async () => {
      assertEq(await js(`!document.getElementById('player').hidden`), true);
    });
    await step('Space pauses and dims the scene, then plays again', async () => {
      await key(' ', 'Space');
      await waitFor('paused', () => js(`document.getElementById('np').classList.contains('paused') && document.querySelector('.pb-main').getAttribute('aria-label') === 'Play'`));
      await key(' ', 'Space');
      await waitFor('playing', () => js(`!document.getElementById('np').classList.contains('paused') && document.querySelector('.pb-main').getAttribute('aria-label') === 'Pause'`));
    });
    await step('clicking the progress bar seeks', async () => {
      const t = await box('.pb-track');
      await click(t.left + t.width * 0.5, t.y);
      await waitFor('the seek', async () => Math.abs((await seconds()) - 134) <= 3);
    });
    await step('Retry searches again, then the label returns', async () => {
      const r = await box('.np-retry');
      await click(r.x, r.y);
      await waitFor('searching', () => js(`document.querySelector('.np-label').textContent === 'Searching…'`));
      await waitFor('the result', () => js(`document.querySelector('.np-label').textContent === 'Lyrics not found'`));
    });
    await step('the bar fades after 3 s without movement and returns on movement', async () => {
      await move(20, 20);
      await waitFor('the fade', () => js(`document.body.classList.contains('controls-hidden')`), 7000);
      await move(300, 300);
      await waitFor('the bar to return', () => js(`!document.body.classList.contains('controls-hidden')`));
    });
    await step('no console errors', async () => assertEq(s.logs.join('\n'), ''));
  } finally {
    await s.cleanup();
  }
}

const LYRICS = [
  [3, 'Look at the stars tonight'],
  [8, 'They shine for you alone'],
  [13, 'And everything you do'],
];

async function scenes() {
  const s = await startSession({ port: PORT });
  try {
    const { js, key, click } = s;
    const scene = () => js(`document.documentElement.dataset.scene`);
    const saved = (k) => js(`JSON.parse(localStorage.getItem('ls.settings') || '{}')['${k}']`);
    const toastText = () => js(`document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent`);
    // Counts pixels that are not near black, so a scene that draws nothing fails.
    const lit = () => js(`(() => { const c = document.getElementById('sky'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) n++; return n; })()`);
    const open = async () => {
      await s.goto(`${s.base}/?${new URLSearchParams({ demo: '', title: 'Scene Song', artist: 'Smoke', album: 'Test', duration: '60', start: '9.5' })}`);
      // The message card hides once lyrics are showing.
      await waitFor('the lyrics', () => js(`document.getElementById('card').hidden && Boolean(document.documentElement.dataset.scene)`), 10000);
    };
    await s.putCache('lyrics:demo:Scene Song', syncedEntry('Scene Song', 'Smoke', LYRICS));

    console.log('Scenes');
    await open();
    await step('the window starts on the constellation', async () => assertEq(await scene(), 'constellation'));
    await step('the constellation draws', async () => {
      await waitFor('stars', async () => (await lit()) > 50);
    });
    await step('V switches to karaoke, shows its name, and it draws', async () => {
      await key('v', 'KeyV');
      await waitFor('karaoke', async () => (await scene()) === 'karaoke');
      assertEq(await toastText(), 'Scene: Karaoke');
      await waitFor('text', async () => (await lit()) > 50);
    });
    await step('the choice is remembered for this display mode, and survives a reload', async () => {
      assertEq(await saved('sceneWindow'), 'karaoke');
      assertEq(await saved('sceneOverlay'), undefined); // other modes untouched
      await open();
      assertEq(await scene(), 'karaoke');
    });
    await step('V goes on through every scene, each draws, then wraps to the constellation', async () => {
      const order = SCENES.map((x) => [x.id, x.name]);
      for (const [id, name] of [...order.slice(order.findIndex(([i]) => i === 'karaoke') + 1), order[0]]) {
        await key('v', 'KeyV');
        await waitFor(id, async () => (await scene()) === id);
        assertEq(await toastText(), `Scene: ${name}`);
        await waitFor(`${id} draws`, async () => (await lit()) > 50);
      }
    });
    await step('M switches the stack between word-by-word fill and the whole line lit', async () => {
      await js(`document.documentElement.dataset.scene`);
      await key('v', 'KeyV'); // karaoke
      await waitFor('karaoke', async () => (await scene()) === 'karaoke');
      await key('v', 'KeyV'); // stack
      await waitFor('stack', async () => (await scene()) === 'stack');
      const before = await js(`document.getElementById('sky').toDataURL()`);
      await key('m', 'KeyM');
      await waitFor('the redraw', async () => (await js(`document.getElementById('sky').toDataURL()`)) !== before);
      await key('m', 'KeyM'); // back to word by word, and on round to the constellation
      // Wait for each scene change before the next key, or a slow machine overshoots the constellation.
      for (let n = 0; n < SCENES.length; n++) {
        const now = await scene();
        if (now === 'constellation') break;
        await key('v', 'KeyV');
        await waitFor('the next scene', async () => (await scene()) !== now);
      }
      await waitFor('constellation', async () => (await scene()) === 'constellation');
    });
    await step('the settings panel shows and changes the choice', async () => {
      await key('s', 'KeyS');
      await waitFor('the panel', () => js(`!document.getElementById('settings').hidden && Boolean(document.querySelector('input[name=sceneWindow]'))`));
      assertEq(await js(`document.querySelector('input[name=sceneWindow][value=constellation]').checked`), true);
      assertEq(await js(`document.querySelector('input[name=sceneOverlay][value=karaoke]').checked`), true); // overlay default
      const b = await js(`(() => { const r = document.querySelector('input[name=sceneWindow][value=karaoke] + span').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await click(b.x, b.y);
      await waitFor('karaoke', async () => (await scene()) === 'karaoke');
      assertEq(await saved('sceneWindow'), 'karaoke');
      await key('s', 'KeyS');
    });
    await step('random mode: V changes only this song, not the saved favorite', async () => {
      await key('s', 'KeyS');
      await waitFor('the panel', () => js(`!document.getElementById('settings').hidden`));
      const c = await js(`(() => { const el = document.querySelector('input[name=sceneRandom]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await click(c.x, c.y);
      await waitFor('the setting', async () => (await saved('sceneRandom')) === true);
      await key('s', 'KeyS');
      const before = await saved('sceneWindow');
      await key('v', 'KeyV');
      await waitFor('the toast', async () => (await toastText()).endsWith('(this song)'));
      assertEq(await saved('sceneWindow'), before);
    });
    await step('a resize redraws without errors', async () => {
      await s.resize(480, 700);
      await waitFor('the new size', () => js(`document.getElementById('sky').width === 480`));
      await waitFor('text', async () => (await lit()) > 50);
      await s.resize(1280, 720);
    });
    await step('no console errors', async () => assertEq(s.logs.join('\n'), ''));
  } finally {
    await s.cleanup();
  }
}

try {
  await nowPlaying();
  await scenes();
} catch (e) {
  failed++;
  console.log(`  FAIL setup: ${e.message}`);
}
console.log(failed ? `smoke: ${failed} failed` : 'smoke: all passed');
process.exit(failed ? 1 : 0);
