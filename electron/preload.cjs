// Bridge between the page and the desktop shell. Exposed only to our own local
// page; the main process also checks the sender of every message.
const { contextBridge, ipcRenderer } = require('electron');

// The shell passes the page's origin (http://127.0.0.1:5173).
const ORIGIN = (process.argv.find((a) => a.startsWith('--ls-origin=')) || '').slice(12);

if (ORIGIN && location.origin === ORIGIN) {
  let tokens = ipcRenderer.sendSync('ls:tokens-get'); // JSON string or null
  const listen = (channel) => (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };

  contextBridge.exposeInMainWorld('lyricStars', {
    // { style, version, overlay, openToTray, startWithWindows, canStartWithWindows, update, secureTokens }
    info: () => ipcRenderer.sendSync('ls:info'),
    tokens: {
      get: () => tokens,
      set: (json) => {
        tokens = json ?? null;
        ipcRenderer.send('ls:tokens-set', tokens);
      },
    },
    setStyle: (style) => ipcRenderer.send('ls:style', style),
    toggleFullscreen: () => ipcRenderer.send('ls:toggle-fullscreen'),
    toggleOverlay: () => ipcRenderer.send('ls:toggle-overlay'),
    toggleMini: () => ipcRenderer.send('ls:toggle-mini'),
    setOverlay: (opts) => ipcRenderer.send('ls:overlay', opts),
    setOption: (key, value) => ipcRenderer.send('ls:option', key, value),
    checkForUpdates: () => ipcRenderer.invoke('ls:check-updates'),
    openRelease: () => ipcRenderer.send('ls:open-release'),
    openLogin: (url) => ipcRenderer.send('ls:open-login', url),
    onState: listen('ls:state'),
    onLogin: listen('ls:login'),
  });
}
