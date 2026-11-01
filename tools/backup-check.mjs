// The backup lyrics source (NetEase through the local server), driven through the real app with the fake song source:
// LRCLIB answers 502 for every song, the backup has the lyrics for one song and nothing for another, and a third has
// both services down. Checks what the person sees, and that the Settings switch turns the backup off.
//   node --experimental-websocket tools/backup-check.mjs
import { startSession, waitFor, sleep } from './lib/headless.mjs';
import { FakeSpotify, installFake, seedLogin, lrcFor } from './lib/fake-spotify.mjs';

const base = { type: 'track', album: 'Scripts', artist: 'Test Band', duration_ms: 60_000, lyrics: null, service: 'error' };
const SONGS = {
  backup: { ...base, id: 'b1', name: 'Backup Has It', alt: lrcFor() },
  nothing: { ...base, id: 'b2', name: 'Nobody Has It' },
  bothdown: { ...base, id: 'b3', name: 'Both Are Down', altError: true },
};
let bad = 0;
const check = (ok, text) => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const label = (s) => s.js(`document.querySelector('#np')?.hidden ? '' : document.querySelector('.np-label')?.textContent || ''`);

async function run(name, song, settings, test) {
  console.log(name);
  const s = await startSession({ port: 5203, width: 1280, height: 720 });
  try {
    const fake = new FakeSpotify([song]);
    await installFake(s, fake);
    await s.goto(`${s.base}/?mockprep`);
    await seedLogin(s);
    if (settings) await s.js(`localStorage.setItem('ls.settings', JSON.stringify({ ...(JSON.parse(localStorage.getItem('ls.settings') || '{}')), ...${JSON.stringify(settings)} }))`);
    await s.goto(`${s.base}/`);
    await test(s, fake);
    if (s.logs.length) {
      bad++;
      console.log('  console errors:', s.logs.join(' | '));
    }
  } finally {
    await s.cleanup();
  }
}

await run('LRCLIB down, backup has the song', SONGS.backup, null, async (s, fake) => {
  await waitFor('lyrics shown', () => s.js(`!document.querySelector('#np') || document.querySelector('#np').hidden`), 20000);
  await sleep(1500);
  check((await label(s)) === '', 'no "unreachable" screen: the lyrics are shown');
  const lit = await s.js(`(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 40) if (d[i] > 90 && d[i + 1] > 70) n++; return n; })()`);
  check(lit > 50, `words are drawn on the canvas (${lit} lit samples)`);
  check(fake.requests.some((r) => r.includes('lyrics-alt/search')) && fake.requests.some((r) => r.includes('lyrics-alt/lyric')), 'asked the backup for the search and the lyric');
});

await run('LRCLIB down, the backup has nothing', SONGS.nothing, null, async (s) => {
  await waitFor('the label', () => s.js(`document.querySelector('.np-label')?.textContent.length > 0`), 20000);
  const l = await label(s);
  check(l === 'Lyrics service unreachable', `shows "${l}" (LRCLIB could not be asked, so never a false not-found)`);
});

await run('both services down', SONGS.bothdown, null, async (s) => {
  await waitFor('the label', () => s.js(`document.querySelector('.np-label')?.textContent.length > 0`), 20000);
  check((await label(s)) === 'Lyrics service unreachable', 'shows "Lyrics service unreachable"');
});

await run('backup switched off in Settings', SONGS.backup, { backupLyrics: false }, async (s, fake) => {
  await waitFor('the label', () => s.js(`document.querySelector('.np-label')?.textContent.length > 0`), 20000);
  check((await label(s)) === 'Lyrics service unreachable', 'shows "Lyrics service unreachable"');
  check(!fake.requests.some((r) => r.includes('lyrics-alt')), 'the backup was never asked');
});

console.log(bad ? `backup-check: ${bad} problem(s)` : 'backup-check: all ok');
process.exit(bad ? 1 : 0);
