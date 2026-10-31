// Window placement rules, kept free of Electron so they can be tested in node.

export const STYLES = ['window', 'fullscreen', 'overlay', 'mini'];

export const DEFAULT_STATE = {
  style: 'window',
  previousStyle: 'window', // where F returns to from fullscreen
  window: { bounds: null, maximized: false },
  fullscreen: { displayId: null },
  overlay: { bounds: null, opacity: 1, backdrop: 0.35, clickThrough: false },
  mini: { bounds: null }, // the small corner widget
  openToTray: false,
};

const SIZES = {
  window: { width: 1100, height: 680, minWidth: 360, minHeight: 240 },
  overlay: { width: 760, height: 260, minWidth: 260, minHeight: 120 },
  mini: { width: 420, height: 112, minWidth: 260, minHeight: 80 },
};
export const MIN_SIZE = { window: [SIZES.window.minWidth, SIZES.window.minHeight], overlay: [SIZES.overlay.minWidth, SIZES.overlay.minHeight], mini: [SIZES.mini.minWidth, SIZES.mini.minHeight] };

// Merges a saved state file over the defaults, dropping anything malformed.
export function normalizeState(saved) {
  const s = structuredClone(DEFAULT_STATE);
  if (!saved || typeof saved !== 'object') return s;
  if (STYLES.includes(saved.style)) s.style = saved.style;
  if (STYLES.includes(saved.previousStyle) && saved.previousStyle !== 'fullscreen') s.previousStyle = saved.previousStyle;
  if (isRect(saved.window?.bounds)) s.window.bounds = saved.window.bounds;
  s.window.maximized = saved.window?.maximized === true;
  if (Number.isFinite(saved.fullscreen?.displayId)) s.fullscreen.displayId = saved.fullscreen.displayId;
  const o = saved.overlay || {};
  if (isRect(o.bounds)) s.overlay.bounds = o.bounds;
  if (Number.isFinite(o.opacity)) s.overlay.opacity = clamp(o.opacity, 0.3, 1);
  if (Number.isFinite(o.backdrop)) s.overlay.backdrop = clamp(o.backdrop, 0, 0.85);
  s.overlay.clickThrough = o.clickThrough === true;
  if (isRect(saved.mini?.bounds)) s.mini.bounds = saved.mini.bounds;
  s.openToTray = saved.openToTray === true;
  return s;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function isRect(r) {
  return r && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) && r.width > 0 && r.height > 0;
}

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// Where a window of this kind should open. Saved bounds are kept only if enough
// of the window is still on a connected screen (monitors get unplugged); they
// are shrunk to fit that screen's work area. Otherwise it opens centered on the
// primary screen (overlay: near the bottom, where subtitles usually sit).
// displays: [{ id, workArea: {x,y,width,height}, primary? }]
export function placeWindow(kind, saved, displays) {
  const size = SIZES[kind];
  const primary = displays.find((d) => d.primary) || displays[0];
  if (isRect(saved)) {
    let best = null;
    let bestArea = 0;
    for (const d of displays) {
      const a = overlap(saved, d.workArea);
      if (a > bestArea) [best, bestArea] = [d, a];
    }
    // At least a third of the window (and 100 x 50 px) must be visible to trust it.
    if (best && bestArea >= Math.max(saved.width * saved.height / 3, 5000)) return fitInto(saved, best.workArea, size);
  }
  const wa = primary.workArea;
  const width = Math.min(size.width, wa.width);
  const height = Math.min(size.height, wa.height);
  const x = Math.round(wa.x + (wa.width - width) / 2);
  if (kind === 'mini') return { x: wa.x + wa.width - width - 24, y: wa.y + wa.height - height - 24, width, height }; // bottom right corner
  const y = kind === 'overlay' ? Math.round(wa.y + wa.height - height - wa.height * 0.08) : Math.round(wa.y + (wa.height - height) / 2);
  return { x, y, width, height };
}

function fitInto(r, wa, size) {
  const width = clamp(Math.round(r.width), Math.min(size.minWidth, wa.width), wa.width);
  const height = clamp(Math.round(r.height), Math.min(size.minHeight, wa.height), wa.height);
  return {
    x: clamp(Math.round(r.x), wa.x, wa.x + wa.width - width),
    y: clamp(Math.round(r.y), wa.y, wa.y + wa.height - height),
    width,
    height,
  };
}

// The screen fullscreen should use: the remembered one if still connected,
// else the one the window is on now.
export function fullscreenDisplay(displayId, displays, current) {
  return displays.find((d) => d.id === displayId) || current || displays.find((d) => d.primary) || displays[0];
}
