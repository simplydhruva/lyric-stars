// Lyric Stars desktop shell. Runs the same local server and page as the browser
// version and adds the three display styles, tray, global shortcuts, secure token
// storage, login through the system browser and an update check.
import { app, desktopCapturer, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, shell, dialog, session, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, isOurServer, stopProbe, DEFAULT_DATA_DIR, DEFAULT_PORT } from '../server.js';
import { UPDATE_REPO } from '../web/config.js';
import { normalizeState, placeWindow, fullscreenDisplay, MIN_SIZE, STYLES } from './layout.mjs';
import { SecretStore } from './secrets.mjs';
import { checkForUpdate } from './updates.mjs';

// Spotify's redirect address needs 5173; another port is only for testing.
const PORT = Number(process.env.LYRICSTARS_PORT) || DEFAULT_PORT;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(HERE, 'icons', 'icon.png');
const TRAY_ICON = path.join(HERE, 'icons', 'tray.png');
const DESKTOP_DIR = path.join(DEFAULT_DATA_DIR, 'desktop');
const STATE_FILE = path.join(DESKTOP_DIR, 'desktop.json');
const SHORTCUTS = { toggleShow: 'Control+Alt+L' };
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;
// Pages the shell may open in the user's browser; everything else is refused.
const EXTERNAL_OK = [/^https:\/\/accounts\.spotify\.com\//, /^https:\/\/developer\.spotify\.com\//, /^https:\/\/github\.com\//];

app.setPath('userData', DESKTOP_DIR); // Chromium profile next to the cache, not in a second folder
app.setAppUserModelId('com.lyricstars.app');

let state;
let win = null;
let tray = null;
let update = null; // { available, version, url } once checked
let quitting = false;
const secrets = new SecretStore(DESKTOP_DIR);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(boot);
}

// ---- state ---------------------------------------------------------------------

function loadState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return normalizeState(null);
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeState, 400);
}

function writeState() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(DESKTOP_DIR, { recursive: true });
    fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  } catch (e) {
    console.error('Could not save window state', e);
  }
}

function info() {
  return {
    style: state.style,
    version: app.getVersion(),
    openToTray: state.openToTray,
    startWithWindows: app.isPackaged && app.getLoginItemSettings().openAtLogin,
    canStartWithWindows: app.isPackaged,
    update,
    updatesEnabled: Boolean(UPDATE_REPO),
    secureTokens: secrets.secure,
    shortcuts: SHORTCUTS,
  };
}

function pushState() {
  win?.webContents.send('ls:state', info());
  buildTrayMenu();
}

// ---- boot ----------------------------------------------------------------------

async function boot() {
  state = loadState();
  try {
    await startServer({
      port: PORT,
      dataDir: DEFAULT_DATA_DIR,
      mediaHelper: app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'bin', 'lyricstars-media.exe') : undefined,
      probeScript: app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'tools', 'smtc-probe.ps1') : undefined,
      onLoginHandoff,
    });
  } catch (e) {
    const ours = e.code === 'EADDRINUSE' && (await isOurServer(PORT));
    dialog.showErrorBox(
      'Lyric Stars could not start',
      ours
        ? 'The browser version of Lyric Stars is already running (npm start). Stop it, then open the app again.'
        : e.code === 'EADDRINUSE'
          ? `Another program is using port ${PORT}, which Spotify login needs. Close it, then open Lyric Stars again.`
          : String(e.message || e)
    );
    app.exit(1);
    return;
  }

  // The page needs no device permissions; allow only copying diagnostics text.
  // Screen capture is allowed only for our own page, for the optional beat pulse below.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) =>
    cb(permission === 'clipboard-sanitized-write' || (permission === 'display-capture' && String(details?.requestingUrl || wc.getURL()).startsWith(ORIGIN)))
  );

  // The beat pulse (Settings, off by default) asks for the PC's audio output. Hand it the system audio and a screen
  // (the page drops the picture at once); only our own page, only on our origin.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, cb) => {
    try {
      if (!request.securityOrigin?.startsWith(ORIGIN)) return cb({});
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      cb(sources[0] ? { video: sources[0], audio: 'loopback' } : {});
    } catch {
      cb({});
    }
  });

  await secrets.load();
  registerIpc();
  createTray();
  registerShortcuts();
  // Opened to the tray: no window (and no polling or drawing) until first shown.
  if (!state.openToTray && !process.argv.includes('--hidden')) showWindow();
  scheduleUpdateCheck();
}

