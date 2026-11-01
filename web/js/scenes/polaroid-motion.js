// The maths of the Polaroid scene, kept apart from the drawing so it can be tested: card size, the damped swing of a
// pinned photo, where each card sits, how the cards stack up behind the current one, the development of the picture,
// the slow Ken Burns drift of the cover, the pop on a line's last word, the camera intro and the optional flash.
// Everything is a pure function of the playback position, so a seek or a paused screenshot is always right.
//
// The timing rule: a word is readable on its start frame. So a card never starts a line off screen or covered: it flies
// in during the gap before the line (PRE_MS at most) and lands exactly at the line's start; with no gap it starts a
// short hop from its place, still on screen, and the caption is drawn at full strength from the first frame.
import { clamp, easeInOut, easeOut, hash } from './motion.js';

export const PRE_MS = 550; // flight before the line starts, when the gap allows
export const SETTLE_MS = 350; // the rest of the flight after the line starts (overshoot and back)
export const TRANS_MS = 700; // a card moving back to the next place in the stack
export const CAMERA_MS = 1400; // the first card sliding out of the camera, ending when the first line starts
export const DEVELOP_MS = 1200; // the picture developing
export const FLASH_MS = 80; // the spec: never over text for more than 80 ms
export const PENDULUM_MS = 1500; // the swing has died away by then
export const TILT_MAX = (6 * Math.PI) / 180;
export const STACK_DEPTH = 3; // older cards kept behind the current one

export const easeOutBack = (t) => {
  const x = clamp(t, 0, 1) - 1;
  const c1 = 1.4;
  return 1 + (c1 + 1) * x * x * x + c1 * x * x;
};

// A string seed (track and play) as a small whole number.
export function seedInt(seed) {
  let h = 2166136261;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100003;
}

// Card size from the canvas size: the photo is a square, the border thicker at the bottom (the writing strip).
export function cardSize(w, h, out = {}) {
  const cw = clamp(Math.min(w * 0.7, h * 0.52), 160, 720);
  out.cw = cw;
  out.border = cw * 0.06;
  out.photo = cw - out.border * 2;
  out.strip = cw * 0.34;
  out.ch = out.border + out.photo + out.strip;
  return out;
}

// A pinned photo knocked into place: angle in radians, A at the moment it lands, then a damped swing (about 1.5 s).
export function pendulum(sinceLanding, amplitude = 0.07, zeta = 2.0, omega = 2 * Math.PI * 1.15) {
  if (!(sinceLanding > 0)) return sinceLanding === 0 ? amplitude : 0;
  const t = sinceLanding / 1000;
  return amplitude * Math.exp(-zeta * t) * Math.cos(omega * t);
}

// 1.00 to 1.03 and back over 260 ms, from the start of a line's last word.
export function pop(sinceLastWord) {
  if (!(sinceLastWord > 0)) return 1;
  return 1 + 0.03 * Math.sin(Math.PI * clamp(sinceLastWord / 260, 0, 1));
}

// How developed the picture is, 0 (dark and washed out) to 1 (full colour). The writing is never held back by it.
export const develop = (sinceLanding) => easeOut(sinceLanding / DEVELOP_MS);

// Each card's own tilt (radians, within about +-6 degrees) and place on the wall (fractions of the screen), by seed.
export const tiltOf = (li, seed) => (hash(li, 3 + seed) - 0.5) * 2 * TILT_MAX;
export function placeOf(li, seed, out = {}) {
  out.dx = (hash(li, 11 + seed) - 0.5) * 0.08;
  out.dy = (hash(li, 17 + seed) - 0.5) * 0.06;
  return out;
}
// Which way a card flies in from (an angle in radians; mostly from the sides and the top)
export const arriveAngle = (li, seed) => -Math.PI / 2 + (hash(li, 23 + seed) - 0.5) * Math.PI * 1.6;

