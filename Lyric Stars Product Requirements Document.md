# Lyric Stars: Product Requirements Document

Prepared for Dhruv · October 28, 2026 · Draft v2 (working title: Lyric Stars)

## 1. Summary

Lyric Stars is a free Windows desktop app (and a matching browser version) that shows the lyrics of whatever you are playing on Spotify as a constellation. Each word becomes a star the moment it is sung, stars join with thin lines, and the whole sky fades as the next line arrives. It is inspired by the look of Verci (a paid Mac app) but is an original design, built to be free to run.

The working prototype already exists: Spotify login, now-playing polling, free lyrics from LRCLIB, estimated word timing, a gold-on-black star renderer, a word-by-word and line-by-line toggle, and fullscreen. This document defines what "perfectly functional" means and what has to be built to get there.

**What matters most, in order:** 1) word timing accuracy, 2) beautiful visuals and animation, 3) working reliably with every song, 4) easy setup and install. When two requirements conflict, the higher one wins. The audience is Dhruv plus up to four friends, using the app as a fullscreen display, a floating overlay, and a normal window in equal measure.

## 2. Goals and non-goals

**Goals**

- Lyrics that feel locked to the singer: words land within about 150 ms of being sung on most songs.
- Works with zero cost to the owner: no paid APIs, no paid hosting, no paid licenses.
- Installs like a normal Windows app and also runs in a browser tab.
- Beautiful enough to leave on a second monitor all day, and light enough that you forget it is running.
- Never shows wrong lyrics. A missing song shows a calm empty state, not garbage.

**Non-goals (for now)**

- Selling the app or putting it on a public store. Spotify's free developer mode and lyric licensing both make that a separate project.
- Mac, Linux, and mobile builds.
- Playing music itself. The app only reads what Spotify is already playing.
- Karaoke scoring, translations, and social features.

## 3. Who it is for

Primary user: Dhruv, listening on Windows with Spotify Premium. Up to four friends share the app with him, which matches Spotify's limit on allowed users in Development Mode. The friends are not developers, so install and first launch must work without code, a terminal, or a developer dashboard. All three display styles matter equally: fullscreen on a second monitor, a floating overlay above other windows, and a normal window beside work.

Typical moments:

- Study or work session with the app fullscreen on one screen.
- Evening listening with the app as an ambient visual.
- Singing along, where timing accuracy matters most.

## 4. Constraints that shape every decision

**Spotify developer rules (changed in February 2026).**

- Development Mode now requires the app owner to have an active Premium subscription, and the app stops working if it lapses.
- Each developer is limited to one Development Mode Client ID, and access is limited to a smaller set of endpoints.
- Development Mode apps are limited to a small allowlist of users (reported as five). Anyone outside the list is refused at login.
- Extended access is meant for established, launched services, so a hobby app should not plan on it.
- The redirect address must be a loopback address such as `http://127.0.0.1:5173/`.
- **First task for the build:** confirm that the "currently playing" endpoint the prototype uses is still in the supported list for new Development Mode apps. If it is not, use the Windows media-session source in Section 6.

**Lyrics.**

- Spotify's public API does not provide lyrics.
- Free, legal-to-call sources mostly give line-level timing, not word-level timing.
- Showing lyrics publicly or commercially needs a license from the rights holders. Personal use on your own machine is the intended scope.

**Budget.** Everything must run free: local app, free lyric source, no server, no database service.

**Sharing with friends.** Each friend must be added by the owner to the Spotify app's allowed-user list before their login works. The app ships with the owner's Client ID built in (it is not a secret under PKCE), so friends never create a Spotify app themselves. A friend who is not on the list can still use the Windows media-session source, which needs no Spotify login. Whether a friend needs their own Premium for the API source must be confirmed with a test account during hardening.

## 5. Product requirements

Priorities: P0 means required for a first release that feels finished, P1 means required for "perfect", P2 means nice to have.

