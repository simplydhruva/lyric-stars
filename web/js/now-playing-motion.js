// The maths behind the now-playing scene: how the cover floats, how the ring
// pulses, where the stars drift. Pure functions so they can be tested.
import { THEMES, forNightSky } from './theme.js';

export const FLOAT_PERIOD_S = 7; // one slow breath of the cover
export const RING_PERIOD_MS = 2000; // the ring pulses once per this much song

// Cover offset (px) and scale at time t seconds. `still` holds it at rest.
export function coverMotion(t, still) {
  if (still) return { dy: 0, scale: 1 };
  const wave = (Math.sin((t / FLOAT_PERIOD_S) * 2 * Math.PI) + 1) / 2; // 0..1
  return { dy: Math.sin((t / FLOAT_PERIOD_S) * 2 * Math.PI + 1) * -6, scale: 1 + 0.03 * wave };
}

// 0..1 position within the current pulse, tied to where the song is, so a seek
// or a pause moves the ring with it.
export function ringPhase(positionMs, periodMs = RING_PERIOD_MS) {
  const p = (positionMs % periodMs) / periodMs;
  return p < 0 ? p + 1 : p;
}

// Ring size and brightness for a phase: it swells outward and fades. `still` shows it at rest.
export function ringStyle(phase, still) {
  if (still) return { scale: 1.08, opacity: 0.18 };
  const ease = 1 - (1 - phase) ** 2;
  return { scale: 1.04 + 0.1 * ease, opacity: 0.4 * (1 - phase) ** 1.5 };
}

// Small seeded generator so the stars are the same for a given song.
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// n stars as orbits around the centre. Radii are fractions of the canvas half-size and
// start at `inner` so the stars stay outside the cover.
export function makeStars(seed, n = 14, inner = 0.62) {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    angle: r() * Math.PI * 2,
    radius: inner + r() * (0.98 - inner),
    speed: (0.012 + r() * 0.02) * (r() < 0.5 ? -1 : 1), // radians per second
    wobble: 0.01 + r() * 0.025,
    size: 1 + r() * 2.2,
    phase: r() * Math.PI * 2,
    twinkle: 0.3 + r() * 0.5, // Hz
    color: Math.floor(r() * 3),
  }));
}

// Where a star is, in -1..1 canvas units, and how bright (0..1) at motion time t seconds.
export function starAt(star, t, still) {
  const m = still ? 0 : t;
  const angle = star.angle + star.speed * m;
  const radius = star.radius + Math.sin(m * 0.4 + star.phase) * star.wobble;
  const glow = still ? 0.7 : 0.45 + 0.55 * ((Math.sin(m * star.twinkle * 2 * Math.PI + star.phase) + 1) / 2);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, glow };
}

// Up to three scene colours from an album palette, brightened for the black sky.
// With no palette (art failed to load, or none) the scene is gold.
export function sceneColors(palette) {
  const colors = (palette || []).slice(0, 3).map(forNightSky);
  if (!colors.length) colors.push(forNightSky(THEMES.gold.base));
  while (colors.length < 3) colors.push(colors[colors.length - 1]);
  return colors;
}
