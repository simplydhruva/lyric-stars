// Album cover images for the scenes that show the cover (orbit, polaroid). Loaded once per URL and kept
// (the last few). The same cross-origin mode as the palette loader, so the canvas stays readable.
// artImage() returns the image once it has loaded and null until then; the renderer is told when one arrives
// so a paused picture redraws with it.
const MAX = 6;
const cache = new Map();
let listener = null;

export function setArtListener(fn) {
  listener = fn;
}

// Asks the renderer to repaint (a font or something else a paused picture depends on has just arrived).
export function pokeRedraw() {
  listener?.();
}

export function artImage(url) {
  if (!url || typeof Image === 'undefined') return null;
  let e = cache.get(url);
  if (!e) {
    const img = new Image();
    e = { img, ok: false };
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      e.ok = true;
      listener?.();
    };
    img.src = url;
    cache.set(url, e);
    if (cache.size > MAX) cache.delete(cache.keys().next().value);
  }
  return e.ok ? e.img : null;
}

// Draws the image into the box, cropped to fill it (like CSS object-fit: cover).
export function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}
