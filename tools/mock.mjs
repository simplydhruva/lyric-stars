// Runs the whole app against a scripted fake Spotify (tools/lib/fake-spotify.mjs): a synced song, a song with
// no lyrics, an ad and a podcast, with pause, seek and skip, in every scene. `npm run mock`.
import { startSession, waitFor, sleep } from './lib/headless.mjs';
import { FakeSpotify, installFake, seedLogin } from './lib/fake-spotify.mjs';
import { SCENE_IDS } from '../web/js/scenes/index.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

const SCENES = SCENE_IDS;

// What the page shows right now: which panel, the toast, and whether the sky has lit pixels.
const peek = (s) =>
  s.js(`(() => {
    const c = document.getElementById('sky');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 7) if (d[i] > 90) lit++;
    const vis = (id) => { const e = document.getElementById(id); return e && !e.hidden && getComputedStyle(e).display !== 'none'; };
    const text = ['card', 'np'].filter(vis).map((id) => document.getElementById(id).innerText).join(' ').slice(0, 160).replace(/\\s+/g, ' ');
    return { scene: document.documentElement.dataset.scene, lit, card: vis('card') || vis('np'), text };
  })()`);

async function main() {
  const s = await startSession({ port: 5197, width: 1280, height: 720 });
  const fake = new FakeSpotify();
  try {
    await installFake(s, fake);
    await s.goto(`${s.base}/?mockprep`);
    await sleep(500);
    await seedLogin(s);

    for (const scene of SCENES) {
      console.log(`\n[${scene}]`);
      fake.jump(0, 6000);
      await s.goto(`${s.base}/?scene=${scene}`);
      await waitFor('lyrics on screen', async () => (await peek(s)).lit > 20 && !(await peek(s)).card, 12000);
      check('synced song draws lyrics', true);

      fake.pause();
      await sleep(2600);
      const p1 = await peek(s);
      await sleep(600);
      const p2 = await peek(s);
      check('pause: picture holds still', Math.abs(p1.lit - p2.lit) <= p1.lit * 0.03, `${p1.lit}/${p2.lit}`);
      fake.play();

      fake.seek(40_000);
      await sleep(2600);
      check('seek forward: still drawing', (await peek(s)).lit > 20);
      fake.seek(2_000);
      await sleep(2600);
      check('seek back: still drawing', (await peek(s)).lit > 5);

      fake.jump(1, 3000);
      await waitFor('no-lyrics screen', async () => (await peek(s)).card, 8000);
      const noLy = await peek(s);
      check('no-lyrics song shows the now-playing card', noLy.card && /Silent Track/.test(noLy.text), noLy.text);

      fake.jump(2, 1000);
      await waitFor('ad screen', async () => /ad|advert/i.test((await peek(s)).text), 8000);
      check('ad shows an ad message', true, (await peek(s)).text);

      fake.jump(3, 1000);
      await waitFor('podcast screen', async () => /podcast|episode/i.test((await peek(s)).text), 8000);
      check('podcast shows a podcast message', true, (await peek(s)).text);

      fake.jump(4, 6000);
      await waitFor('lyrics again', async () => (await peek(s)).lit > 20 && !(await peek(s)).card, 12000);
      check('back to a synced song after the podcast', true);

      // Fast skipping: ten songs in a second must end on the right one without errors.
      for (let i = 0; i < 10; i++) {
        fake.next();
        await s.js('void 0');
        await sleep(80);
      }
      fake.jump(0, 6000);
      await waitFor('lyrics after fast skipping', async () => (await peek(s)).lit > 20 && !(await peek(s)).card, 12000);
      check('fast skipping settles on the right song', true);
    }
    check('no console errors', s.logs.length === 0, s.logs.join(' | '));
  } finally {
    console.log(`\nfake Spotify saw ${fake.requests.length} requests`);
    await s.cleanup();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\nmock: ${failed} failed` : '\nmock: all passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
