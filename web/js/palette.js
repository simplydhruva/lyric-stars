// Loads album art and extracts its palette (two or three bright-enough colors; see extractPalette).
// Results are kept per image URL. A failed load is never kept: the next call tries again, and the console says why
// once per image, so the scenes fall back to gold knowing the reason.
import { extractPalette } from './theme.js';

const MAX_KEPT = 60;
const cache = new Map(); // url -> Promise of a non-empty palette, or of [] when the cover really has no colors
const warned = new Set();

export function albumPalette(url, trackId) {
  if (!url) return Promise.resolve([]);
  const key = trackId ? `${trackId}|${url}` : url;
  if (!cache.has(key)) {
    if (cache.size >= MAX_KEPT) cache.delete(cache.keys().next().value);
    const p = load(url).catch((err) => {
      cache.delete(key); // a failure is not an answer: try again next time
      if (!warned.has(url)) {
        warned.add(url);
        console.warn(`Album colors: could not read the cover (${err?.message || err}); using gold.`);
      }
      return [];
    });
    cache.set(key, p);
  }
  return cache.get(key);
}

async function load(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous'; // i.scdn.co allows it; without CORS the pixels can't be read
  img.decoding = 'async';
  img.src = url;
  await img.decode(); // the pixels are read only after the image has loaded
  const size = 48;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  return extractPalette(g.getImageData(0, 0, size, size).data); // throws if the canvas is tainted
}
