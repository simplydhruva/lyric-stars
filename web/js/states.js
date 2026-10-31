// One short, plain message per state, and at most one button that fixes it.
// `card` states take the centre of the screen; `chip` states sit in a corner.
// `soft` cards are calm idle states with no box.

export const STATES = {
  connect: {
    card: true,
    title: 'Lyric Stars',
    text: 'See the lyrics of whatever you play on Spotify, as stars.',
    button: { label: 'Connect Spotify', action: 'login' },
    local: { label: 'Use without logging in', action: 'use-local' },
  },
  'login-denied': {
    card: true,
    title: 'Login cancelled',
    text: 'Lyric Stars needs to see what you are playing on Spotify.',
    button: { label: 'Connect Spotify', action: 'login' },
    local: { label: 'Use without logging in', action: 'use-local' },
  },
  'login-in-browser': {
    card: true,
    title: 'Finish logging in in your browser',
    text: 'Your web browser opened Spotify. Log in there, then come back here.',
    button: { label: 'Open the login page again', action: 'login' },
  },
  'login-handed-off': {
    card: true,
    title: 'You’re logged in',
    text: 'Go back to the Lyric Stars app. You can close this tab.',
  },
  'login-failed': {
    card: true,
    title: 'Login did not work',
    text: '{message}',
    button: { label: 'Try again', action: 'login' },
  },
  'wrong-client-id': {
    card: true,
    title: 'Spotify did not recognise the Client ID',
    text: 'Check the Client ID in your Spotify developer dashboard and paste it again.',
    button: { label: 'Fix Client ID', action: 'setup' },
  },
  'wrong-client-id-builtin': {
    card: true,
    title: 'Spotify refused this build',
    text: 'The Client ID inside this copy of Lyric Stars was refused. Ask the owner for a new build.',
  },
  expired: {
    card: true,
    title: 'Spotify login expired',
    text: 'Reconnect to keep your lyrics in sync.',
    button: { label: 'Reconnect', action: 'login' },
  },
  'not-allowlisted': {
    card: true,
    title: 'This Spotify account is not on the user list',
    text:
      'Only accounts the app owner adds can log in. Ask the owner to add your Spotify email under "Users and access", or use Lyric Stars without logging in: it then follows the Spotify app on this PC.',
    button: { label: 'Use without logging in', action: 'use-local' },
  },
  refused: {
    card: true,
    title: 'Spotify refused access',
    text: 'Spotify said: "{message}". This usually means the app owner’s Spotify Premium has lapsed.',
    button: { label: 'Try again', action: 'retry-source' },
  },
  'media-session-unavailable': {
    card: true,
    title: 'Windows media session is not available',
    text: '{message}',
    button: { label: 'Use Spotify login', action: 'use-spotify' },
  },
  'lyrics-offline': {
    card: true,
    title: 'You’re offline',
    text: 'Lyrics for this song aren’t saved yet. They’ll load when you’re back online.',
    button: { label: 'Retry', action: 'retry-lyrics' },
  },
  'lyrics-service-down': {
    card: true,
    title: 'The lyrics service isn’t responding',
    text: 'Trying again shortly.',
    button: { label: 'Retry now', action: 'retry-lyrics' },
  },

  idle: { soft: true, title: 'Nothing playing', text: 'Play something on Spotify and it will appear here.' },
  'idle-media-session': { soft: true, title: 'Nothing playing', text: 'Play a song in Spotify (or another player) on this PC.' },
  // Automatic without a login: only this PC can be followed.
  'idle-local': {
    soft: true,
    title: 'Nothing playing',
    text: 'Play a song in Spotify on this PC. To follow your phone or speakers too, connect your Spotify account.',
    button: { label: 'Connect Spotify', action: 'login' },
  },
  ad: { soft: true, title: 'Ad break', text: 'Lyrics come back after the ad.' },
  podcast: { soft: true, title: '{title}', text: 'Lyrics are shown for songs only.' },
  notfound: { soft: true, title: 'No synced lyrics for this song', text: '{track}' },
  plain: { soft: true, title: 'Lyrics found, but without timing', text: '{track}' },
  instrumental: { soft: true, title: 'Instrumental', text: '{track}' },

  loading: { chip: 'Finding lyrics…' },
  paused: { chip: 'Paused' },
  buffering: { chip: 'Buffering…' },
  offline: { chip: 'Offline · using saved lyrics' },
  'rate-limited': { chip: 'Spotify asked us to slow down · retrying in {seconds}s' },
  'spotify-down': { chip: 'Spotify isn’t responding · retrying' },
};

export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
