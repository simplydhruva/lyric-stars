// Karaoke scene: lines sit centered; a gold fill sweeps across each word between its start and end
// times. The line before and the line after are faint above and below. Like every scene, it is a pure
// function of the playback position, so seeking and pausing never leave anything stale behind.
import { SLOT_PAD, slideProgress, slotAlpha, slotCentres, slotOf, slotScale, slotY } from './karaoke-layout.js';
import { createFitCache, drawFilledLine } from './line-draw.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const OFFSETS = [-2, -1, 0, 1]; // lines drawn, relative to the current one

export function createKaraoke() {
  let ctx = null;
  const cache = createFitCache(() => ctx);

  return {
    id: 'karaoke',
    name: 'Karaoke',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos } = frame;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.062, 22, 72);
      const maxW = w * 0.86;
      cache.check(frame, baseFont, maxW);

      const cur = index >= 0 ? lines[index] : null;
      // Before the first line there is nothing to slide from.
      const t = cur ? slideProgress(pos - cur.time, frame.reduceMotion) : 1;

      const items = OFFSETS.map((o) => {
        const i = index + o;
        if (i < 0 || i >= lines.length || !lines[i].words.length) return { i, f: null, height: 0 };
        const f = cache.fit(frame, i, baseFont, maxW);
        return { i, f, height: f.height * slotScale(o) };
      });
      const centres = slotCentres(items.map((it) => it.height), baseFont * SLOT_PAD);
      const mid = h / 2;
      OFFSETS.forEach((o, k) => {
        const it = items[k];
        if (!it.f) return;
        const s = slotOf(o, t);
        drawFilledLine(ctx, frame, it.i, it.f, {
          y: mid + slotY(s, centres),
          scale: slotScale(s),
          alpha: slotAlpha(s) * (frame.quiet ? 0.35 : 1),
          near: 1 - Math.abs(s),
          current: o === 0,
        });
      });
    },
  };
}
