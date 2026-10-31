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
  source: 'spotify', // 'spotify' | 'media-session'
  mode: 'word', // 'word' | 'line'
  theme: 'gold', // 'gold' | 'ice' | 'rose' | 'custom'
  customColor: '#f4c76b',
  albumColors: false, // tint each song's sky from its album art
  font: 'segoe', // a key of FONTS in theme.js
  backgroundStars: true,
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
