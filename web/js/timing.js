// Timing engine: turns timed lines into timed words.
// Milestone 2 tunes these numbers against the hand-timed reference set.

export const DEFAULTS = {
  breathMs: 150, // gap left before the next line starts
  maxSyllableMs: 380, // a long gap does not stretch words beyond this pace
  wordWeight: 0.3, // fixed cost per word on top of its syllables
};

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/g;

export function countSyllables(word) {
  const w = String(word || '').toLowerCase();
  const cjk = w.match(CJK);
  if (cjk) return cjk.length;
  const latin = w.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  if (latin) {
    const groups = latin.match(/[aeiouy]+/g);
    let n = groups ? groups.length : 0;
    // Silent trailing e ("love", "shine"), but not "-le" ("little") or one-vowel words ("the").
    if (n > 1 && /[^aeiouy]e$/.test(latin) && !/[^aeiouy]le$/.test(latin)) n--;
    if (n > 1 && /[^aeiouy]es$/.test(latin) && !/(?:[cgsxz]|ch|sh)es$/.test(latin)) n--;
    return Math.max(1, n);
  }
  const letters = w.replace(/[^\p{L}]/gu, '');
  return letters ? Math.max(1, Math.round(letters.length / 3)) : 0;
}

export function splitWords(text) {
  return String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

// lines: [{ time, text }] sorted. Returns [{ time, end, text, words: [{ text, start, end }] }].
export function buildTimeline(lines, { trackDurationMs, ...opts } = {}) {
  const o = { ...DEFAULTS, ...opts };
  return lines.map((line, i) => {
    const words = splitWords(line.text);
    const next = i + 1 < lines.length ? lines[i + 1].time : (trackDurationMs || line.time + 6000);
    const available = Math.max(200, next - line.time - o.breathMs);
    const weights = words.map((w) => Math.max(1, countSyllables(w)) + o.wordWeight);
    const total = weights.reduce((a, b) => a + b, 0);
    const paced = weights.reduce((a, w) => a + (w - o.wordWeight), 0) * o.maxSyllableMs;
    const duration = words.length ? Math.min(available, Math.max(paced, 300)) : 0;
    let acc = 0;
    const timed = words.map((text, k) => {
      const start = line.time + (duration * acc) / total;
      acc += weights[k];
      return { text, start: Math.round(start), end: Math.round(line.time + (duration * acc) / total) };
    });
    return { time: line.time, end: line.time + duration, text: line.text, words: timed };
  });
}
