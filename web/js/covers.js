// Album cover helpers: choosing sizes from Spotify's image list, and preloading a
// cover (with its colours) the moment a track is detected, once per track.
import { albumPalette } from './palette.js';

export const LARGE_PX = 640; // the now-playing cover
export const SMALL_PX = 64; // corner thumbnail and colours

const nearest = (images, target) =>
  images.reduce((best, img) => (Math.abs((img.width || 0) - target) < Math.abs((best.width || 0) - target) ? img : best));

// images: Spotify's [{url, width, height}]. The largest one for the cover and the one nearest 64 px for thumbnails
// (the closest sizes if those exact ones are missing; list order when sizes are not given).
export function pickImages(images) {
  const list = (images || []).filter((i) => i?.url);
  if (!list.length) return {};
  if (!list.some((i) => i.width)) return { large: list[0].url, small: list.at(-1).url };
  const sized = list.filter((i) => i.width);
  const largest = sized.reduce((best, img) => (img.width > best.width ? img : best));
  return { large: largest.url, small: nearest(sized, SMALL_PX).url };
}

// The album's images, else the track's own, else nothing (the scene draws a gold star).
export function imagesOf(item) {
  const fromAlbum = pickImages(item?.album?.images);
  return fromAlbum.large ? fromAlbum : pickImages(item?.images);
}

const MAX_KEPT = 40;
const preloaded = new Map(); // track id + cover urls -> Promise

// Starts loading the cover and reading its colours; safe to call again for the same track.
export function preloadCover(track) {
  const large = track?.artLarge;
  const small = track?.art;
  const id = track?.id || track?.key;
  if (!id || !(large || small) || typeof Image === 'undefined') return Promise.resolve();
  const k = `${id}|${large || ''}|${small || ''}`;
  if (!preloaded.has(k)) {
    if (preloaded.size >= MAX_KEPT) preloaded.delete(preloaded.keys().next().value);
    const image = large
      ? loadImage(large).catch(() => {}) // the same CORS mode as the scene, so its <img> reuses this download
      : Promise.resolve();
    preloaded.set(k, Promise.all([image, albumPalette(small || large)]).then(() => {}));
  }
  return preloaded.get(k);
}

async function loadImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
}