function startUrl() {
  // For testing: LYRICSTARS_START=/?demo opens the demo song.
  const p = process.env.LYRICSTARS_START;
  return ORIGIN + (p && p.startsWith('/') ? p : '/');
}

let tokensFlushed = false;
app.on('before-quit', (e) => {
  quitting = true;
  if (win && state.style !== 'fullscreen') rememberBounds(win);
  writeState();
  if (!tokensFlushed) {
    // Let a login that just finished reach the disk first.
    e.preventDefault();
    tokensFlushed = true;
    secrets.writing.finally(() => app.quit());
  }
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopProbe();
});
app.on('window-all-closed', () => app.quit());

// ---- windows -------------------------------------------------------------------

function displays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea, bounds: d.bounds, primary: d.id === primary }));
}

function createWindow(style, url, { replacing = null } = {}) {
  const bounds = placeWindow('window', state.window.bounds, displays());
  const w = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.window[0],
    minHeight: MIN_SIZE.window[1],
    show: false,
    title: 'Lyric Stars',
    icon: ICON,
    backgroundColor: '#000000',
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      additionalArguments: [`--ls-origin=${ORIGIN}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  w.setMenu(null);
  if (state.window.maximized) w.maximize();
  harden(w.webContents);

  // move/resize also fire for moves made by code and by Windows snapping.
  const remember = () => {
    if (w === win) rememberBounds(w);
  };
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize']) w.on(ev, remember);
  w.on('enter-full-screen', () => {
    state.fullscreen.displayId = screen.getDisplayMatching(w.getBounds()).id;
    saveState();
  });
  w.on('leave-full-screen', () => {
    // Left fullscreen some other way than our own toggle.
    if (w === win && state.style === 'fullscreen') {
      state.style = state.previousStyle;
      saveState();
      pushState();
    }
  });
  w.on('close', (e) => {
    // Closing the visible window quits; a window being replaced just goes.
    if (w === win && !quitting) {
      e.preventDefault();
      app.quit();
    }
  });

  w.once('ready-to-show', () => {
    w.show();
    if (style === 'fullscreen') enterFullscreen(w);
    if (replacing && !replacing.isDestroyed()) replacing.destroy();
  });
  w.loadURL(url);
  return w;
}

function rememberBounds(w, style = state.style) {
  if (w.isDestroyed() || w.isFullScreen() || w.isMinimized()) return;
  state.window.maximized = w.isMaximized();
  state.window.bounds = w.getNormalBounds();
  saveState();
}

function enterFullscreen(w) {
  const all = displays();
  const current = all.find((d) => d.id === screen.getDisplayMatching(w.getBounds()).id);
  const target = fullscreenDisplay(state.fullscreen.displayId, all, current);
  if (target && target.id !== current?.id) {
    // Move onto the remembered screen first; fullscreen uses the screen the window is on.
    const wa = target.workArea;
    w.setBounds({ x: wa.x + 40, y: wa.y + 40, width: Math.max(MIN_SIZE.window[0], Math.min(800, wa.width - 80)), height: Math.max(MIN_SIZE.window[1], Math.min(560, wa.height - 80)) });
  }
  w.setFullScreen(true);
}

function setStyle(style) {
  if (!STYLES.includes(style) || style === state.style) return;
  if (!win) {
    // Still in the tray: the window opens in this style.
    state.style = style;
    saveState();
    return showWindow();
  }
  const from = state.style;
  if (from !== 'fullscreen') rememberBounds(win, from);
  if (from !== 'fullscreen') state.previousStyle = from;
  state.style = style;
  saveState();
  if (style === 'fullscreen') enterFullscreen(win);
  else win.setFullScreen(false);
  pushState();
}

function toggleFullscreen() {
  setStyle(state.style === 'fullscreen' ? state.previousStyle : 'fullscreen');
}

function showWindow() {
  if (!win) {
    win = createWindow(state.style, startUrl());
    return buildTrayMenu();
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (state.style === 'fullscreen' && !win.isFullScreen()) enterFullscreen(win);
}

function toggleShow() {
  if (win?.isVisible() && !win.isMinimized()) win.hide();
  else showWindow();
  buildTrayMenu();
}

// ---- security ------------------------------------------------------------------

function openExternal(url) {
  if (EXTERNAL_OK.some((re) => re.test(url))) shell.openExternal(url);
}

function harden(wc) {
  // The window only ever shows our own page; links elsewhere open in the browser.
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) {
      e.preventDefault();
      openExternal(url);
    }
  });
  wc.on('will-redirect', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) e.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

function fromOurPage(e) {
  return e.senderFrame?.url?.startsWith(ORIGIN + '/') && e.sender === win?.webContents;
}

// ---- IPC -----------------------------------------------------------------------

function registerIpc() {
  const on = (channel, fn) =>
    ipcMain.on(channel, (e, ...args) => {
      if (!fromOurPage(e)) {
        e.returnValue = null;
        return;
      }
      fn(e, ...args);
    });

  on('ls:info', (e) => (e.returnValue = info()));
  on('ls:tokens-get', (e) => (e.returnValue = secrets.get()));
  on('ls:tokens-set', (_e, json) => secrets.set(typeof json === 'string' ? json : null));
  on('ls:style', (_e, style) => setStyle(style));
  on('ls:toggle-fullscreen', () => toggleFullscreen());
  on('ls:option', (_e, key, value) => setOption(key, value));
  on('ls:open-release', () => update?.url && openExternal(update.url));
  on('ls:open-login', (_e, url) => {
    if (typeof url === 'string' && url.startsWith('https://accounts.spotify.com/authorize?')) shell.openExternal(url);
  });
  ipcMain.handle('ls:check-updates', (e) => (fromOurPage(e) ? runUpdateCheck() : null));
}

function setOption(key, value) {
  if (key === 'openToTray') state.openToTray = value === true;
  else if (key === 'startWithWindows' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: value === true });
  else return;
  saveState();
  pushState();
}

// The browser tab Spotify redirected to hands the login code over to us.
function onLoginHandoff(params) {
  if (!win) return false;
  win.webContents.send('ls:login', params);
  showWindow();
  return true;
}

// ---- tray and shortcuts --------------------------------------------------------

function createTray() {
  const image = nativeImage.createFromPath(TRAY_ICON);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Lyric Stars');
  tray.on('click', toggleShow);
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  const visible = win?.isVisible() && !win.isMinimized();
  const style = (s, label) => ({ label, type: 'radio', checked: state.style === s, click: () => (setStyle(s), showWindow()) });
  const items = [
    { label: visible ? 'Hide' : 'Show', accelerator: SHORTCUTS.toggleShow, click: toggleShow },
    { type: 'separator' },
    style('window', 'Window'),
    style('fullscreen', 'Fullscreen'),
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
      click: (item) => setOption('startWithWindows', item.checked),
    },
    { label: 'Open to tray at startup', type: 'checkbox', checked: state.openToTray, click: (item) => setOption('openToTray', item.checked) },
  ];
  if (update?.available) items.push({ type: 'separator' }, { label: `Download version ${update.version}…`, click: () => openExternal(update.url) });
  else if (UPDATE_REPO) items.push({ label: 'Check for updates', click: () => runUpdateCheck() });
  items.push({ type: 'separator' }, { label: 'Quit Lyric Stars', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function registerShortcuts() {
  const ok = (accel, fn) => {
    try {
      if (!globalShortcut.register(accel, fn)) console.warn(`Shortcut ${accel} is taken by another app`);
    } catch (e) {
      console.warn(`Shortcut ${accel} failed`, e);
    }
  };
  ok(SHORTCUTS.toggleShow, toggleShow);
}

// ---- updates -------------------------------------------------------------------

async function runUpdateCheck() {
  try {
    const result = await checkForUpdate({ repo: UPDATE_REPO, currentVersion: app.getVersion() });
    if (!result.disabled) update = { ...result, checkedAt: Date.now() };
  } catch (e) {
    update = { available: false, error: String(e.message || e), checkedAt: Date.now() };
  }
  pushState();
  return update;
}

function scheduleUpdateCheck() {
  if (!UPDATE_REPO) return;
  setTimeout(runUpdateCheck, 15_000); // after startup settles
  setInterval(runUpdateCheck, UPDATE_EVERY_MS);
}
