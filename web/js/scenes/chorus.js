// Finding the chorus from the lyrics alone: a line that comes back (same words, or nearly) is a repeat.
// Pure functions of the timeline, so every scene can use them.

// The words of a line, lower case, without punctuation, as one string ("Oh, baby!" -> "oh baby").
export function normalizeLine(line) {
  return line.words
    .map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean)
    .join(' ');
}

const MIN_WORDS = 2; // "Oh" and "Yeah" come back all song long without being the chorus
const SIMILAR = 0.75; // share of words two lines need in common to count as the same line

function similar(a, b) {
  if (a.key === b.key) return true;
  const small = Math.min(a.set.size, b.set.size);
  if (small < 3) return false;
  let shared = 0;
  for (const w of a.set) if (b.set.has(w)) shared++;
  return shared / Math.max(a.set.size, b.set.size) >= SIMILAR;
}

// For each line: { group, occurrence, count, chorus, firstIndex }.
//   group       the number shared by lines that match (-1 for lines that never come back or are too short)
//   occurrence  0 the first time the line is sung, 1 the second time, and so on
//   count       how many times the song sings it
//   chorus      true when count >= 2 (every time, including the first)
//   firstIndex  index of the first time it is sung (the line itself when occurrence is 0)
export function detectChorus(lines) {
  const items = lines.map((line, index) => {
    const key = normalizeLine(line);
    return { index, key, set: new Set(key.split(' ').filter(Boolean)), count: key ? key.split(' ').length : 0 };
  });
  const groups = []; // the first line of each group, to compare later lines against
  const info = items.map((it) => {
    if (it.count < MIN_WORDS) return { group: -1, occurrence: 0, count: 1, chorus: false, firstIndex: it.index };
    let g = groups.findIndex((first) => similar(first, it));
    if (g < 0) {
      g = groups.length;
      groups.push(it);
      return { group: g, occurrence: 0, count: 1, chorus: false, firstIndex: it.index };
    }
    return { group: g, occurrence: -1, count: 1, chorus: false, firstIndex: groups[g].index };
  });
  const members = groups.map(() => []);
  info.forEach((x, i) => x.group >= 0 && members[x.group].push(i));
  members.forEach((list) => {
    list.forEach((i, n) => {
      info[i].occurrence = n;
      info[i].count = list.length;
      info[i].chorus = list.length >= 2;
    });
  });
  return info;
}
