// Lanterns: each word is lit at the bottom of the screen when it is sung and drifts upward as a glowing paper
// lantern, swaying a little, until it burns out near the top. Pure function of the playback position (the
// sway, the height and the glow are all worked out from how long ago the word started).
import { drawEmotion } from './emotion.js';
import { clamp, hash, lanternAlpha, lanternRise, lift, LANTERN_LIFE_MS, rgba, shownAt } from './motion.js';

export function createLanterns() {
  let ctx = null;

  function lantern(frame, word, li, i, n, dt, size) {
    const { w, h, theme, reduceMotion } = frame;
    const rise = lanternRise(dt);
    const alpha = lanternAlpha(dt) * (frame.quiet ? 0.35 : 1);
    if (alpha <= 0.004) return;
    ctx.font = `600 ${size}px ${frame.fontFamily}`;
    const tw = ctx.measureText(word.text).width;
    const bw = tw + size * 1.1;
    const bh = size * 1.9;
    const slot = 0.12 + 0.76 * ((i + 0.5) / n) + (hash(li, 99) - 0.5) * 0.08;
    const sway = reduceMotion ? 0 : Math.sin(dt / 900 + hash(li, i) * 6.28) * size * 0.6;
    const x = clamp(w * slot, bw / 2 + 6, w - bw / 2 - 6) + sway;
    const y = h * 0.9 - h * 1.04 * Math.pow(rise, 0.9);
    const fresh = reduceMotion ? 0 : clamp(1 - dt / 500, 0, 1); // a brief swell as it is lit
    const k = 1 + 0.18 * fresh;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, bw * 0.95);
    halo.addColorStop(0, rgba(theme.star, (0.34 + 0.2 * fresh) * alpha));
    halo.addColorStop(1, rgba(theme.star, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(-bw, -bw, bw * 2, bw * 2);
    // paper body, with a darker cap and base
    const body = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    body.addColorStop(0, rgba(lift(theme.star, 0.35), 0.5 * alpha));
    body.addColorStop(1, rgba(theme.star, 0.28 * alpha));
    ctx.fillStyle = body;
    ctx.strokeStyle = rgba(theme.star, 0.65 * alpha);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, size * 0.55);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(theme.star, 0.55 * alpha);
    ctx.fillRect(-bw * 0.28, -bh / 2 - size * 0.16, bw * 0.56, size * 0.16);
    ctx.fillRect(-bw * 0.22, bh / 2, bw * 0.44, size * 0.14);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawEmotion(ctx, frame, word.text, dt, li * 31 + i, size, alpha, () => ctx.fillText(word.text, 0, size * 0.04));
    ctx.fillStyle = rgba(theme.core || lift(theme.star, 0.7), alpha);
    ctx.fillText(word.text, 0, size * 0.04);
    ctx.restore();
  }

  return {
    id: 'lanterns',
    name: 'Lanterns',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {},
    draw(frame) {
      const { lines, index, w, h, pos, mode } = frame;
      if (index < 0) return;
      const size = clamp(Math.min(w, h * 1.6) * 0.042, 16, 46);
      // Older lines first, so the newest lanterns are on top. A lantern lives LANTERN_LIFE_MS.
      for (let li = Math.max(0, index - 3); li <= index; li++) {
        const line = lines[li];
        const n = line.words.length;
        for (let i = 0; i < n; i++) {
          const dt = pos - shownAt(line.words[i], line, mode);
          if (dt < 0 || dt > LANTERN_LIFE_MS) continue;
          lantern(frame, line.words[i], li, i, n, dt, size);
        }
      }
    },
  };
}
