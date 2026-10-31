// LRC parsing. Returns lines sorted by time, in milliseconds.
// Lines with empty text are kept: they mark instrumental gaps.

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]/i;

function toMs(min, sec, frac) {
  let ms = 0;
  if (frac) {
    // ".5" = 500 ms, ".05" = 50 ms, ".005" = 5 ms
    ms = Math.round(Number(frac) * Math.pow(10, 3 - frac.length));
  }
  return Number(min) * 60000 + Number(sec) * 1000 + ms;
}

// Enhanced LRC: "<00:12.50>Look <00:12.90>at" — each tag gives the start of the text after it.
// Text before the first tag starts at the line time. A trailing tag marks when the last word ends.
// Several words between two tags share that span evenly.
function parseWordTags(rest, lineTime) {
  const parts = rest.split(/(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)/);
  const segs = [];
  let at = lineTime;
  let wordsEnd = null;
  for (const p of parts) {
    const tag = p.match(/^<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>$/);
    if (tag) {
      at = toMs(tag[1], tag[2], tag[3]);
      wordsEnd = at;
      continue;
    }
    const text = p.trim();
    if (text) {
      segs.push({ start: at, text });
      wordsEnd = null;
    }
  }
  const words = [];
  segs.forEach((s, i) => {
    const pieces = s.text.split(/\s+/);
    const next = i + 1 < segs.length ? segs[i + 1].start : (wordsEnd ?? s.start + 400 * pieces.length);
    const step = Math.max(0, next - s.start) / pieces.length;
    pieces.forEach((text, k) => words.push({ text, start: Math.round(s.start + step * k) }));
  });
  return wordsEnd != null ? { words, wordsEnd } : { words };
}

export function parseLrc(text) {
  if (!text) return [];
  let offset = 0;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    const off = row.match(OFFSET_TAG);
    if (off) {
      offset = Number(off[1]);
      continue;
    }
    const times = [];
    let last = 0;
    TIME_TAG.lastIndex = 0;
    let m;
    while ((m = TIME_TAG.exec(row)) && m.index === last) {
      times.push(toMs(m[1], m[2], m[3]));
      last = TIME_TAG.lastIndex;
    }
    if (!times.length) continue; // metadata like [ar:...] or junk
    const rest = row.slice(last);
    const lyric = rest.replace(WORD_TAG, ' ').replace(/\s+/g, ' ').trim();
    WORD_TAG.lastIndex = 0;
    const hasWordTags = WORD_TAG.test(rest);
    for (const t of times) {
      const line = { time: t, text: lyric };
      // Repeated timestamps can't share absolute word tags, so only the first copy keeps them.
      if (hasWordTags && t === times[0]) Object.assign(line, parseWordTags(rest, t));
      lines.push(line);
    }
  }
  // A positive offset means lyrics should appear earlier.
  for (const l of lines) {
    l.time = Math.max(0, l.time - offset);
    if (l.words) for (const w of l.words) w.start = Math.max(0, w.start - offset);
    if (l.wordsEnd != null) l.wordsEnd = Math.max(0, l.wordsEnd - offset);
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// Index of the last line whose time is <= position, or -1.
export function lineIndexAt(lines, positionMs) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