Consequences of the ranking: timing accuracy gets the largest share of build time and its own test harness. Visual effects must never delay when a word appears. Reliability work covers missing, wrong, and untimed lyrics. Setup polish comes last, but a friend's install must still meet the target in Section 9.

### 5.1 Connecting and now-playing

- **P0** First-run screen. Builds for friends ship with the Client ID built in, so a friend only clicks "Connect Spotify". A developer-setup screen appears only when no Client ID is built in: it explains how to create the Spotify app, has a copy button for the redirect address, and flags a wrong ID.
- **P0** Login with PKCE (no client secret anywhere). Tokens refresh silently. If login expires, show one "Reconnect" button instead of reloading.
- **P0** If Spotify refuses a login because the person is not on the allowed-user list, say exactly that and offer a button that switches to the Windows media-session source.
- **P0** Detect track, artist, album, duration, play or pause, and position. Smooth the position locally between checks so words do not jump.
- **P0** Position accuracy spike at the start of the build: measure how far each source's reported position is from what is actually heard, and make the more accurate source the default. This gates the timing target in Section 9.
- **P0** Windows media-session source: reads track and position locally, with no login and no API limits. It is also how friends outside the allowed-user list use the app. It needs a small native helper (Section 8), and the spike must confirm how finely the Spotify desktop app updates position (if in coarse steps, smooth locally between them).
- **P0** Handle seeking, skipping, repeat, pausing, and switching devices without losing sync, by re-syncing whenever the reported position drifts more than 300 ms from the local estimate.
- **P0** Respect rate limits: back off when Spotify asks, and keep checks a few seconds apart.
- **P1** Source switcher in settings: Spotify API, Windows media session, or automatic.
- **P2** Ads and podcasts: show a neutral idle screen during ads and a note for podcast episodes.

### 5.2 Lyrics and timing engine (the core of the product)

- **P0** Fetch synced lyrics from LRCLIB using title, artist, album and duration, with a search fallback. Reject results whose duration differs from the track by more than a few seconds, so the wrong version of a song is never used.
- **P0** Cache every fetched lyric on disk by track ID so repeat plays are instant and work offline. Cache "not found" results for a day.
- **P0** Use real word timings whenever the lyric file contains them (word tags in an enhanced LRC file); otherwise estimate. A small indicator shows which is active: "word-timed" or "estimated".
- **P0** Estimated word timing: spread each line's time across its words by syllable count (not letter count), leave a short breath before each line, and let a long line end earlier than the next line starts.
- **P0** Line-by-line mode, where the whole line lights at its timestamp.
- **P0** Timing test harness: a debug view plus automated checks that compare estimated word times with a set of 30 hand-timed reference songs, report the average error in milliseconds, and fail the build if accuracy gets worse.
- **P0** Per-song sync offset (the `[` and `]` keys), saved by track, plus a global default offset for Bluetooth and speaker delay.
- **P0** Latency compensation: draw slightly ahead by the measured display and audio delay, so a star appears when the word is heard, not when it is computed.
- **P1** Better syllable estimation using a pronunciation dictionary for English, with a vowel-group fallback for other languages.
- **P1** Tap-to-sync editor: play a song, tap as each word is sung (or drag words on a timeline), and save the exact word timings for that track. This is the route to truly exact timing on favorite songs.
- **P1** Export and import of corrected timings as a small file, so friends can share fixes with each other without any server.
- **P1** Import word-synced lyric files (enhanced LRC and similar) that the user supplies. Unofficial or reverse-engineered streaming-service lyric endpoints are excluded by default because they break terms of service and break without warning.
- **P2** Plain (unsynced) lyrics fallback shown as a slow-drifting static sky, with a notice that timing is unavailable.
- **P2** Instrumental detection, so long gaps show a calm idle sky instead of the last line.

### 5.3 Constellation visuals

The look is the product. These behaviors should be exact.

