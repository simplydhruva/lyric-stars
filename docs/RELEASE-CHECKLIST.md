# Release checklist

Run this before every release that goes to friends. **Auto** rows are scripts; **Manual** rows need a person, real Spotify and real ears. Tick a row only after it passes on the build you are about to publish.

## 1. Before building

- [ ] `npm test` passes (unit tests for timing, matching, sources, sync, report).
- [ ] `npm run harness` passes on the reference set. Target from PRD §9: on 85% of songs the average word start is within 250 ms before any offset, and within 150 ms once the per-song offset is set. The set should have 30 hand-timed songs; see `test/reference/README.txt`.
- [ ] `web/config.js` has `BUILT_IN_CLIENT_ID` set to the release app's Client ID and `UPDATE_REPO` set to `owner/repo`.
- [ ] `package.json` `version` is bumped. The update check compares this number against the GitHub release tag.
- [ ] `git grep -i -E "secret|refresh_token|BEGIN .*KEY"` turns up nothing that looks like a real credential. The Client ID is public under PKCE and is fine to ship.
- [ ] Every friend's Spotify email is on the app's allowed-user list in the Spotify dashboard. Anyone not on the list can still use "Use without logging in".

## 2. Build and install

- [ ] `npm run dist` produces `dist/Lyric-Stars-Setup-<version>.exe`.
- [ ] Install it on a PC that has no Node and no dev tools. Check that the Start menu entry is there and the app opens. (PRD 5.4)
- [ ] SmartScreen: "More info → Run anyway" works the way `INSTALL.md` describes.
- [ ] Uninstall from Settings → Apps leaves nothing running.

## 3. Connecting (PRD 5.1, §7)

| Check | How |
| --- | --- |
| First run shows "Connect Spotify" plus "Use without logging in" | Manual, on a clean install |
| Login completes and the first star appears | Manual |
| Login is kept after restarting the app, and after four hours of play | Manual |
| Account not on the allowed-user list gives the plain message and a working "Use without logging in" button | Manual, with a non-listed account |
| Refusing on Spotify's consent page shows the login-denied card | Manual |
| Disconnect in Settings returns to the first-run screen | Manual |
| Automatic source: the Spotify app on this PC wins; playing on a phone follows the account | Auto: `test/auto.test.js`; Manual: play on a phone |
| Other players (browser, VLC) work as a backup | Auto: e2e `drive5` |

## 4. Timing (PRD 5.2, §9)

| Check | How |
| --- | --- |
| Pausing, seeking, skipping and switching devices re-sync within 1 s | Manual, five songs; Auto: `test/clock.test.js` |
| `[` and `]` shift a song and the shift is remembered | Manual |
| Global offset for Bluetooth works | Manual, with headphones |
| "Word-timed" or "estimated" indicator is correct | Manual |
| Tap-to-sync editor saves timings, and export/import round-trips | Manual; Auto: `test/corrections.test.js` |

## 5. Lyrics (PRD 5.2, §9)

- [ ] Play the 30-song test set (mixed languages, tempos and genres). Record, per song, found synced / plain / not found / wrong.
- [ ] At least 27 of 30 mainstream songs find synced lyrics.
- [ ] **Zero** wrong-song lyrics. One wrong song blocks the release.
- [ ] A song with no lyrics shows the empty state cleanly.
- [ ] Offline: replaying a cached song works with the network cable out; an uncached song shows the offline notice.

## 6. Visuals and display styles (PRD 5.3, 5.4, §9)

| Check | Target | How |
| --- | --- | --- |
| Frame rate in window and fullscreen | 60 paints/s | Auto: `soak6.mjs` reads Diagnostics → Rendering |
| CPU while idle-drawing (paused) | under 5% | Auto: soak |
| Memory over a two-hour session | under 250 MB | Auto: soak (whole process tree) |
| Four hours of play, no crash | no crash | Manual, overnight playlist |
| High-DPI and resize keep the layout on screen | nothing clipped | Manual, at 100% and 150% scaling |
| Window size, position, monitor, mode, theme and offsets remembered | restored after restart | Manual |
| Tray menu: show, hide, mode, quit | works | Manual |

## 7. Publish

- [ ] Commit, tag `v<version>`, and push.
- [ ] Create a GitHub release for the tag (not a pre-release) and attach the installer `.exe`.
- [ ] On a PC still running the previous version, Settings → Desktop app → "Check for updates" shows the new version.
- [ ] Send friends the release link, `docs/FRIEND-TEST.md` and `docs/INSTALL.md`.

## 8. After the friend test

- [ ] Collect the "Copy report" pastes and list the bugs.
- [ ] Time each friend from download to first star (target: under 10 minutes).
- [ ] Fix, bump the patch version, and repeat from section 1.
