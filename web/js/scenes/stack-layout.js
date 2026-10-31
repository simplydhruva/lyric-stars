// Pure maths for the scrolling stack: two lines above the current one, three below. Slots are
// fractional while the stack glides: 0 is the middle, negative is above, positive is below. The
// glide itself (slotOf, slideProgress) is shared with karaoke.

export const ABOVE = 2;
export const BELOW = 3;
// Lines that can be on screen while the stack glides: one more at each end, fading in or out.
export const OFFSETS = [-(ABOVE + 1), -2, -1, 0, 1, 2, BELOW];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Opacity at slot s. Above the middle the stack is shorter, so it fades out sooner than below it.
export function stackAlpha(s) {
  const d = Math.abs(s);
  if (d <= 1) return 1 - 0.5 * d;
  if (d <= 2) return 0.5 - 0.2 * (d - 1);
  if (s < 0) return clamp(0.3 * (ABOVE + 1 - d), 0, 0.3);
  if (d <= 3) return 0.3 - 0.15 * (d - 2);
  return clamp(0.15 * (4 - d), 0, 0.15);
}

// Size relative to the middle line. Gentle, so the text stays big.
export function stackScale(s) {
  return 1 - 0.12 * Math.min(3, Math.abs(s));
}

// Where each whole slot sits, in px from the middle of the screen. heights[k] is the scaled height of
// the line at offset OFFSETS[k] (0 for a line that doesn't exist). Returns y for slots -3..+4.
export function stackCentres(heights, pad) {
  const h = {};
  OFFSETS.forEach((o, k) => (h[o] = heights[k] || 0));
  const y = { 0: 0 };
  for (let o = 1; o <= BELOW; o++) y[o] = y[o - 1] + h[o - 1] / 2 + (h[o] ? pad : 0) + h[o] / 2;
  y[BELOW + 1] = y[BELOW] + h[BELOW] / 2 + pad; // only ever reached while a line fades in
  for (let o = 1; o <= ABOVE + 1; o++) y[-o] = y[-(o - 1)] - h[-(o - 1)] / 2 - (h[-o] ? pad : 0) - h[-o] / 2;
  return y;
}

// Linear position between whole slots.
export function stackY(s, centres) {
  const lo = Math.floor(s);
  const hi = Math.ceil(s);
  if (lo === hi) return centres[lo];
  return centres[lo] + (centres[hi] - centres[lo]) * (s - lo);
}

// How far the settled stack reaches above and below the middle of the screen, in px. Used to shrink the
// stack a little when a small window can't hold it, keeping clear of the player bar at the bottom.
export function stackReach(heights, pad) {
  const c = stackCentres(heights, pad);
  const h = {};
  OFFSETS.forEach((o, k) => (h[o] = heights[k] || 0));
  let up = 0;
  let down = 0;
  for (let o = -ABOVE; o <= BELOW; o++) {
    if (!h[o]) continue;
    up = Math.max(up, -(c[o] - h[o] / 2));
    down = Math.max(down, c[o] + h[o] / 2);
  }
  return { up, down };
}

// The scale (at most 1) that makes the stack fit a window of height h: the top keeps a margin, and the bottom
// keeps clear of the player bar, which takes the lowest 'bottomInset' px.
export function stackFit(heights, pad, h, bottomInset) {
  const { up, down } = stackReach(heights, pad);
  const roomUp = h / 2 - h * 0.04;
  const roomDown = Math.max(1, h / 2 - bottomInset);
  return Math.min(1, up > 0 ? roomUp / up : 1, down > 0 ? roomDown / down : 1);
}
