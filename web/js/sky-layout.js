// Where one line's stars go and how they link. A pure function of the line, the
// previous line's layout, the screen size and the seed, so seeking or resizing
// always rebuilds the same sky.

const MARGIN = 0.06; // of the canvas, on every side
const CANDIDATES = 20; // best-candidate sampling: valid points scored per word
const MAX_TRIES = 240; // random points tried per word before the line counts as crowded
const FONT_ATTEMPTS = 6;
const GRID = 3;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rng(seed) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 7), 61 | s) ^ s;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The box a star and its label cover. Labels sit above or below the star and grow
// slightly while sung, so the box allows for the larger size.
export function footprint(x, y, width, font, labelBelow) {
  const half = Math.max(width * 0.53, font * 0.7);
  const star = font * 0.9;
  const label = font * 2.05; // label offset plus its height
  return {
    l: x - half,
    r: x + half,
    t: labelBelow ? y - star : y - label,
    b: labelBelow ? y + label : y + star,
  };
}

const overlaps = (a, b, pad) => a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad;

// words: [{ text }]. measure(text, font) -> label width in px. prev: the previous
// line's layout (or null). spread, chaos: 0..1.
export function placeLine({ words, w, h, seed, prev = null, measure, baseFont, spread = 1, chaos = 0.5 }) {
  const n = words.length;
  const recent = prev?.recent || [];
  if (!n) return { font: baseFont, stars: [], links: [], tail: prev?.tail || null, recent };

  // The area this line may use: the canvas inside the margins, shrunk toward the
  // centre when Spread is low.
  const mx = w * MARGIN;
  const my = h * MARGIN;
  const fill = 0.4 + 0.6 * clamp(spread, 0, 1);
  const aw = (w - 2 * mx) * fill;
  const ah = (h - 2 * my) * fill;
  const ax = (w - aw) / 2;
  const ay = (h - ah) / 2;
  const diag = Math.hypot(aw, ah);
  const cellOf = (x, y) =>
    Math.floor(clamp((y - ay) / ah, 0, 0.999) * GRID) * GRID + Math.floor(clamp((x - ax) / aw, 0, 0.999) * GRID);

  // Regions the last two lines used; the newest counts more.
  const used = new Array(GRID * GRID).fill(0);
  recent.forEach((cells, age) => cells.forEach((c, i) => (used[i] += c * (age ? 0.6 : 1))));
  const mostUsed = Math.max(1, ...used);

  const fading = prev?.stars || [];
  const jumpWeight = 0.1 + 0.9 * clamp(chaos, 0, 1);

  let font = baseFont;
  let stars;
  for (let attempt = 0; attempt < FONT_ATTEMPTS; attempt++) {
    let widths = words.map((wd) => measure(wd.text, font));
    // The widest word must fit the area.
    const widest = Math.max(...widths) * 1.06 + font;
    if (widest > aw) {
      font = Math.max(10, font * (aw / widest));
      widths = words.map((wd) => measure(wd.text, font));
    }
    const rand = rng(seed + attempt);
    const pad = font * 0.45;
    const last = attempt === FONT_ATTEMPTS - 1;
    stars = [];
    let crowded = false;

    for (let k = 0; k < n && !crowded; k++) {
      const from = stars.length ? stars[stars.length - 1] : prev?.tail;
      let best = null;
      let bestAny = null;
      let valid = 0;
      for (let tries = 0; tries < MAX_TRIES && valid < CANDIDATES; tries++) {
        const below = rand() < 0.5;
        const box0 = footprint(0, 0, widths[k], font, below);
        const x = ax - box0.l + rand() * Math.max(0, aw - (box0.r - box0.l));
        const y = ay - box0.t + rand() * Math.max(0, ah - (box0.b - box0.t));
        const box = footprint(x, y, widths[k], font, below);
        const ok = !stars.some((s) => overlaps(s.box, box, pad));

        // Far from every star on screen, a long jump from the previous star, and
        // in a region the last lines left empty.
        let near = Infinity;
        for (const s of stars) near = Math.min(near, Math.hypot(s.x - x, s.y - y));
        for (const s of fading) near = Math.min(near, Math.hypot(s.x - x, s.y - y));
        near = near === Infinity ? 0.5 : near / diag;
        const jump = from ? Math.hypot(from.x - x, from.y - y) / diag : 0;
        const score = near + jumpWeight * jump - 0.35 * (used[cellOf(x, y)] / mostUsed) + rand() * 0.04;

        const c = { x, y, labelBelow: below, box, score };
        if (!bestAny || score > bestAny.score) bestAny = c;
        if (ok) {
          valid++;
          if (!best || score > best.score) best = c;
        }
      }
      if (!best && !last) crowded = true;
      else stars.push(best || bestAny);
    }
    if (!crowded) break;
    font = Math.max(10, font * 0.86);
  }

  // Every star links to the previous word; Chaos adds links back to earlier stars.
  const linkRand = rng(seed ^ 0x9e3779b9);
  const links = [];
  for (let k = 1; k < n; k++) {
    links.push({ from: k - 1, to: k });
    const earlier = [];
    for (let j = 0; j < k - 1; j++) earlier.push(j);
    const pick = () => earlier.splice(Math.floor(linkRand() * earlier.length), 1)[0];
    if (earlier.length && linkRand() < 0.8 * chaos) links.push({ from: pick(), to: k });
    if (earlier.length && linkRand() < 0.3 * chaos) links.push({ from: pick(), to: k });
  }

  const cells = new Array(GRID * GRID).fill(0);
  for (const s of stars) cells[cellOf(s.x, s.y)]++;
  const out = stars.map(({ x, y, labelBelow, box }) => ({ x, y, labelBelow, box }));
  return { font, stars: out, links, tail: out[out.length - 1], recent: [cells, ...recent.slice(0, 1)] };
}