- Black background, warm gold stars and lines. The word being sung is the largest, brightest star with a soft glow and a bold label. Earlier words in the line stay smaller and dimmer.
- Stars are four-point sparkles. Lines draw from the previous star to the new one over about 250 ms.
- **P0** Layout is stable: the same line always produces the same constellation, words never overlap, nothing leaves the screen, and long lines wrap into two rows.
- **P0** When a new line begins, the old sky fades out over about 700 ms while the new one forms. During a long instrumental gap the sky fades to a quiet state.
- **P0** Smooth animation at 60 frames per second on a mid-range laptop, with the display scaling correctly on high-DPI screens and when the window is resized.
- **P1** Album palette: pull two or three colors from the album art so each song has its own sky, with a fixed-gold option.
- **P1** Visual themes: Gold (default), Ice, Rose, and a user-set custom color. Font choice from a small curated list.
- **P1** Background stars and slow drift for depth, with a "reduce motion" setting that keeps things still.
- **P1** Optional album art or track title, shown small in a corner, hidden by default.
- **P2** Emphasis on repeated words and on the chorus (for example, bigger star the second time a phrase appears).
- **P2** Constellations that persist and slowly rotate as a full-song memory.

### 5.4 Desktop app behavior

- **P0** Three display styles with equal polish: fullscreen, a normal resizable window, and a floating overlay (always on top, transparent background, optional click-through, adjustable opacity and position). Switch in one click or one key, and each style remembers its own size and place.
- **P0** Windows installer (.exe) with a Start menu entry. It must run on a friend's PC with no Node, no terminal, and no other tools installed.
- **P0** One-page install guide with screenshots. The free installer is unsigned, so Windows may show a SmartScreen warning, and the guide shows friends how to continue past it.
- **P0** Fullscreen toggle (F), line/word toggle (M), and controls that hide after a few seconds of no mouse movement.
- **P0** Remember window size, position, monitor, mode, theme, and offsets between launches.
- **P1** System tray icon with show, hide, mode, and quit. Option to start with Windows and open to the tray.
- **P1** Global keyboard shortcut to show or hide the overlay and to switch click-through on and off.
- **P1** Automatic update check against the project's free release page, so a fix reaches every friend.
- **P2** Ambient mode that keeps the display awake while music plays.

### 5.5 Browser version

- **P0** The same code runs at the local address in any modern browser, with the same login and controls.
- **P1** Installable as a browser app (PWA) so it opens in its own window.

### 5.6 Settings

One panel, opened by a button or the `S` key. Contains: source, mode, theme and colors, font, reduce motion, global offset, overlay options, cache size with a clear button, and disconnect Spotify. Every setting has a sensible default so the app works with no setup beyond login.

## 6. Playback sources

| Source | Gives | Pros | Cons |
| --- | --- | --- | --- |
| Spotify Web API | Track, position, play state | Works in browser and desktop | Polling delay, rate limits, endpoint access may change |
| Windows media session | Track, position, play state | Fast, local, no login | Windows desktop app only, needs a native helper |

The app treats sources as interchangeable plug-ins behind one interface (current track, position, play state), so lyrics and visuals never care where the data came from. Position accuracy decides which source is the default, as measured in the spike in Section 5.1. The Windows source also serves any friend who is not on the Spotify allowed-user list.

## 7. States the app must handle gracefully

- Not logged in, login failed, login expired, wrong Client ID.
- Nothing playing, paused, buffering, ad playing, podcast playing.
- Lyrics loading, lyrics not found, lyrics found but untimed.
- No internet (use cache, otherwise a short offline notice), Spotify rate limit, lyric service down.
- Window minimized or hidden: pause drawing to save battery, resume without a jump.

Every state has one short, plain message and, if the user can fix it, one button that fixes it.

## 8. Technical approach

