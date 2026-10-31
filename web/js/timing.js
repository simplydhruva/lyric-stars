// Timing engine: turns timed lines into timed words.
// Real word times (enhanced LRC tags, or the user's own taps) always win;
// otherwise each line's time is spread across its words by syllables.
import { countSyllables } from './syllables.js';

export { countSyllables };

export const DEFAULTS = {
  breathMs: 150, // gap left before the next line starts
  maxSyllableMs: 380, // a long gap does not stretch words beyond this pace
  wordWeight: 0.3, // fixed cost per word on top of its syllables
};

const isWord = (w) => /[\p{L}\p{N}]/u.test(w);

export function splitWords(text) {
  return String(text || '').split(/\s+/).filter(isWord);
}

function weightOf(word, o) {
  return Math.max(1, countSyllables(word)) + o.wordWeight;
}

// How long a line's words take: paced by syllables, never past the next line (minus a breath).
function sungDuration(words, available, o) {
  if (!words.length) return 0;
  const syllables = words.reduce((a, w) => a + Math.max(1, countSyllables(w)), 0);
  return Math.min(available, Math.max(syllables * o.maxSyllableMs, 300));
}

function estimateLine(line, next, o) {
  const words = splitWords(line.text);
  const available = Math.max(200, next - line.time - o.breathMs);
  const duration = sungDuration(words, available, o);
  const weights = words.map((w) => weightOf(w, o));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const timed = words.map((text, k) => {
    const start = line.time + (duration * acc) / total;
    acc += weights[k];
    return { text, start: Math.round(start), end: Math.round(line.time + (duration * acc) / total) };
  });
  return { time: line.time, end: line.time + duration, text: line.text, words: timed, timing: 'estimated' };
}

function realLine(line, next, o) {
  const src = line.words.filter((w) => isWord(w.text));
  const available = Math.max(200, next - line.time - o.breathMs);
  const words = src.map((w, k) => {
    let end;
    if (k + 1 < src.length) end = src[k + 1].start;
    else if (line.wordsEnd != null) end = line.wordsEnd;
    else end = Math.min(line.time + available, w.start + weightOf(w.text, o) * o.maxSyllableMs);
    return { text: w.text, start: Math.round(w.start), end: Math.round(Math.max(end, w.start)) };
  });
  const end = words.length ? words[words.length - 1].end : line.time;
  // A first word tapped before the LRC line time pulls the line in with it.
  const time = words.length ? Math.min(line.time, words[0].start) : line.time;
  return { time, end, text: line.text, words, timing: line.timing || 'word' };
}

// lines: [{ time, text, words?: [{ text, start }], wordsEnd? }] sorted by time.
// Returns [{ time, end, text, timing, words: [{ text, start, end }] }].
export function buildTimeline(lines, { trackDurationMs, ...opts } = {}) {
  const o = { ...DEFAULTS, ...opts };
  return lines.map((line, i) => {
    const next = i + 1 < lines.length ? lines[i + 1].time : (trackDurationMs || line.time + 6000);
    const real = line.words?.length && line.words.every((w) => Number.isFinite(w.start));
    return real ? realLine(line, next, o) : estimateLine(line, next, o);
  });
}

// What the indicator shows: "word-timed" if most sung lines have real times.
export function timelineKind(timeline) {
  const sung = timeline.filter((l) => l.words.length);
  if (!sung.length) return 'estimated';
  const counts = {};
  for (const l of sung) counts[l.timing] = (counts[l.timing] || 0) + 1;
  if ((counts.yours || 0) * 2 >= sung.length) return 'yours';
  if (((counts.word || 0) + (counts.yours || 0)) * 2 >= sung.length) return 'word';
  return 'estimated';
}
