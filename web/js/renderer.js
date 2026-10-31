// The renderer owns the canvas: sizing for high-DPI screens, the background and idle-frame skipping.
// The lyrics themselves are drawn by the active scene (see scenes/index.js), which gets one frame
// object per paint. Everything drawn is a pure function of the playback position, so seeking,
// pausing and resuming never leave stale animation behind.
import { lineIndexAt } from './lyrics/lrc.js';
import { Background } from './background.js';
import { makeTheme, THEMES, fontCss } from './theme.js';
import { createScene, SCENE_IDS } from './scenes/index.js';
import { drawFlash, flashing } from './sync-flash.js';
import { setArtListener } from './scenes/art.js';
import { NebulaGlow } from './nebula.js';
import { drawShootingStars, streaksAt } from './shooting-stars.js';

const IDLE_FRAME_MS = 50; // when only the background moves, 20 frames a second is plenty

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = makeTheme(THEMES.gold.base);
    this.fontFamily = fontCss('segoe');
    this.background = new Background();
    this.nebula = new NebulaGlow();
    this.opts = { reduceMotion: false, backgroundStars: true, transparent: false, palette: null };
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

  // theme: from theme.js; font: a FONTS key; transparent: for the overlay (no black, no background);
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
    const { reduceMotion, backgroundStars, transparent } = this.opts;
    const sky = backgroundStars && !transparent;
    this.sceneId = SCENE_IDS.includes(scene) ? scene : SCENE_IDS[0];
    const flashOn = flashing(now, this.flashState?.at);
    const frameKey = `${flashOn ? 'f' + Math.round(now) : ''}|${Math.round(pos)}|${mode}|${quiet}|${this.sceneId}|${displayMode}|${w}x${h}@${dpr}`;
    if (!resized && !playing && frameKey === this.lastFrameKey) {
      const moving = sky && this.background.animating(now, reduceMotion);
      if (!moving || now - this.lastDrawAt < IDLE_FRAME_MS) return false;
    }
    this.lastFrameKey = frameKey;
    this.lastDrawAt = now;

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (transparent) ctx.clearRect(0, 0, w, h);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
    // Paper is a cream sheet: the sky effects would only be wasted work behind it.
    const skyFx = sky && this.sceneId !== 'paper';
    if (skyFx && this.opts.nebula !== false && w && h) {
      this.nebula.prepare(this.theme, now);
      this.nebula.draw(ctx, w, h, now, reduceMotion);
    }
    if (sky && w && h) {
      this.background.prepare(w, h, dpr, this.theme, now);
      this.background.draw(ctx, w, h, now, reduceMotion);
    }
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
    // Shooting stars cross the sky between lines, behind the lyrics. Never with reduce motion.
    if (skyFx && !reduceMotion && index >= 0 && this.opts.shootingStars !== false) {
      drawShootingStars(ctx, streaksAt(lines, index, pos, w, h), this.theme, quiet);
    }
    this._scene(this.sceneId).draw(f);
    if (flashOn) drawFlash(ctx, w, h, now, this.flashState, this.theme.star, reduceMotion);
    return true;
  }
}
