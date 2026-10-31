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

- **Keys:** `S` settings, `F` fullscreen, `O` overlay (desktop app), `M` word/line mode, `V` switches scene, `D` diagnostics, `E` sync editor, `Esc` closes panels,
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
- **Mini widget (`N`, the Mini button, or the tray):** a small always-on-top corner window with the cover and one line of lyrics (Karaoke). It reuses the overlay's opacity, dim and click-through, and drags from anywhere. `N` again returns to the window.
- **Styles:** window, fullscreen (`F`), overlay (`O`) and mini (`N`): always on top, see-through, with opacity, background dim and
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
  **Retry** searches again. The cover is the 640 px image from `album.images` (64 px for thumbnails), preloaded when the
  song starts and kept per track. The Windows app reports no cover, so when you're logged in the song is looked up on
  Spotify by title and artist (or the account's own report of it is used); with no match, or no login, a gold star stands in.
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
- **Sync flash:** when the lyrics feel late, press `[` (they show 50 ms earlier for this song; `Shift+[` is 10 ms); when they feel
  early, press `]`. A ring of light and a note confirm each nudge, and Backslash resets the song. Saved per song.
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

- **Scenes (`V`):** *Constellation* (the stars), *Karaoke*, *Scrolling stack* and *Kinetic*. Karaoke is centered lines, a gold fill sweeping across each word between
  its start and end, the previous and next lines faint above and below. The stack keeps the current line big in the middle with two
  lines above and three below, gliding up on each new line; `M` switches it (and Kinetic) between word-by-word fill and the whole line lit.
  Kinetic slams each word in exactly when it is sung: the loudest word of a line is the biggest (a guess from word length and how long it
  is held, since there is no audio), and lines that repeat in the song (the chorus) are drawn bigger. Your pick is remembered separately for window,
  fullscreen and overlay; the overlay starts on Karaoke. Settings has a "Random scene each song" option; with it on, `V`
  changes only the current song. Scenes are pure functions of the playback position, so seek and pause never leave stale animation.
  Ten more: *Handwriting* (a pen writes each word, a reveal rather than true strokes), *Rain* (words fall and land), *Lanterns* (words rise on glowing paper
  lanterns), *Neon*, *Typewriter*, *Ribbon* (words ride a wave; its liveliness comes from line pace and chorus, not audio), *Orbit* (words circle the album cover),
  *Polaroid* (a photo card per line), *Terminal* and *Paper* (a light cream sheet). Orbit and Polaroid use the album cover, with a glowing disc or a
  palette wash when there is none.
- **Settings (`S`):** lyric source, word/line mode, theme (Gold, Ice, Rose, Sunset or a custom color), album colors,
  font (system fonts only), background stars, reduce motion, corner title/art, global offset, lyric cache, disconnect.
- **Album colors** (off by default): two or three colors are read from the 64 px cover; grey or
  black-and-white covers fall back to the chosen theme. Colors are lifted so they always glow on black.
- **Background:** a faint nebula in the theme colors, two layers of dust stars drifting at different speeds, and (Settings, on by default) a slowly drifting nebula glow in the theme or album colors. Off in Paper and the transparent overlay.
- **Shooting stars:** a dim streak crosses the sky in the gap after a line ends (gaps of 0.4 s or more). Off with reduce motion, in the overlay and in Paper.
- **Emotion words:** English words about fire, night, love, water and sun get a small coloured glow in Constellation, Karaoke, Kinetic, Stack, Neon and Lanterns. Other languages get no glow. Each of these three can be switched off in Settings.
  While paused it repaints at about 20 fps; with reduce motion on (default follows Windows "Animation effects")
  nothing moves and a paused sky does not repaint at all.
- **Romanized and translated lyrics (Settings → Lyric text):** a small caption under the lyrics shows the current line in Latin letters for Korean, Japanese kana, Russian and Greek (built in, offline, on by default). Kanji and Chinese characters, Hindi, Arabic and Thai are not romanized. An optional translation (off by default) looks each song up once at the free MyMemory service (api.mymemory.translated.net, no key) and keeps it on disk; **this sends the lyric text to that service**, and if it is slow, limited or down the lyrics simply show without it. The caption is a line under the lyrics, not under each word, and is hidden in the mini widget.
- **Beat pulse (desktop app, Settings, off by default):** the glow swells from the middle of the sky on each beat and the Constellation stars swell with it. Lyrics never move with it, so word timing is untouched. It listens to the sound your PC is playing (Windows system audio output, through Electron; no extra program or key), keeps only a loudness-change number every 10 ms, and records and sends nothing. Windows may show a screen-capture indicator while it is on, because that is how Windows shares its audio. It finds a steady tempo of 60 to 180 BPM from the last 8 seconds, so it needs a few seconds after a song starts, may read a fast song at half speed (every second beat), and shows nothing when the music has no steady beat (ambient, free tempo) or when nothing is playing. Settings shows "Beat found: about N BPM". Off with reduce motion, in Paper, and in the overlay's transparent sky. `npm run check:beat` plays a drum loop through your speakers for about 20 seconds and checks the app finds its tempo.
- **Save a picture or clip:** `X` (or the Picture button) saves the sky as a PNG; `R` (Clip) records the next 10 seconds as a WebM video. Only the sky is saved, not the buttons. Nothing leaves your PC.
- **History (`H`):** the songs you played, newest first, each with a small picture of its constellation and how many times it was played (a song counts after 8 seconds with lyrics). Kept on this PC (up to 80); "Clear history" empties it.
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
web/js/renderer.js        canvas host: sizing, background, idle-frame skipping, hands lyrics to the active scene
web/js/scenes/            index.js (registry, frame object), constellation.js, karaoke.js, stack.js, kinetic.js, the ten newer scenes (handwriting.js ... paper.js),
                          motion.js (their pure timing maths), art.js (cover loading), ink.js (pen reveal),
                          karaoke-layout.js / stack-layout.js / kinetic-layout.js (pure maths), line-draw.js (shared line drawing),
                          chorus.js (finds repeated lines: the constellation brings their stars back bigger, kinetic makes them bigger)
tools/visual.mjs          pixel check: renders fixed frames to PNGs (--out) or compares against them (--compare)
tools/lib/headless.mjs    shared headless-browser helpers for the browser checks below
tools/flash-check.mjs      checks the sync flash and offset keys in every scene
tools/themes.mjs           screenshots every theme (and album colors, from a fake cover) in every scene; checks each one tints the lyrics
tools/lib/fake-spotify.mjs  scripted fake Spotify and lyrics service (songs, no-lyrics song, ad, podcast; pause, seek, skip)
tools/mock.mjs            runs the whole app against the fake Spotify in every scene (npm run mock)
tools/timing-check.mjs    every word visible on its exact start time in every scene (npm run timing)
tools/shots.mjs           screenshots of every scene at 1080p, 1440p, 150% and 200% scaling and a small window (npm run shots)
tools/soak.mjs            key, resize and reduce-motion abuse, then a looping soak reporting heap, CPU and fps (npm run soak -- --minutes 10)
tools/beat-check.mjs      plays a drum loop and checks the desktop app finds its tempo (npm run check:beat; needs speakers)
tools/electron-check.mjs  launches the real desktop app in each display style; checks always-on-top and click-through (npm run check:electron)
web/js/background.js      nebula, drifting and twinkling background stars
web/js/nebula.js          the drifting nebula glow
web/js/shooting-stars.js  shooting stars in line gaps
web/js/beat.js             finds the tempo and beat from onset strengths (pure)
web/js/audio-beat.js       listens to the system audio in the desktop app and feeds beat.js
web/js/romanize.js        offline romanization (Hangul, kana, Cyrillic, Greek)
web/js/translate.js       optional translation through MyMemory, chunked, cached per song
web/js/caption.js         the romanized / translated line under the lyrics
web/js/export.js          save a PNG picture or a WebM clip of the sky
web/js/history.js         songs played with their constellation thumbnails
web/js/history-panel.js   the history panel
web/js/scenes/emotion.js  emotion-word list and glow
web/js/theme.js           themes, fonts, album palette extraction (palette.js loads the image)
web/js/settings-panel.js  settings panel
web/js/perf.js            paint statistics for diagnostics
web/js/states.js          every state's message and fix button
web/js/spike.js           diagnostics: endpoint check, source comparison, tap test
```
