// The renderer owns the canvas: sizing for high-DPI screens, the background and idle-frame skipping.
// The lyrics themselves are drawn by the active scene (see scenes/index.js), which gets one frame
// object per paint. Everything drawn is a pure function of the playback position, so seeking,
// pausing and resuming never leave stale animation behind.
import { lineIndexAt } from './lyrics/lrc.js';
import { Sky, SKY_MODES, DEFAULT_SKY } from './sky.js';
import { makeTheme, THEMES, fontCss } from './theme.js';
import { createScene, SCENE_IDS } from './scenes/index.js';
import { drawFlash, flashing } from './sync-flash.js';
import { setArtListener } from './scenes/art.js';

const IDLE_FRAME_MS = 50; // when only the background moves, 20 frames a second is plenty

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = makeTheme(THEMES.gold.base);
    this.fontFamily = fontCss('segoe');
    this.sky = new Sky();
    this.beat = null; // () => 0..1, the beat pulse (audio-beat.js), or null
    this.opts = { reduceMotion: false, sky: DEFAULT_SKY, glow: 25, palette: null };
    this.lastDrawAt = 0;
    this.timeline = null;
    this.seed = '';
    this.spread = 100;
    this.chaos = 50;
    this.size = { w: 0, h: 0, dpr: 0 };
    this.lastFrameKey = '';
    this.scenes = new Map(); // id -> scene, created the first time it is shown
    this.sceneId = SCENE_IDS[0];
    this.frame = {}; // reused for every paint
    // a cover that finishes loading while paused must repaint
    setArtListener(() => {
      this.lastFrameKey = '';
    });
  }

  // theme: from theme.js; font: a FONTS key;
  // spread, chaos: 0..100; palette: the album colors, or null.
  configure({ theme, font, spread, chaos, ...opts }) {
    if (spread != null && chaos != null) {
      this.spread = Number(spread);
      this.chaos = Number(chaos);
    }
    if (theme) this.theme = theme;
    if (font) this.fontFamily = fontCss(font);
    Object.assign(this.opts, opts);
    this.lastFrameKey = '';
  }

  setBeat(fn) {
    this.beat = fn;
  }

  // seed: track and play, so each play of a song gets its own sky.
  setTimeline(timeline, seed = '') {
    this.timeline = timeline;
    this.seed = seed;
    this.lastFrameKey = '';
  }

  _scene(id) {
    let scene = this.scenes.get(id);
    if (!scene) {
      scene = createScene(id);
      scene.init(this.canvas, this.ctx);
      this.scenes.set(id, scene);
    }
    return scene;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return false;
    this.size = { w, h, dpr };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    for (const scene of this.scenes.values()) scene.resize();
    return true;
  }

  // Shows the sync flash (see sync-flash.js). dir: +1 lyrics now earlier, -1 later, 0 reset.
  flash(dir, now = performance.now()) {
    this.flashState = { at: now, dir };
  }

  // Returns false when nothing changed and the frame was skipped.
  draw(pos, { mode = 'word', playing = true, quiet = false, now = performance.now(), scene = this.sceneId, displayMode = 'window' } = {}) {
    const resized = this._resize();
    const { w, h, dpr } = this.size;
    const { reduceMotion } = this.opts;
    // The shared sky (Settings → Sky): off, stars, or stars and comets, on pure black. Paper is a cream sheet and has none.
    const skyMode = SKY_MODES.includes(this.opts.sky) ? this.opts.sky : DEFAULT_SKY;
    this.sceneId = SCENE_IDS.includes(scene) ? scene : SCENE_IDS[0];
    const flashOn = flashing(now, this.flashState?.at);
    const frameKey = `${flashOn ? 'f' + Math.round(now) : ''}|${Math.round(pos)}|${mode}|${quiet}|${this.sceneId}|${displayMode}|${w}x${h}@${dpr}`;
    const skyOn = skyMode !== 'off' && scene !== 'paper';
    if (!resized && !playing && frameKey === this.lastFrameKey) {
      const moving = skyOn && this.sky.animating(skyMode);
      if (!moving || now - this.lastDrawAt < IDLE_FRAME_MS) return false;
    }
    this.lastFrameKey = frameKey;
    this.lastDrawAt = now;

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    // The beat pulse: only while it is on and something is playing. Lyrics never move with it; the scenes' stars swell.
    const beat = this.beat && this.opts.beatPulse && !reduceMotion && playing && this.sceneId !== 'paper' ? this.beat(now) : 0;
    if (skyOn) this.sky.draw(ctx, w, h, dpr, now, { mode: skyMode, reduceMotion, quiet });
    const lines = this.timeline;
    if (!lines || !lines.length || !w || !h) return true;

    const index = lineIndexAt(lines, pos);
    const f = this.frame;
    f.ctx = ctx;
    f.w = w;
    f.h = h;
    f.dpr = dpr;
    f.pos = pos;
    f.now = now;
    f.lines = lines;
    f.index = index;
    f.line = index >= 0 ? lines[index] : null;
    f.words = f.line ? f.line.words : [];
    f.prevLine = lines[index - 1] || null;
    f.nextLine = lines[index + 1] || null;
    f.theme = this.theme;
    f.palette = this.opts.palette;
    f.art = this.opts.art || null;
    f.fontFamily = this.fontFamily;
    f.displayMode = displayMode;
    f.mode = mode;
    f.reduceMotion = reduceMotion;
    f.playing = playing;
    f.quiet = quiet;
    f.seed = this.seed;
    f.spread = this.spread;
    f.chaos = this.chaos;
    f.previewNext = this.opts.previewNext !== false;
    f.songMap = this.opts.songMap !== false;
    f.emotion = this.opts.emotion !== false;
    f.emojis = this.opts.emojis !== false;
    f.film = this.opts.filmLook !== false;
    f.polaroidFlash = this.opts.polaroidFlash === true;
    f.beat = beat;
    f.glow = Math.max(0, Math.min(1, (this.opts.glow ?? 25) / 100));
    this._scene(this.sceneId).draw(f);
    if (flashOn) drawFlash(ctx, w, h, now, this.flashState, this.theme.star, reduceMotion);
    return true;
  }
}
