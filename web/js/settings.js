// Small persisted settings. Stored in localStorage for now; the desktop
// shell moves tokens to secure storage in milestone 4.

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

const DEFAULTS = {
  source: 'spotify', // 'spotify' | 'media-session'
  mode: 'word', // 'word' | 'line'
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
