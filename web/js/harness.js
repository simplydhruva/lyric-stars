// Scores the word-timing estimator against hand-timed reference songs.
// Reference files use the same format the tap-to-sync editor exports.
import { buildTimeline, splitWords } from './timing.js';

export const TARGETS = { afterOffsetMs: 150, beforeOffsetMs: 250, songShare: 0.85 };

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// song: { track: { title, artist, durationMs }, lines: [{ time, text, words: [{ text, start }] }] }
export function scoreSong(song, opts = {}) {
  const input = song.lines.map((l) => ({ time: l.time, text: l.text }));
  const est = buildTimeline(input, { trackDurationMs: song.track?.durationMs, ...opts });
  const errors = [];
  let skipped = 0;
  song.lines.forEach((ref, i) => {
    const refWords = (ref.words || []).filter((w) => splitWords(w.text).length);
    if (!refWords.length) return;
    const got = est[i].words;
    if (got.length !== refWords.length) {
      skipped++;
      return;
    }
    // The first word of a line starts at the line time by definition; score the rest too,
    // since a late first word is exactly what the estimator gets wrong.
    refWords.forEach((w, k) => errors.push(got[k].start - w.start));
  });
  const bias = mean(errors);
  return {
    title: song.track?.title || '?',
    artist: song.track?.artist || '',
    words: errors.length,
    skippedLines: skipped,
    meanSigned: bias,
    meanAbs: mean(errors.map(Math.abs)),
    // "once the per-song offset is set": the best constant shift removes the bias
    meanAbsAfterOffset: mean(errors.map((e) => Math.abs(e - bias))),
  };
}

export function scoreSet(songs, opts = {}) {
  const results = songs.map((s) => scoreSong(s, opts)).filter((r) => r.words > 0);
  const share = (pred) => (results.length ? results.filter(pred).length / results.length : 0);
  return {
    songs: results,
    count: results.length,
    meanAbs: mean(results.map((r) => r.meanAbs)),
    meanAbsAfterOffset: mean(results.map((r) => r.meanAbsAfterOffset)),
    shareWithin150AfterOffset: share((r) => r.meanAbsAfterOffset <= TARGETS.afterOffsetMs),
    shareWithin250BeforeOffset: share((r) => r.meanAbs <= TARGETS.beforeOffsetMs),
  };
}
