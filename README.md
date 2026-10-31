# Lyric Stars

Spotify lyrics as a constellation. See `Lyric Stars Product Requirements Document.md` for the plan.

## Run (browser version)

Requires Node 20+. No dependencies to install.

```
npm start      # serves http://127.0.0.1:5173/
npm test       # unit tests: LRC parsing, lyric matching, timing, clock
```

Open http://127.0.0.1:5173/ (localhost redirects there, because Spotify only accepts loopback IPs).

- **Keys:** `F` fullscreen, `M` word/line mode, `D` diagnostics, `Space` tap (diagnostics open).
- **Demo without Spotify:** http://127.0.0.1:5173/?demo&start=30 plays Coldplay "Yellow" with no audio.
  `P` pauses, arrow keys seek 10 s. Other songs: `?demo&title=...&artist=...&album=...&duration=<seconds>`.
- **Lyric cache:** `%APPDATA%\LyricStars\cache` (override with `LYRICSTARS_DATA`).

## Layout

```
server.js                 local server: static files, disk cache API, media-session probe
tools/smtc-probe.ps1      Windows media-session reader (spike; becomes the native helper)
web/config.js             BUILT_IN_CLIENT_ID for friend builds
web/js/auth.js            Spotify PKCE login and silent refresh
web/js/sources/           spotify.js, mediaSession.js, demo.js, clock.js (position smoothing)
web/js/lyrics/            lrc.js (parser), match.js (no-wrong-lyrics rules), lrclib.js (provider)
web/js/cache.js           lyric cache client (found: kept; not found: 1 day)
web/js/timing.js          syllable-based word timing estimate
web/js/renderer.js        canvas constellation
web/js/states.js          every state's message and fix button
web/js/spike.js           diagnostics: endpoint check, source comparison, tap test
```
