// Small persisted settings, in localStorage. Spotify tokens in the desktop app
// go to Electron secure storage instead (auth.js).

const memory = new Map();

export const store = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? (memory.get(key) ?? null) : JSON.parse(v);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

const prefersReducedMotion = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const DEFAULTS = {
  source: 'auto', // 'auto' | 'spotify' | 'media-session'
  noLogin: false, // chose "Use without logging in": Automatic then follows this PC only
  mode: 'word', // 'word' | 'line'
  sceneWindow: 'constellation', // which scene each display mode shows (V cycles it); see scenes/index.js
  sceneFullscreen: 'constellation',
  sceneOverlay: 'karaoke',
  sceneRandom: false, // pick a different scene for every song
  theme: 'gold', // 'gold' | 'ice' | 'rose' | 'custom'
  customColor: '#f4c76b',
  albumColors: false, // tint each song's sky from its album art
  font: 'segoe', // a key of FONTS in theme.js
  glow: 25, // 0..100: the small glow on the star of the word being sung (and the soft light in some scenes)
  backgroundEffects: 0, // 0..100: nebula, drifting dust and shooting stars behind the lyrics. 0 = plain black
  spread: 100, // 0..100: how much of the screen each line's stars may use
  chaos: 50, // 0..100: extra criss-cross links and longer jumps between stars
  previewNext: true, // constellation: faint dots show where the next line's stars will appear
  backupLyrics: true, // ask the NetEase backup source when LRCLIB is down or has no timed lyrics (sends title and artist there)
  romanize: true, // Korean, Japanese kana, Russian and Greek lyrics also shown in Latin letters (offline)
  translate: false, // translated line from a free web service; off because it sends the lyric text there
  translateTo: 'en',
  beatPulse: false, // desktop app: stars and glow pulse to the beat of what the PC is playing (listens to system audio)
  emotion: true, // love, fire, night, rain and sun words get a small coloured glow (six scenes)
  songMap: true, // constellation: when the last line is done, every star fades together into one song map
  fullFrameRate: false, // draw on every refresh of a 120/144 Hz screen instead of about 60 times a second
  get reduceMotion() {
    return prefersReducedMotion(); // follows Windows "Animation effects" until set here
  },
  cornerInfo: 'off', // 'off' | 'title' | 'art'
};

export const settings = {
  get(key) {
    const all = store.get('ls.settings') || {};
    return key in all ? all[key] : DEFAULTS[key];
  },
  set(key, value) {
    const all = store.get('ls.settings') || {};
    all[key] = value;
    store.set('ls.settings', all);
  },
};
