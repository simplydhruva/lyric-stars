// History of songs played, each with a small picture of its constellation (every line's stars and links together,
// drawn with the same placement rules as the Constellation scene, so a chorus lands on the same stars).
// Kept on disk through the lyric cache under one key. Nothing here is sent anywhere.
import { placeLine, hash } from './sky-layout.js';
import { detectChorus } from './scenes/chorus.js';

export const HISTORY_KEY = 'history';
export const MAX_ENTRIES = 80;
export const MIN_PLAY_MS = 8000; // a song skipped in under this is not counted as played

const LAYOUT_W = 1280; // lines are laid out as on a big screen, then drawn small
const LAYOUT_H = 800;

// Draws the whole song as one picture onto a 2D context of size w x h. Pure apart from drawing.
export function drawSongMap(g, w, h, lines, seed, star = [244, 199, 107]) {
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0b0a12');
  bg.addColorStop(1, '#050408');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const k = Math.min(w / LAYOUT_W, h / LAYOUT_H);
  g.save();
  g.translate((w - LAYOUT_W * k) / 2, (h - LAYOUT_H * k) / 2);
  g.scale(k, k);
  const chorus = detectChorus(lines);
  const layouts = [];
  let drawn = 0;
  for (let i = 0; i < lines.length; i++) {
    let placed = placeLine({
      words: lines[i].words,
      w: LAYOUT_W,
      h: LAYOUT_H,
      seed: hash(`${seed}|${i}`),
      prev: layouts[i - 1] || null,
      baseFont: 24,
      spread: 1,
      chaos: 0.5,
      measure: (text, font) => text.length * font * 0.55,
    });
    const c = chorus[i];
    if (c && c.occurrence > 0 && c.firstIndex < i) {
      const first = layouts[c.firstIndex];
      if (first && first.stars.length === placed.stars.length && first.stars.length) placed = { ...placed, stars: first.stars, links: first.links };
    }
    layouts[i] = placed;
    if (!lines[i].words.length) continue;
    drawn++;
    g.lineWidth = 2.5;
    g.strokeStyle = rgba(star, 0.16);
    for (const { from, to } of placed.links) {
      const a = placed.stars[from];
      const b = placed.stars[to];
      if (!a || !b) continue;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    for (const s of placed.stars) {
      const glow = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, 26);
      glow.addColorStop(0, rgba(star, 0.45));
      glow.addColorStop(1, rgba(star, 0));
      g.fillStyle = glow;
      g.fillRect(s.x - 26, s.y - 26, 52, 52);
      g.fillStyle = 'rgba(255,244,214,0.9)';
      g.beginPath();
      g.arc(s.x, s.y, 4.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  return drawn;
}

// A small JPEG data URL of the song's constellation, or null when the song has no lyrics or drawing isn't possible.
export function songMapThumb(lines, seed, { w = 240, h = 150 } = {}) {
  try {
    if (!lines?.some((l) => l.words?.length)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const drawn = drawSongMap(canvas.getContext('2d'), w, h, lines, seed);
    return drawn ? canvas.toDataURL('image/jpeg', 0.72) : null;
  } catch {
    return null;
  }
}

// store: { get(key) -> value | null, put(key, value) }
export class History {
  constructor(store, now = () => Date.now()) {
    this.store = store;
    this.now = now;
    this.entries = []; // newest first
    this.loaded = null;
  }

  load() {
    this.loaded ||= this.store.get(HISTORY_KEY).then(
      (v) => {
        if (Array.isArray(v?.entries)) this.entries = v.entries.filter((e) => e && typeof e.key === 'string');
      },
      () => {}
    );
    return this.loaded;
  }

  async save() {
    try {
      await this.store.put(HISTORY_KEY, { entries: this.entries });
    } catch (e) {
      console.warn('History write failed', e);
    }
  }

  // A song was played. Playing it again moves it to the top and counts the play; its picture is kept.
  async record(track) {
    if (!track?.key) return null;
    await this.load();
    const old = this.entries.find((e) => e.key === track.key);
    const entry = {
      key: track.key,
      title: track.title || 'Unknown',
      artist: track.artist || '',
      art: track.art || old?.art || null,
      thumb: old?.thumb || null,
      plays: (old?.plays || 0) + 1,
      playedAt: this.now(),
    };
    this.entries = [entry, ...this.entries.filter((e) => e.key !== track.key)].slice(0, MAX_ENTRIES);
    await this.save();
    return entry;
  }

  // The constellation picture for a song already in the history.
  async setThumb(key, thumb) {
    await this.load();
    const e = this.entries.find((x) => x.key === key);
    if (!e || !thumb || e.thumb === thumb) return;
    e.thumb = thumb;
    await this.save();
  }

  async clear() {
    this.entries = [];
    await this.save();
  }
}

const DAY = 24 * 60 * 60 * 1000;
// "just now", "12 min ago", "3 h ago", "yesterday", then the date.
export function ago(ms, now = Date.now()) {
  const d = Math.max(0, now - ms);
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < DAY) return `${Math.floor(d / 3_600_000)} h ago`;
  if (d < 2 * DAY) return 'yesterday';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
