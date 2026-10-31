// Colors and fonts for the sky. A theme is a few [r, g, b] colors the renderer
// draws with; album palettes and custom colors are turned into the same shape.

export const THEMES = {
  gold: { name: 'Gold', base: [244, 199, 107] },
  ice: { name: 'Ice', base: [138, 206, 255] },
  rose: { name: 'Rose', base: [255, 150, 178] },
};

// Installed on every Windows PC, so friends see the same thing without downloads.
export const FONTS = {
  segoe: { name: 'Segoe UI', css: '"Segoe UI", system-ui, -apple-system, sans-serif' },
  bahnschrift: { name: 'Bahnschrift', css: 'Bahnschrift, "Segoe UI", system-ui, sans-serif' },
  georgia: { name: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  palatino: { name: 'Palatino', css: '"Palatino Linotype", Palatino, Georgia, serif' },
  candara: { name: 'Candara', css: 'Candara, "Segoe UI", sans-serif' },
  consolas: { name: 'Consolas', css: 'Consolas, "Cascadia Mono", monospace' },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const WHITE = [255, 255, 255];

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(c) {
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

// Stars must read on black: keep the hue, lift dark or grey colors into a glowing range.
export function forNightSky(c) {
  const [h, s, l] = rgbToHsl(c);
  return hslToRgb([h, clamp(s, 0.35, 0.9), clamp(l, 0.62, 0.78)]);
}

// The colors the renderer uses, from one base color and optional accents.
export function makeTheme(base, accents = []) {
  const star = forNightSky(base);
  return {
    star, // glow and links
    core: mix(star, WHITE, 0.72), // sparkle body
    label: mix(star, WHITE, 0.45), // word text
    accents: accents.length ? accents.map(forNightSky) : [star], // background nebula and dust
  };
}

// Picks two or three distinct, colorful colors from album art pixels (RGBA bytes).
// Grey, near-black and near-white pixels are ignored; returns [] when the art is monochrome.
export function extractPalette(data, count = 3) {
  const buckets = new Map();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const c = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = rgbToHsl(c);
    if (s < 0.25 || l < 0.12 || l > 0.92) continue;
    const key = Math.floor(h / 20); // 18 hue buckets
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, sat: 0 };
    b.n++;
    b.r += c[0];
    b.g += c[1];
    b.b += c[2];
    b.sat += s;
    buckets.set(key, b);
  }
  const total = data.length / 4;
  const ranked = [...buckets.entries()]
    .filter(([, b]) => b.n >= total * 0.02)
    // Common colors first, with a nudge toward vivid ones.
    .map(([key, b]) => ({ key, score: b.n * (0.5 + b.sat / b.n), color: [b.r / b.n, b.g / b.n, b.b / b.n].map(Math.round) }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  for (const r of ranked) {
    // Skip hues next to one already picked, so the palette has some range.
    if (picked.some((p) => Math.min(Math.abs(p.key - r.key), 18 - Math.abs(p.key - r.key)) < 2)) continue;
    picked.push(r);
    if (picked.length === count) break;
  }
  return picked.map((p) => p.color);
}

// Resolves settings and the current album palette into the theme to draw with.
export function resolveTheme({ theme = 'gold', customColor, albumColors }, palette) {
  if (albumColors && palette?.length) return makeTheme(palette[0], palette);
  if (theme === 'custom') return makeTheme(hexToRgb(customColor) || THEMES.gold.base);
  return makeTheme((THEMES[theme] || THEMES.gold).base);
}

export function fontCss(key) {
  return (FONTS[key] || FONTS.segoe).css;
}
