// Scrolling stack: the current line is big in the middle, two lines above it fade and shrink, three
// upcoming lines wait faintly below. When the line changes, the whole stack glides up. In word mode the
// current line fills word by word; in line mode (M) it is lit all at once. Like every scene it is a pure
// function of the playback position.
import { SLOT_PAD, slideProgress, slotOf } from './karaoke-layout.js';
import { createFitCache, drawFilledLine } from './line-draw.js';
import { OFFSETS, stackAlpha, stackCentres, stackFit, stackScale, stackY } from './stack-layout.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createStack() {
  let ctx = null;
  const cache = createFitCache(() => ctx);

  return {
    id: 'stack',
    name: 'Scrolling stack',
    init(_canvas, context) {
      ctx = context;
    },
    resize() {
      cache.clear();
    },
    draw(frame) {
      const { lines, index, w, h, pos } = frame;
      const baseFont = clamp(Math.min(w, h * 1.6) * 0.07, 24, 84);
      const maxW = w * 0.88;
      const pad = baseFont * SLOT_PAD * 0.9;
      cache.check(frame, baseFont, maxW);

      const cur = index >= 0 ? lines[index] : null;
      const t = cur ? slideProgress(pos - cur.time, frame.reduceMotion) : 1;

      const heightsAt = (c) =>
        OFFSETS.map((o) => {
          const i = c + o;
          if (i < 0 || i >= lines.length || !lines[i].words.length) return 0;
          return cache.fit(frame, i, baseFont, maxW).height * stackScale(o);
        });
      const items = OFFSETS.map((o) => {
        const i = index + o;
        const ok = i >= 0 && i < lines.length && lines[i].words.length;
        return { i, f: ok ? cache.fit(frame, i, baseFont, maxW) : null };
      });
      const heights = heightsAt(index);
      const centres = stackCentres(heights, pad);
      // Shrink the whole stack so what is actually on screen fits the window (long lines take several rows).
      // Worked out for the settled stack of the current line and of the one before, and blended with the same
      // glide the lines use, so the size eases between lines instead of jumping. Still a function of position only.
      // The player bar and buttons take the lowest 130 px. Keep clear of them, but not at the price of tiny text: in a
      // small window the stack may shrink only to 55% for that (the faint lowest lines then pass behind the bar),
      // and below that only as far as the screen edge needs.
      const fitFor = (c) => {
        const hs = heightsAt(c);
        return Math.max(stackFit(hs, pad, h, 130), Math.min(0.55, stackFit(hs, pad, h, 0)));
      };
      const fitNow = fitFor(index);
      const fitScale = t < 1 && index > 0 ? fitFor(index - 1) + (fitNow - fitFor(index - 1)) * t : fitNow;
      const mid = h / 2;
      OFFSETS.forEach((o, k) => {
        const it = items[k];
        if (!it.f) return;
        const s = slotOf(o, t);
        drawFilledLine(ctx, frame, it.i, it.f, {
          y: mid + stackY(s, centres) * fitScale,
          scale: stackScale(s) * fitScale,
          alpha: stackAlpha(s) * (frame.quiet ? 0.35 : 1),
          near: 1 - Math.abs(s),
          current: o === 0,
        });
      });
    },
  };
}
