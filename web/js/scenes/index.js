// The list of scenes and the rules for choosing one. A scene is { id, name, init(canvas, ctx), draw(frame), resize() }.
//
// draw(frame) gets one reused object, so scenes must not keep it:
//   ctx, w, h, dpr          the canvas context (already scaled to CSS pixels) and its size
//   pos                     current time in ms (lyrics clock, with display latency and offsets)
//   now                     wall time in ms, for effects that must keep moving while paused
//   lines, index            the whole timeline and the current line's index (-1 before the first line)
//   line, words             the current line and its timed words [{ text, start, end }] (null / [] when none)
//   prevLine, nextLine      the neighbouring lines, or null
//   theme, palette          colors for this song: theme.star/core/label are [r, g, b]; palette is the album colors or null
//   fontFamily              CSS font stack chosen in settings
//   displayMode             'window' | 'fullscreen' | 'overlay'
//   mode                    'word' | 'line' (M: word by word or line by line; the stack and kinetic scenes follow it too)
//   reduceMotion, playing, quiet
//   seed, spread, chaos     the sky's layout inputs (constellation)
//   previewNext, songMap    settings for the constellation: faint dots for the next line; the song map at the end
import { createConstellation } from './constellation.js';
import { createKaraoke } from './karaoke.js';
import { createStack } from './stack.js';
import { createKinetic } from './kinetic.js';

export const SCENES = [
  { id: 'constellation', name: 'Constellation', create: createConstellation },
  { id: 'karaoke', name: 'Karaoke', create: createKaraoke },
  { id: 'stack', name: 'Scrolling stack', create: createStack },
  { id: 'kinetic', name: 'Kinetic', create: createKinetic },
];

export const SCENE_IDS = SCENES.map((s) => s.id);
export const DISPLAY_MODES = ['window', 'fullscreen', 'overlay'];

// What each display mode shows until the user picks something else.
export const DEFAULT_SCENE = { window: 'constellation', fullscreen: 'constellation', overlay: 'karaoke' };

// The settings key that remembers the choice for a display mode.
export const sceneSettingKey = (displayMode) => `scene${displayMode[0].toUpperCase()}${displayMode.slice(1)}`;

export const sceneName = (id) => SCENES.find((s) => s.id === id)?.name ?? id;

export function createScene(id) {
  const entry = SCENES.find((s) => s.id === id) || SCENES[0];
  return entry.create();
}

// A saved id may be from a newer version or a removed scene: fall back to the mode's default.
export function validScene(id, displayMode) {
  return SCENE_IDS.includes(id) ? id : DEFAULT_SCENE[displayMode] || SCENE_IDS[0];
}

// The scene after `id` in the list, wrapping around.
export function nextScene(id) {
  const i = SCENE_IDS.indexOf(id);
  return SCENE_IDS[(i + 1) % SCENE_IDS.length];
}

// A different scene from the current one (when there is more than one). rand() gives 0..1.
export function randomScene(current, rand = Math.random) {
  const others = SCENE_IDS.filter((id) => id !== current);
  if (!others.length) return current;
  return others[Math.min(others.length - 1, Math.floor(rand() * others.length))];
}
