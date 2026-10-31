# Lyric Stars

Spotify lyrics as a constellation. See `Lyric Stars Product Requirements Document.md` for the plan.

## Run (browser version)

Requires Node 20+. No dependencies to install.

```
npm start      # serves http://127.0.0.1:5173/
npm test       # unit tests, plus the timing regression check against test/reference
npm run harness  # timing report for the reference songs (add -- --update-baseline to accept)
```

Open http://127.0.0.1:5173/ (localhost redirects there, because Spotify only accepts loopback IPs).

- **Keys:** `F` fullscreen, `M` word/line mode, `D` diagnostics, `E` sync editor,
  `[` / `]` lyrics earlier / later for this song (50 ms; hold Shift for 10 ms).
- **Demo without Spotify:** http://127.0.0.1:5173/?demo&start=30 plays Coldplay "Yellow" with no audio.
  `P` pauses, arrow keys seek 10 s. Other songs: `?demo&title=...&artist=...&album=...&duration=<seconds>`.
- **Lyric cache:** `%APPDATA%\LyricStars\cache` (override with `LYRICSTARS_DATA`). Your timings live in
  `%APPDATA%\LyricStars\timings` and are not removed when the cache is cleared.

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

## Layout

```
server.js                 local server: static files, disk cache API, media-session probe
tools/smtc-probe.ps1      Windows media-session reader (spike; becomes the native helper)
web/config.js             BUILT_IN_CLIENT_ID for friend builds
web/js/auth.js            Spotify PKCE login and silent refresh
web/js/sources/           spotify.js, mediaSession.js, demo.js, clock.js (position smoothing)
web/js/lyrics/            lrc.js (parser), match.js (no-wrong-lyrics rules), lrclib.js (provider)
web/js/cache.js           lyric cache client (found: kept; not found: 1 day)
web/js/timing.js          word timing: real tags or taps, else syllable estimate
web/js/syllables.js       syllable counts; data/syllable-exceptions.js is generated from CMUdict
web/js/sync.js            per-song and global offsets, display latency
web/js/corrections.js     your timings: merge, import, export (also the reference-song format)
web/js/editor.js          tap-to-sync editor
web/js/harness.js         scores the estimator; tools/harness.mjs runs it on test/reference
web/js/renderer.js        canvas constellation
web/js/states.js          every state's message and fix button
web/js/spike.js           diagnostics: endpoint check, source comparison, tap test
```
