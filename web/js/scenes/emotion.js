// Emotion words: a few words (fire, night, love, rain, sun...) get a small coloured glow while they are on screen.
// English only, from a short built-in list; any other language simply gets no effect. The effect only ADDS a glow
// behind a word that is already drawn, starting on the word's own start, so it can never delay or hide a word.
// What it does over time is a pure function of how long ago the word started (never of the wall clock).
import { clamp, hash, rgba } from './motion.js';

// kind -> glow colour
export const EMOTION_COLORS = {
  fire: [255, 128, 48],
  night: [132, 160, 255],
  love: [255, 104, 156],
  water: [96, 186, 255],
  sun: [255, 214, 104],
};

const LISTS = {
  fire: 'fire fires flame flames burn burns burning burned blaze blazing inferno ignite ignited spark sparks ember embers ashes heat hot flaming',
  night: 'night nights midnight moon moonlight moonlit star stars starlight dark darkness shadow shadows dream dreams dreaming dusk twilight',
  love: 'love loved loves loving heart hearts kiss kisses kissed darling forever beloved romance',
  water: 'rain raining rains tear tears cry cried crying ocean sea river storm thunder waves drown drowning flood',
  sun: 'sun sunshine sunlight sunrise sunset light gold golden shine shining shines bright dawn glow glowing',
};

const KIND_OF = new Map();
for (const [kind, words] of Object.entries(LISTS)) for (const w of words.split(' ')) KIND_OF.set(w, kind);

const memo = new Map();
// 'Fire,' -> 'fire'; null when the word is not an emotion word.
export function emotionOf(text) {
  let k = memo.get(text);
  if (k === undefined) {
    const plain = String(text).toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '').replace(/['’]s$/, '');
    k = KIND_OF.get(plain) || null;
    if (memo.size > 5000) memo.clear();
    memo.set(text, k);
  }
  return k;
}

// How the glow of one word behaves `since` ms after the word started. Returns { a, blur }: strength 0..1 and how
// wide the glow is (1 = normal). It is strong from the very first instant. With reduce motion it holds still.
export function emotionLook(kind, since, seed, still) {
  const t = Math.max(0, since);
  switch (kind) {
    case 'fire': // a flicker: a new random strength about every 80 ms
      return { a: still ? 0.85 : 0.6 + 0.4 * hash(Math.floor(t / 80), seed), blur: still ? 1 : 0.9 + 0.3 * hash(Math.floor(t / 110), seed + 7) };
    case 'love': // a slow heartbeat, 1.2 s a beat
      return { a: still ? 0.85 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((t / 1200) * Math.PI * 2 - Math.PI / 2)), blur: 1 };
    case 'water': // a gentle shimmer
      return { a: still ? 0.75 : 0.6 + 0.3 * Math.sin(t / 420 + hash(seed, 3) * 6.28), blur: 1.1 };
    case 'sun': // a warm glow that swells a little
      return { a: still ? 0.85 : 0.8 + 0.15 * Math.sin(t / 700), blur: still ? 1.2 : 1.2 + 0.2 * Math.sin(t / 900) };
    default: // night: steady, a soft cool glow
      return { a: 0.8, blur: 1.1 };
  }
}

// Paints the glow for one word. `paint` draws the word's text once at its place (it is called with the same
// transform and font the scene used, so it should just fillText / strokeText); `size` is the font size in px and
// `alpha` the word's own opacity. Does nothing for ordinary words or when frame.emotion is off.
export function drawEmotion(ctx, frame, text, since, seed, size, alpha, paint) {
  if (!frame.emotion || since < 0 || alpha <= 0.004) return;
  const kind = emotionOf(text);
  if (!kind) return;
  const look = emotionLook(kind, since, seed, frame.reduceMotion);
  const c = EMOTION_COLORS[kind];
  const a = clamp(look.a, 0, 1) * alpha * (frame.quiet ? 0.35 : 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = rgba(c, 1 * a);
  ctx.shadowBlur = size * 0.75 * look.blur * ((frame.glow ?? 0.25) * 2);
  ctx.fillStyle = rgba(c, 0.5 * a);
  ctx.strokeStyle = rgba(c, 0.5 * a);
  paint();
  ctx.restore();
}
