// Checks the beat pulse end to end in the real desktop app: plays a drum loop through the PC's own audio output,
// turns on "Pulse to the beat", and waits for the app to report the tempo. Needs a Windows audio output device.
//   node --experimental-websocket tools/beat-check.mjs [BPM]
// It uses its own port (5211), data folder and the demo song. It plays a quiet drum loop for about 20 seconds.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, sleep, waitFor } from './lib/headless.mjs';

const BPM = Number(process.argv[2]) || 120;
// LYRICSTARS_EXE=<path to Lyric Stars.exe> checks an installed copy instead of the source tree.
const INSTALLED = process.env.LYRICSTARS_EXE;
const ELECTRON = INSTALLED || path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_ARG = INSTALLED ? [] : ['.'];
const PAGE_PORT = 9335;
let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

// A 24 s drum loop: a low thump on every beat, a short hiss on the off-beats. 16-bit mono, 44.1 kHz.
function drumLoop(bpm, seconds) {
  const rate = 44100;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  const beat = Math.round((60 / bpm) * rate);
  let seed = 1;
  for (let i = 0; i < n; i++) {
    const inBeat = i % beat;
    const t = inBeat / rate;
    let v = 0.5 * Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-t * 40)) * t) * Math.exp(-t * 14);
    const off = (i + beat / 2) % beat;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    v += 0.12 * (seed / 4294967296 - 0.5) * Math.exp(-(off / rate) * 60);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id));
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const js = async (expression, userGesture = false) => {
    await ready;
    const r = await new Promise((res) => {
      pending.set(++id, res);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true, userGesture } }));
    });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  return { js, close: () => ws.close() };
}

const work = mkdtempSync(path.join(tmpdir(), 'lyricstars-beat-'));
mkdirSync(path.join(work, 'desktop'), { recursive: true });
const wav = path.join(work, 'loop.wav');
writeFileSync(wav, drumLoop(BPM, 24));
const start = '/?demo=&title=Beat+Check&artist=Check&duration=120&start=6&seed=7&scene=constellation';
const proc = spawn(ELECTRON, [...APP_ARG, `--remote-debugging-port=${PAGE_PORT}`], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, LYRICSTARS_PORT: '5211', LYRICSTARS_DATA: work, LYRICSTARS_START: start },
});
let player;
let page;
try {
  const target = await waitFor('the page', async () => (await (await fetch(`http://127.0.0.1:${PAGE_PORT}/json`)).json()).find((t) => t.type === 'page' && t.url.includes('5211')), 30000);
  page = cdp(target.webSocketDebuggerUrl);
  await waitFor('the app', () => page.js(`document.getElementById('card')?.hidden === true || !!document.getElementById('sky')`), 20000);
  await sleep(1500);

  const off = await page.js(`document.querySelector('[name=beatPulse]') ? 'x' : 'no checkbox yet'`);
  await page.js(`document.getElementById('btn-settings').click()`);
  await sleep(400);
  check('the Settings panel has the beat pulse option in the desktop app', await page.js(`!!document.querySelector('[name=beatPulse]')`), String(off));

  player = spawn('powershell.exe', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${wav}').PlaySync()`], { stdio: 'ignore' });
  await sleep(1000);
  // A real click (user activation) on the checkbox, like the user would do.
  await page.js(`(() => { const c = document.querySelector('[name=beatPulse]'); c.click(); })()`, true);
  const status = () => page.js(`lyricStarsBeat.state === 'listening' ? (lyricStarsBeat.bpm ? 'Beat found: about ' + Math.round(lyricStarsBeat.bpm) + ' BPM.' : 'Listening.') : lyricStarsBeat.state`);
  let listening = await waitFor('listening', async () => (await status()).match(/Beat found|Listening/), 8000).then(() => true, () => false);
  const why = await page.js(`lyricStarsBeat.state + ' ' + lyricStarsBeat.error`);
  check('the app is allowed to listen to the PC audio (no picker, no prompt)', listening, (await status()) || why);
  let found = '';
  await waitFor('a beat', async () => (found = await status()).startsWith('Beat found'), 18000).catch(() => {});
  const bpm = Number(found.match(/about (\d+)/)?.[1] || 0);
  check(`finds the tempo of the drum loop (${BPM} BPM)`, [BPM, BPM / 2, BPM * 2].some((b) => Math.abs(bpm - b) <= 3), found || 'no beat found');
  const swing = await page.js(`new Promise((res) => { const v = []; const t = setInterval(() => v.push(lyricStarsBeat.pulse()), 16); setTimeout(() => { clearInterval(t); res([Math.min(...v), Math.max(...v)]); }, 1500); })`);
  check('the pulse rises on the beat and fades between beats', swing[1] > 0.7 && swing[0] < 0.2, `low ${swing[0].toFixed(2)}, high ${swing[1].toFixed(2)}`);
  const pulses = await page.js(`(async () => { const m = await import('/js/audio-beat.js'); return 'ok'; })()`);
  check('page loads without errors', pulses === 'ok');
  await page.js(`document.querySelector('[name=beatPulse]').click()`, true);
  await sleep(500);
  check('turning it off stops listening', (await status()) === 'off');
} catch (e) {
  check('ran to the end', false, e.message);
} finally {
  page?.close();
  player?.kill();
  proc.kill();
}
console.log(bad ? `\nbeat check: ${bad} failed` : '\nbeat check: passed');
process.exit(bad ? 1 : 0);