- **Shell:** Electron for the Windows app, using the same web page the browser version uses, served from a tiny local server on `127.0.0.1:5173`.
- **Structure:** split the single file into modules: auth, playback sources, lyrics providers, timing engine, renderer, settings, and cache. Each can be tested alone.
- **Rendering:** canvas drawing for now. Move to WebGL only if profiling shows frame drops with background stars and glow.
- **Storage:** settings and caches in the app's data folder (files or IndexedDB). Tokens stored with Electron's built-in secure storage, not plain text.
- **Native helper (P1):** a small component that reads the Windows media session and sends track and position to the app. Build it as a separate, optional piece so the app still works without it.
- **Security:** PKCE only, no secrets in the code, no remote code loading, and the app talks to Spotify and the lyric service only.
- **Packaging:** electron-builder to produce the installer, with the free GitHub releases page for downloads if sharing with friends.
- **Quality:** automated tests for the timing engine and lyric matching (this is where most bugs live), plus a manual checklist of 30 varied songs.

## 9. Success measures

The app is "perfectly functional" when all of these are true on a test set of 30 songs across languages, tempos, and genres:

- Word timing, measured against the 30 hand-timed reference songs: on at least 85 percent of songs the average word start is within 150 ms of the reference once the per-song offset is set, and within 250 ms before any offset. These are targets to confirm in the first spike.
- At least 90 percent of mainstream songs find synced lyrics, and every song without them shows the empty state cleanly.
- No wrong-song lyrics shown anywhere in the test set.
- Pausing, seeking, skipping, and switching devices re-sync within one second.
- Sustained 60 frames per second in all three display styles, under 5 percent CPU while idle-drawing, and under 250 MB of memory over a two-hour session.
- A friend goes from download to first star in under 10 minutes using only the install guide, and the owner in under 5.
- Four hours of continuous play with no crash and no login loss.

## 10. Release plan

1. **Spike and hardening (week 1):** confirm Spotify endpoint access, measure position accuracy of both sources, test login with a friend on the allowed-user list, fix the redirect and login flow, add the states in Section 7, the disk cache, and duration matching.
2. **Timing engine (weeks 2 and 3):** reference set and test harness, syllable timing, real word timings when present, per-song offsets, latency compensation, and the tap-to-sync editor.
3. **Visual polish (week 4):** themes, album palette, background stars, resize and high-DPI checks, reduce-motion, and performance in all three display styles.
4. **Display styles and install (week 5):** overlay, fullscreen, window, installer, tray, update check, and the install guide.
5. **Windows source and switcher (week 6):** native helper, source switcher, and the allowed-user fallback.
6. **Release candidate with friends (week 7):** full checklist, a test install on each friend's PC, bug fixing.

The schedule assumes part-time work and can compress if a helper takes the native piece.

## 11. Risks and how to handle them

- **Spotify tightens access again.** Keep the Windows media-session source as a backup that needs no API.
- **Word timing never feels exact.** Offer per-song offsets, manual correction, and honest line-by-line mode. Treat real word-level data as an upgrade, not a dependency.
- **Lyrics coverage gaps.** Cache aggressively, allow importing a lyric file, and show a clear empty state.
- **Wrong lyric version.** Match on duration, album, and artist, and let the user clear a bad match with one click.
- **Licensing.** Keep the app personal and non-commercial, do not bundle or redistribute lyrics, and fetch them only on the user's machine.
- **Premium lapses.** The app owner's subscription must stay active, and the app should explain this if Spotify refuses access.

## 12. Open decisions

Settled in this version: the audience is Dhruv plus up to four friends, fullscreen, overlay, and window are all P0, and the priority order is timing accuracy, visuals, reliability, then setup. Still open:

1. Final app name and icon.
2. The friends' Spotify account emails for the allowed-user list, needed before the first friend test.
3. Which lyric sources beyond LRCLIB are acceptable: import-only, or any free official source found later.
4. Who builds the Windows native helper, and whether to start it as part of the week-1 spike.
5. Whether a friend needs their own Premium for the API source, to be settled with a test account.
