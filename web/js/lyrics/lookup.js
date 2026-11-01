// How the app asks for a song's lyrics: wait until the song's details have settled, ask, and when the answer is
// "not found" or a failure, ask again after 2 s and after 5 s before giving up. The page shows "Searching lyrics…"
// meanwhile. Pure logic with its timers passed in, so the tests can run it on a fake clock.
import { LyricsError } from './lrclib.js';

export const SETTLE_MS = 700; // the song's details must hold still this long before the first lookup
export const DURATION_WAIT_MS = 4000; // a song with no length yet gets this much longer before we ask anyway
export const RETRY_DELAYS_MS = [2000, 5000]; // then two more tries: 2 s and 5 s after the one before

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves true when the lookup may start, false when this song was replaced while waiting. A change of the
// song's details makes the app start a new lookup (and `isCurrent` false for this one), so holding still is enough.
export async function settle(track, { isCurrent, wait = sleep } = {}) {
  await wait(SETTLE_MS);
  if (!isCurrent()) return false;
  if (!track.durationMs) {
    // The PC's media session can name a song a moment before it knows its length. Without a length no version of
    // the lyrics can be told apart, so give it time; the key changes when the length arrives and restarts us.
    await wait(DURATION_WAIT_MS);
    if (!isCurrent()) return false;
  }
  return true;
}

// Runs `attempt()` (a lyrics fetch) up to 1 + RETRY_DELAYS_MS.length times.
//   -> null                       this song was replaced: ignore everything
//   -> { result }                 a result (found, or the final "not found")
//   -> { error }                  the final failure (a LyricsError)
// `onRetry(n)` is called before each wait so the page can say it is still searching.
export async function lookUpWithRetries(attempt, { isCurrent, onRetry = () => {}, wait = sleep, delays = RETRY_DELAYS_MS, unsure = false } = {}) {
  for (let i = 0; ; i++) {
    let outcome;
    try {
      const result = await attempt();
      if (!isCurrent()) return null;
      // An unknown song length makes "not found" a guess: it is shown but never saved.
      outcome = result.status === 'notfound' && unsure && !result.partial ? { result: { ...result, partial: true } } : { result };
    } catch (e) {
      if (!isCurrent()) return null;
      if (!(e instanceof LyricsError)) throw e;
      if (e.kind === 'offline') return { error: e }; // no point asking again in a few seconds
      outcome = { error: e };
    }
    const done = outcome.result && outcome.result.status !== 'notfound';
    if (done || i >= delays.length) return outcome;
    onRetry(i + 1);
    await wait(delays[i]);
    if (!isCurrent()) return null;
  }
}
