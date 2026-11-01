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

- **Keys:** `S` settings, `F` fullscreen, `M` word/line mode, `V` switches scene, `D` diagnostics, `E` sync editor, `Esc` closes panels,
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
- **Styles:** window and fullscreen (`F`). Each style remembers its own size, place and monitor in `%APPDATA%\LyricStars\desktop\desktop.json`. (The overlay and mini widget of older versions are gone; a saved setting for either is ignored and the app opens as a normal window.)
- **Shortcuts (any app):** `Ctrl+Alt+L` show or hide. Tray: show, styles,
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

- **No lyrics:** whenever there is nothing to sing along to, a now-playing scene replaces the empty screen, with a one-line reason: "Lyrics not found", "Lyrics service unreachable" (also asked again by itself after 15 s, 30 s, up to 2 minutes), "You’re offline", "Instrumental" or "Lyrics found but not timed". It shows the album cover (largest size Spotify offers), the song and artist, and a few small stars drifting and twinkling in colors taken from the cover (gold if there is no cover). Pausing freezes the drift; with reduce motion on the scene stands still. The soft colored glow behind the cover and the pulsing ring only appear when Background effects is above 0.
  **Retry** searches again; hover the label for the exact reason, and the browser console logs every lookup (query, status, result count, rejected matches). The cover is the largest image in `album.images` (64 px for thumbnails), preloaded when the
  song starts and kept per track. The Windows app reports no cover, so when you're logged in the song is looked up on
  Spotify by title and artist (or the account's own report of it is used); with no match, or no login, a gold star stands in.
- **Backup lyrics source (Settings → Lyric text, on by default):** LRCLIB is a free community service and sometimes goes down. When it fails, or has no timed lyrics for a song, the app asks NetEase Music's public search through its own local server (title and artist go to music.163.com; nothing else does). It is unofficial and could stop working at any time, and then the app simply finds nothing. The no-wrong-lyrics rule is unchanged: title, artist and length (within 3 s) must match. Timing of backup lyrics is line by line, like LRCLIB. Switch it off if you do not want song titles sent there.
- **Player bar** (bottom centre, fades after 3 s without mouse movement): previous, play/pause, next, and a progress bar you
  can click to seek. Shortcuts: `Space` play/pause, `←` previous, `→` next (`Space` still taps in the sync editor and
  the diagnostics tap test while those are open). It needs the Spotify account, not the PC-only source.
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
  fullscreen. Settings has a "Random scene each song" option; with it on, `V`
  changes only the current song. Scenes are pure functions of the playback position, so seek and pause never leave stale animation.
  Ten more: *Handwriting* (a pen writes each word, a reveal rather than true strokes), *Rain* (words fall and land), *Lanterns* (words rise on glowing paper
  lanterns), *Neon*, *Typewriter*, *Ribbon* (words ride a wave; its liveliness comes from line pace and chorus, not audio), *Orbit* (words circle the album cover),
  *Polaroid* (a photo card per line), *Terminal* and *Paper* (a light cream sheet). Orbit and Polaroid use the album cover, with a glowing disc or a
  palette wash when there is none.
- **Settings (`S`):** lyric source, word/line mode, theme (Gold, Ice, Rose, Sunset or a custom color), album colors,
  font (system fonts only), background stars, reduce motion, corner title/art, global offset, lyric cache, disconnect.
- **Album colors** (off by default): two or three colors are read from the 64 px cover; grey or
  black-and-white covers fall back to the chosen theme. Colors are lifted so they always glow on black.
- **Night sky (Settings → Sky: Off, Stars, Stars + comets; default Stars + comets):** one shared background module (`web/js/sky.js`) behind every scene except Paper. It is pure #000000 (no gradient, nebula, blur, glow or pulsing): 160 tiny sharp stars of 1 or 2 pixels on whole device pixels, each twinkling at its own speed, drifting very slowly to the left, and dim; and, in Stars + comets, one comet at a time every 6 to 15 seconds at a random angle, with a bright head and a thin tail of six short segments, dimmer over the lyric area. With reduce motion the stars stand still and twinkle very slowly and there are no comets. It is driven by the frame clock with a clamped delta time, and allocates nothing per frame. **Glow** (0–100, default 25, Settings) sets the small glow on the star of the word being sung and the soft light in a few scenes; 0 removes it. The old Background effects slider and its nebula, dust and shooting stars are gone (a saved value is ignored). The Beat pulse no longer lights the background; the scenes' stars still swell with it.
- **Emotion words:** English words about fire, night, love, water and sun get a small coloured glow in Constellation, Karaoke, Kinetic, Stack, Neon and Lanterns. Other languages get no glow. Each of these three can be switched off in Settings.
  While paused it repaints at about 20 fps; with reduce motion on (default follows Windows "Animation effects")
  nothing moves and a paused sky does not repaint at all.
- **Polaroid scene:** each line is an instant photo pinned or taped to the dark wall: white border, paper texture, the album cover (slowly drifting) as the picture with a faded warm film look that develops from dark to colour in about a second, and the lyric handwritten on the strip as it is sung (the word being sung in the album colour). A new card flies in and swings like a pinned photo; the last 3 older cards stay behind, smaller, dimmer and softened. The first card of a song slides out of a camera at the bottom edge. Settings: *Film look* (grain and fade, on by default) and *Camera flash* (off by default; at most one line in four, 80 ms, never over the current line). Reduce motion: no swing, drift, flash or flight, just a short fade. The handwriting is Caveat (SIL Open Font License, bundled in `web/fonts/`, no network needed).
- **Emojis (Settings, on by default, Kinetic scene):** about 80 word groups (love, fire, night, rain, sun, heart, dance, etc., matched ignoring case and by simple stem) get an emoji that pops in on the same frame as its word and never delays it; at most 2 a line. With reduce motion it just sits there. Drawn with Segoe UI Emoji at whole-pixel sizes.
- **Constellation links:** a link is only ever drawn between stars of the same line, and once a line has faded out all of its stars, links and labels are removed; a repeated (chorus) line gets its own fresh stars each time.
- **Lyrics lookup:** the app waits for the track info to settle (and for a real length) before the first lookup, then retries at 2 s and 5 s before showing "Lyrics not found"; "Searching lyrics…" shows meanwhile. A timeout or server error is never saved, an answer for a previous song is ignored, and lyrics that arrive late are shown at the right position without a restart.
- **Album colors (Settings, off by default):** each track's 2–3 dominant bright colors are cached by track ID; a cover that cannot be read falls back to gold with one console warning, and is asked for again once.
- **Romanized and translated lyrics (Settings → Lyric text):** a small caption under the lyrics shows the current line in Latin letters for Korean, Japanese kana, Russian and Greek (built in, offline, on by default). Kanji and Chinese characters, Hindi, Arabic and Thai are not romanized. An optional translation (off by default) looks each song up once at the free MyMemory service (api.mymemory.translated.net, no key) and keeps it on disk; **this sends the lyric text to that service**, and if it is slow, limited or down the lyrics simply show without it. The caption is a line under the lyrics, not under each word,.
- **Beat pulse (desktop app, Settings, off by default):** the glow swells from the middle of the sky on each beat and the Constellation stars swell with it. Lyrics never move with it, so word timing is untouched. It listens to the sound your PC is playing (Windows system audio output, through Electron; no extra program or key), keeps only a loudness-change number every 10 ms, and records and sends nothing. Windows may show a screen-capture indicator while it is on, because that is how Windows shares its audio. It finds a steady tempo of 60 to 180 BPM from the last 8 seconds, so it needs a few seconds after a song starts, may read a fast song at half speed (every second beat), and shows nothing when the music has no steady beat (ambient, free tempo) or when nothing is playing. Settings shows "Beat found: about N BPM". Off with reduce motion, and in Paper. `npm run check:beat` plays a drum loop through your speakers for about 20 seconds and checks the app finds its tempo.
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
web/js/lyrics/            lrc.js (parser), match.js (no-wrong-lyrics rules), lrclib.js (provider; netease.js is the backup source: cleans title and artist, tries get with album, get without, search, then a broader search; logs each request to the console)
web/js/cache.js           lyric cache client (found: kept; a true not found: 30 minutes; a service error is never saved)
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
tools/backup-check.mjs    LRCLIB down: the backup finds the song, finds nothing, is down too, or is switched off (npm run check:backup)
tools/lrclib-probe.mjs    calls the real LRCLIB for five well-known songs and prints status and timing (node tools/lrclib-probe.mjs)
tools/nowplaying-cases.mjs the no-lyrics scene for not found, service error, instrumental and not-timed, with pictures (node --experimental-websocket tools/nowplaying-cases.mjs OUT_DIR)
tools/glow-shots.mjs      before/after pictures of blur and glow at 1080p and 200% scaling (node --experimental-websocket tools/glow-shots.mjs OUT_DIR)
tools/beat-check.mjs      plays a drum loop and checks the desktop app finds its tempo (npm run check:beat; needs speakers)
tools/fix-shots.mjs       screenshots of one scene at chosen times, size and settings (node --experimental-websocket tools/fix-shots.mjs OUT_DIR --scene kinetic --at 4.2 --size 1920x1080@2)
tools/frame-perf.mjs      frame time of a scene over a stretch of playback (--scene orbit --seconds 60 --set JSON)
tools/album-check.mjs     five fake covers of different colors; checks each tints the sky in several scenes
tools/lyrics-retry-check.mjs  fake lyrics service that fails once, twice, is slow, or has nothing; checks the search-and-retry behavior
tools/electron-check.mjs  launches the real desktop app in each display style; checks the window and fullscreen styles (npm run check:electron)
web/js/sky.js             the shared black sky: twinkling stars and comets
web/js/lyrics/lookup.js   waits for stable track info, retries 2 s and 5 s, never saves a timeout (pure)
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
