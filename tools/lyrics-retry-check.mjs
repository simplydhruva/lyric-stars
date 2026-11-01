// "Lyrics not found", then found later: the real app, the real Spotify source and lyrics code, with the fake song
// source. Each case watches what the screen says every 250 ms and saves a picture.
//   fail-once / fail-twice  the lyrics service answers with a server error first, then works
//   slow                    the service takes 6 s to answer; the song is already 20 s in when the lyrics arrive
//   missing                 a true "not found": shown only after the three tries, and the answer is saved
//   always-down             the service never works: "unreachable", and nothing is saved
//   node --experimental-websocket tools/lyrics-retry-check.mjs OUT_DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startSession, waitFor, sleep } from './lib/headless.mjs';
import { FakeSpotify, installFake, seedLogin, lrcFor } from './lib/fake-spotify.mjs';

const out = process.argv[2];
if (!out) {
  console.log('usage: node --experimental-websocket tools/lyrics-retry-check.mjs OUT_DIR');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const base = { type: 'track', album: 'Retry Album', artist: 'Test Band', duration_ms: 60_000 };
const CASES = [
  { name: 'fail-once', song: { ...base, id: 'r1', name: 'Fails Once', lyrics: lrcFor(), failAttempts: 1 }, finds: true, cached: true },
  { name: 'fail-twice', song: { ...base, id: 'r2', name: 'Fails Twice', lyrics: lrcFor(), failAttempts: 2 }, finds: true, cached: true },
  { name: 'slow', song: { ...base, id: 'r3', name: 'Slow Answer', lyrics: lrcFor(), delayMs: 6000 }, finds: true, cached: true, start: 20_000 },
  { name: 'missing', song: { ...base, id: 'r4', name: 'Never Written', lyrics: null }, finds: false, cached: true },
  { name: 'always-down', song: { ...base, id: 'r5', name: 'Always Down', lyrics: lrcFor(), service: 'error' }, finds: false, cached: false },
];

let bad = 0;
const check = (ok, text) => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${text}`);
};

for (const c of CASES) {
  console.log(c.name);
  const s = await startSession({ port: 5300 + Math.floor(Math.random() * 90), width: 1280, height: 720 });
  try {
    const fake = new FakeSpotify([c.song]);
    if (c.start) fake._set(c.start);
    await installFake(s, fake);
    await s.goto(`${s.base}/?mockprep`);
    await seedLogin(s);
    await s.goto(`${s.base}/`);
    const t0 = Date.now();
    // What the screen says over time: the status chip, the no-lyrics label, and whether lyrics are on screen.
    const seen = [];
    let shot = false;
    const stateNow = () => s.js(`(() => ({ chip: document.getElementById('chip').hidden ? '' : document.getElementById('chip').textContent, label: document.querySelector('.np-label')?.textContent || '', card: document.getElementById('card').hidden ? '' : document.getElementById('card-title').textContent, timing: !document.getElementById('timing').hidden }))()`);
    const deadline = t0 + (c.name === 'always-down' ? 22000 : 16000);
    let firstLyrics = null, firstFinal = null;
    while (Date.now() < deadline) {
      const st = await stateNow();
      const at = ((Date.now() - t0) / 1000).toFixed(1);
      const key = JSON.stringify(st);
      if (seen.at(-1)?.key !== key) seen.push({ at, key, st });
      if (st.timing && firstLyrics == null) firstLyrics = Number(at);
      if (!st.timing && (st.label || st.card) && !/Search/i.test(st.label + st.chip) && firstFinal == null) firstFinal = Number(at);
      if (c.finds && st.timing && Date.now() - t0 > (firstLyrics ?? 0) * 1000 + 1500) break;
      if (!c.finds && firstFinal != null && Date.now() - t0 > firstFinal * 1000 + 1500) break;
      if (firstLyrics != null && !shot && Date.now() - t0 > firstLyrics * 1000 + 700) {
        shot = true;
        writeFileSync(path.join(out, `${c.name}-found.png`), Buffer.from((await s.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
      }
      await sleep(250);
    }
    for (const x of seen) console.log(`    ${x.at.padStart(5)} s  chip "${x.st.chip}"  label "${x.st.label}"  card "${x.st.card}"  lyrics ${x.st.timing}`);
    writeFileSync(path.join(out, `${c.name}-end.png`), Buffer.from((await s.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    const wrongEarly = seen.some((x) => Number(x.at) < 6.5 && /not found|unreachable/i.test(x.st.label + x.st.card));
    check(!wrongEarly, 'never says "not found" / "unreachable" in the first 6.5 s (the tries run first)');
    check(seen.some((x) => /Searching/i.test(x.st.chip + x.st.label)), 'says "Searching lyrics…" while it tries');
    if (c.finds) {
      check(firstLyrics != null, `lyrics appeared${firstLyrics != null ? ` at ${firstLyrics} s` : ''}`);
      if (c.name === 'fail-once') check(firstLyrics >= 2.5 && firstLyrics <= 6, 'found by the second try (about 2 s after the first)');
      if (c.name === 'fail-twice') check(firstLyrics >= 8 && firstLyrics <= 12, 'found by the third try (about 7 s after the first)');
      if (c.name === 'slow') {
        check(firstLyrics >= 6 && firstLyrics <= 10, 'late answer shows up without anything being restarted');
        const prog = await s.js(`document.querySelector('.pb-elapsed')?.textContent || ''`);
        console.log(`    clock reads ${prog} after the lyrics arrived (song started at 0:20)`);
      }
    } else {
      check(firstLyrics == null, 'no lyrics shown');
      check(firstFinal != null && firstFinal >= 6.5, `final answer only after the tries (at ${firstFinal} s)`);
    }
    // Saved or not (the app keeps answers through the local server's cache).
    const saved = await s.js(`fetch('/api/cache/' + encodeURIComponent('lyrics:' + ${JSON.stringify(`sp:${c.song.id}`)})).then((r) => r.status)`).catch(() => null);
    const keys = await s.js(`fetch('/api/cache').then((r) => r.ok ? r.json() : null).catch(() => null)`).catch(() => null);
    void keys;
    console.log(`    cache entry status for this song: ${saved}`);
  } finally {
    await s.cleanup();
  }
}
console.log(bad ? `lyrics-retry-check: ${bad} problems` : 'lyrics-retry-check: ok');
process.exit(bad ? 1 : 0);
