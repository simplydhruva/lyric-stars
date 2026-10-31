// Draws the app icon (a gold four-point star on a night-sky tile) as PNG files,
// with no image tools needed: node tools/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'icons');

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Coverage-weighted color of one point; u, v in -1..1 across the tile.
function sample(u, v) {
  const r = 0.2; // tile corner radius
  const qx = Math.max(Math.abs(u) - (1 - r), 0);
  const qy = Math.max(Math.abs(v) - (1 - r), 0);
  if (Math.hypot(qx, qy) > r) return null; // outside the rounded tile
  // Night sky: deep blue at the top to black at the bottom.
  const t = (v + 1) / 2;
  let col = [18 * (1 - t) + 4 * t, 20 * (1 - t) + 5 * t, 44 * (1 - t) + 10 * t];
  // Four-point star: |x|^p + |y|^p <= R^p with p < 1 gives the pinched points.
  const p = 0.55;
  const R = 0.78;
  const d = Math.pow(Math.abs(u), p) + Math.pow(Math.abs(v), p);
  const edge = Math.pow(R, p);
  const glow = Math.exp(-Math.hypot(u, v) * 3.2) * 0.55;
  const gold = [244, 199, 107];
  const white = [255, 250, 235];
  col = col.map((c, i) => c + (gold[i] - c) * glow);
  if (d <= edge) {
    const k = Math.min(1, Math.hypot(u, v) / 0.35); // white-hot center fading to gold
    col = gold.map((g, i) => white[i] + (g - white[i]) * k);
  }
  return col;
}

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 4; // 4 x 4 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((x + (sx + 0.5) / ss) / size) * 2 - 1, ((y + (sy + 0.5) / ss) / size) * 2 - 1);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          n++;
        }
      }
      const i = (y * size + x) * 4;
      if (n) {
        rgba[i] = Math.round(r / n);
        rgba[i + 1] = Math.round(g / n);
        rgba[i + 2] = Math.round(b / n);
        rgba[i + 3] = Math.round((n / (ss * ss)) * 255);
      }
    }
  }
  return png(size, rgba);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.png'), draw(256));
fs.writeFileSync(path.join(OUT, 'tray.png'), draw(32));
console.log(`Icons written to ${OUT}`);
