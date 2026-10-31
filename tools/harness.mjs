// Timing harness: scores the estimator against test/reference/*.json.
//   npm run harness                    print the report
//   npm run harness -- --update-baseline   accept the current numbers as the new baseline
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreSet, TARGETS } from '../web/js/harness.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REF_DIR = path.join(ROOT, 'test', 'reference');
export const BASELINE = path.join(REF_DIR, 'baseline.json');

export function loadReferenceSongs() {
  if (!fs.existsSync(REF_DIR)) return [];
  return fs
    .readdirSync(REF_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'baseline.json')
    .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(REF_DIR, f), 'utf8')) }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const songs = loadReferenceSongs();
  if (!songs.length) {
    console.log(`No reference songs yet. Export timings from the tap-to-sync editor (E) into ${path.relative(ROOT, REF_DIR)}/`);
    process.exit(0);
  }
  const r = scoreSet(songs);
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  const ms = (v) => `${Math.round(v)}`.padStart(6);
  console.log(`${pad('Song', 40)} words  bias   |err|  |err| after offset`);
  for (const s of r.songs) {
    console.log(`${pad(`${s.title} · ${s.artist}`, 40)} ${String(s.words).padStart(5)} ${ms(s.meanSigned)} ${ms(s.meanAbs)} ${ms(s.meanAbsAfterOffset)}${s.skippedLines ? `  (${s.skippedLines} lines skipped)` : ''}`);
  }
  const pct = (v) => `${Math.round(v * 100)}%`;
  console.log(`\n${r.count} songs · mean |err| ${Math.round(r.meanAbs)} ms · after per-song offset ${Math.round(r.meanAbsAfterOffset)} ms`);
  console.log(`Within ${TARGETS.afterOffsetMs} ms after offset: ${pct(r.shareWithin150AfterOffset)} (target ${pct(TARGETS.songShare)})`);
  console.log(`Within ${TARGETS.beforeOffsetMs} ms before offset: ${pct(r.shareWithin250BeforeOffset)} (target ${pct(TARGETS.songShare)})`);
  if (r.count < 30) console.log(`Reference set has ${r.count} of 30 songs.`);
  if (process.argv.includes('--update-baseline')) {
    fs.writeFileSync(
      BASELINE,
      JSON.stringify({ count: r.count, meanAbs: r.meanAbs, meanAbsAfterOffset: r.meanAbsAfterOffset }, null, 2) + '\n'
    );
    console.log(`Baseline written to ${path.relative(ROOT, BASELINE)}`);
  }
}
