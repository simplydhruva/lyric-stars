// Loads album art and extracts its palette. Results are kept per image URL.
import { extractPalette } from './theme.js';

const cache = new Map();

export function albumPalette(url) {
  if (!url) return Promise.resolve([]);
  if (!cache.has(url)) cache.set(url, load(url).catch(() => []));
  return cache.get(url);
}

async function load(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous'; // i.scdn.co allows it; without CORS the pixels can't be read
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const size = 48;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  return extractPalette(g.getImageData(0, 0, size, size).data);
}