// The flight of a card landing at time T. gapBefore: ms of silence before the line (how long it may fly).
// Returns k: 1 at the start of the flight, 0 once landed, a little below 0 on the overshoot. Multiply by a distance.
// start: how far to fly, 0 (a short hop) to 1 (from off screen), from how long the gap allows.
export function arrival(pos, T, gapBefore, out = {}) {
  const pre = clamp(gapBefore, 0, PRE_MS);
  const u = clamp((pos - (T - pre)) / (pre + SETTLE_MS), 0, 1);
  out.k = 1 - easeOutBack(u);
  out.start = pre / PRE_MS;
  out.since = pos - T; // ms since landing (negative while still flying in): drives the swing
  return out;
}

// The first card of a song: it slides out of the camera at the bottom edge and glides to its place, arriving as the
// first line starts. p 0..1 the whole way; slot: how visible the camera slot still is.
export function cameraIntro(pos, T0, out = {}) {
  const p = clamp((pos - (T0 - CAMERA_MS)) / CAMERA_MS, 0, 1);
  out.p = p;
  out.eject = clamp(p / 0.4, 0, 1); // 0..1: the card coming out of the slot
  out.glide = easeInOut(clamp((p - 0.35) / 0.65, 0, 1)); // 0..1: moving to its place
  out.slot = p >= 1 ? 0 : p < 0.05 ? p / 0.05 : 1 - clamp((p - 0.8) / 0.2, 0, 1);
  return out;
}

// The stack. A card's age in places: 0 is the front, 1 the first behind it, up to STACK_DEPTH + 1 where it has faded.
// since: ms since the current line started. A card of age a (whole) has been moving from a-1 to a since then.
export const ageOf = (index, li, since, still) => {
  const a = index - li;
  if (a <= 0) return 0;
  return a - 1 + (still ? 1 : easeInOut(since / TRANS_MS));
};

// Where a card of (fractional) age sits behind the front: fractions of the card width, a scale, a brightness (1 = as is)
// and an opacity. Deeper cards are smaller, dimmer and peek out to alternating sides.
export function slot(age, side, out = {}) {
  const a = clamp(age, 0, STACK_DEPTH + 1);
  out.x = side * 0.2 * a;
  out.y = -0.07 * a;
  out.scale = 1 - 0.09 * a;
  out.dim = Math.min(0.62, a * 0.2); // black laid over the card
  out.alpha = a <= STACK_DEPTH ? 1 : 1 - (a - STACK_DEPTH);
  return out;
}

// The slow drift and zoom of the cover inside the frame. ageMs: how long the card has been on the wall.
export function kenBurns(li, seed, ageMs, out = {}) {
  const t = clamp(ageMs, 0, 60000);
  const a = hash(li, 29 + seed) * Math.PI * 2;
  const prog = clamp(t / 24000, 0, 1) - 0.5;
  out.zoom = 1.06 + 0.1 * (1 - Math.exp(-t / 12000));
  out.panX = Math.cos(a) * prog * 1.8;
  out.panY = Math.sin(a) * prog * 1.8;
  return out;
}

// The square of the cover to draw (sx, sy, side) for that zoom and pan; always inside the image.
export function coverRect(nw, nh, zoom, panX, panY, out = {}) {
  const side = Math.min(nw, nh) / Math.max(1, zoom);
  out.side = side;
  out.sx = clamp(((nw - side) / 2) * (1 + clamp(panX, -1, 1)), 0, nw - side);
  out.sy = clamp(((nh - side) / 2) * (1 + clamp(panY, -1, 1)), 0, nh - side);
  return out;
}

// The optional flash: a short white fade as a card lands, on at most one line in four. It is drawn behind the caption.
export const isFlashLine = (li, seed) => li > 0 && (li + (seed % 4)) % 4 === 0;
export const flashAlpha = (sinceLanding) => (sinceLanding >= 0 && sinceLanding < FLASH_MS ? 0.85 * (1 - sinceLanding / FLASH_MS) : 0);
