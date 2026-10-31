# Lyric Stars

Spotify lyrics as a constellation. See `Lyric Stars Product Requirements Document.md` for the plan.

**Platform:** the desktop app and the "This PC" source (Windows media session) are Windows 10/11 only.
On macOS or Linux, only the browser version with the Spotify source works; the media-session endpoint returns 501 there.

## Run (browser version)

Requires Node 20+. The browser version needs no dependencies.

```
npm start      # serves http://127.0.0.1:5173/
npm test       # unit tests, plus the timing regression check against test/reference
npm run harness  # timing report for the reference songs (add -- --update-baseline to accept)
```

Open http://127.0.0.1:5173/ (localhost redirects there, because Spotify only accepts loopback IPs).

- **Keys:** `S` settings, `F` fullscreen, `O` overlay (desktop app), `M` word/line mode, `D` diagnostics, `E` sync editor, `Esc` closes panels,
  `[` / `]` lyrics earlier / later for this song (50 ms; hold Shift for 10 ms).
- **Demo without Spotify:** http://127.0.0.1:5173/?demo&start=30 plays Coldplay "Yellow" with no audio.
  `P` pauses, arrow keys seek 10 s. Other songs: `?demo&title=...&artist=...&album=...&duration=<seconds>`.
  Add `&art=https://i.scdn.co/image/...` to try album colors.
- **Lyric cache:** `%APPDATA%\LyricStars\cache` (override with `LYRICSTARS_DATA`). Your timings live in
  `%APPDATA%\LyricStars\timings` and are not removed when the cache is cleared.

## Desktop app

Friends: see [docs/INSTALL.md](docs/INSTALL.md) and [docs/FRIEND-TEST.md](docs/FRIEND-TEST.md). Releasing: [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md).

```
npm install      # Electron and electron-builder (dev only)
npm run desktop  # run the desktop app from source
npm run dist     # build dist/Lyric-Stars-Setup-<version>.exe (no Node needed to run it)
npm run icons    # redraw electron/icons/*.png
npm run helper   # rebuild native/bin/lyricstars-media.exe (desktop and dist do this when needed)
```

- The same page, served by the same local server on 127.0.0.1:5173, inside Electron. The page gets no Node access, only a
  small `window.lyricStars` bridge. Navigation is locked to that origin; only Spotify, the Spotify developer site and GitHub open in the browser.
- **Styles:** window, fullscreen (`F`) and overlay (`O`): always on top, see-through, with opacity, background dim and
  click-through. Each style remembers its own size, place and monitor in `%APPDATA%\LyricStars\desktop\desktop.json`.
- **Shortcuts (any app):** `Ctrl+Alt+L` show or hide, `Ctrl+Alt+K` click-through. Tray: show, styles, click-through,
  start with Windows, open to tray (no window or drawing until shown), update check, quit. Closing the window quits.
- **Login:** opens the system browser. That tab hands the code back to the app via `POST /api/login-handoff`; the PKCE verifier never
  leaves the app. Tokens are encrypted with Electron safeStorage (DPAPI) in `desktop\tokens.bin`.
- **Updates:** set `UPDATE_REPO` in `web/config.js`. The app then reads the latest GitHub release once a day and links to it. It never downloads code.
- **Testing overrides:** `LYRICSTARS_PORT`, `LYRICSTARS_DATA`, `LYRICSTARS_START` (start path, e.g. `/?demo&start=30`).

## Sources

Settings → **Lyrics from**:

- **Automatic** (default): the Spotify app on this PC when it plays (read locally: no login, no API limits, the most
  accurate position), your Spotify account when music plays elsewhere (phone, speaker), and any other player on this PC
  as a last resort. A better source takes over after it has played for 1.5 s; within one song the lyrics stay loaded.
  Without a login (first-run **Use without logging in**, also offered when Spotify says the account is not on the user list)
  it follows this PC only.
- **Spotify account:** the Web API, any device.
- **This PC only:** the Windows media session. Spotify first; otherwise the playing browser tab or app. Video titles are tidied
  ("Coldplay - Yellow (Official Video)" by "ColdplayVEVO" → Yellow · Coldplay) and the usual match rules still apply.
  A paused browser tab is ignored unless it was just playing.

The media session is read by `native/media-helper.cs`, compiled with the C# compiler built into Windows
(.NET Framework 4, no SDK) into a 9 KB exe that prints one JSON line per tick and exits when its stdin closes. It is
optional: without it the server falls back to `tools/smtc-probe.ps1` (slower to start, same output).
Diagnostics (`D`) shows which source and player are in use.

## Now playing and player controls

- **No lyrics:** when lyrics aren't found, or the song is instrumental, a now-playing scene replaces the empty screen:
  the album cover (largest size Spotify offers) floats and breathes in a glow, a ring pulses with the song position, and
  a few stars drift around it. The glow and stars take two or three colors from the cover (gold if there is no cover or
  it fails to load). Pausing freezes the drift and dims the glow; with reduce motion on the scene stands still.
  **Retry** searches again. Following only this PC (no login) the Windows app reports no cover, so the scene borrows the
  account's cover when you're logged in and it is the same song.
