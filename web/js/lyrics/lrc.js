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
    // Word tags (enhanced LRC) are stripped for now; the timing engine reads them later.
    const lyric = row.slice(last).replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    for (const t of times) lines.push({ time: t, text: lyric });
  }
  // A positive offset means lyrics should appear earlier.
  for (const l of lines) l.time = Math.max(0, l.time - offset);
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