- **Player bar** (bottom centre, fades after 3 s without mouse movement): previous, play/pause, next, and a progress bar you
  can click to seek. Shortcuts: `Space` play/pause, `←` previous, `→` next (`Space` still taps in the sync editor and
  the diagnostics tap test while those are open). It needs the Spotify account, not the PC-only source, and in the
  transparent overlay it only shows while the mouse is over it.
- **Permission:** controls use the `user-modify-playback-state` scope. A login saved before this feature lacks it, so the first
  press sends you through the Spotify login once more. Spotify only allows playback control for Premium accounts and when a
  device is active; if it refuses, the reason shows above the bar and the press is undone.

## Timing

- Real word times win: enhanced LRC `<mm:ss.xx>` word tags, or your own taps. Otherwise words are
  estimated from syllables (CMU dictionary exceptions, then a vowel-group rule) with a breath before each line.
- The corner chip says which: `word-timed`, `your timing` or `estimated`.
- Drawn position = playback position + display latency (measured from the refresh rate) + global offset + song offset.
  Positive offsets show lyrics earlier. Use the global offset for Bluetooth or speaker delay (Sync editor, Global −/+).
- **Sync editor (`E`):** tap `Space` on each word as you hear it; a line is saved once all its words are tapped.
  `Backspace` undoes. Drag word blocks on the strip to nudge them. Import an `.lrc` (plain or enhanced) or a
  timings `.json` to use your own lyrics or times; export either format.
- **Reference set:** for a fully tapped song, use Export timings and copy the `.json` into `test/reference/`.
  `npm run harness` scores the estimator against every file there. After `npm run harness -- --update-baseline`,
  `npm test` fails if the average error gets worse by more than 5 ms.
- Rebuild the syllable table with `node tools/build-syllables.mjs path/to/cmudict.dict`.

## Look

- **Settings (`S`):** lyric source, word/line mode, theme (Gold, Ice, Rose or a custom color), album colors,
  font (system fonts only), background stars, reduce motion, corner title/art, global offset, lyric cache, disconnect.
- **Album colors** (off by default): two or three colors are read from the 64 px cover; grey or
  black-and-white covers fall back to the chosen theme. Colors are lifted so they always glow on black.
- **Background:** a faint nebula in the theme colors and two layers of dust stars drifting at different speeds.
  While paused it repaints at about 20 fps; with reduce motion on (default follows Windows "Animation effects")
  nothing moves and a paused sky does not repaint at all.
- **Performance:** Diagnostics (`D`) → Rendering shows paints per second, paint cost and late frames.

## Layout

```
server.js                 local server: static files, disk cache API, media-session helper, login hand-off
electron/main.mjs         desktop shell: windows and styles, tray, shortcuts, IPC, navigation lock
electron/layout.mjs       saved state and on-screen placement per style (pure, tested)
electron/secrets.mjs      encrypted token store
electron/updates.mjs      GitHub release check (pure, tested)
electron/preload.cjs      the window.lyricStars bridge
docs/INSTALL.md           friend install guide (SmartScreen, keys, releasing)
docs/FRIEND-TEST.md       what friends try, and how to send a report
docs/RELEASE-CHECKLIST.md everything to check before a release
web/js/report.js          Diagnostics → Copy report (local only, credentials removed)
native/media-helper.cs    Windows media-session helper (npm run helper → native/bin/, not committed)
tools/smtc-probe.ps1      PowerShell fallback for the helper
web/config.js             BUILT_IN_CLIENT_ID and UPDATE_REPO for friend builds
web/js/auth.js            Spotify PKCE login and silent refresh
web/js/sources/           auto.js (Automatic), spotify.js, mediaSession.js, players.js (player names, title tidying),
                          demo.js, clock.js (position smoothing)
web/js/lyrics/            lrc.js (parser), match.js (no-wrong-lyrics rules), lrclib.js (provider)
web/js/cache.js           lyric cache client (found: kept; not found: 1 day)
web/js/timing.js          word timing: real tags or taps, else syllable estimate
web/js/syllables.js       syllable counts; data/syllable-exceptions.js is generated from CMUdict
web/js/sync.js            per-song and global offsets, display latency
web/js/corrections.js     your timings: merge, import, export (also the reference-song format)
web/js/editor.js          tap-to-sync editor
web/js/harness.js         scores the estimator; tools/harness.mjs runs it on test/reference
web/js/renderer.js        canvas constellation
web/js/background.js      nebula, drifting and twinkling background stars
web/js/theme.js           themes, fonts, album palette extraction (palette.js loads the image)
web/js/settings-panel.js  settings panel
web/js/perf.js            paint statistics for diagnostics
web/js/states.js          every state's message and fix button
web/js/spike.js           diagnostics: endpoint check, source comparison, tap test
```
