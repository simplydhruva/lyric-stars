// Media-session players: friendly names, and tidying what video sites put in
// titles so the lyric search has a chance. Matching rules in lyrics/match.js still
// decide; a tidy title can only find a song, never force a wrong one.

const NAMES = [
  [/spotify/i, 'Spotify'],
  [/msedge|microsoftedge/i, 'Edge'],
  [/chrome/i, 'Chrome'],
  [/brave/i, 'Brave'],
  [/firefox|^308046B0AF4A39CB$/i, 'Firefox'],
  [/opera/i, 'Opera'],
  [/vivaldi/i, 'Vivaldi'],
  [/applemusic|apple\.music/i, 'Apple Music'],
  [/zunemusic|media\.player|mediaplayer/i, 'Media Player'],
  [/tidal/i, 'TIDAL'],
  [/deezer/i, 'Deezer'],
  [/amazon.*music/i, 'Amazon Music'],
  [/youtube.*music/i, 'YouTube Music'],
  [/vlc/i, 'VLC'],
  [/foobar/i, 'foobar2000'],
  [/musicbee/i, 'MusicBee'],
  [/itunes/i, 'iTunes'],
];

export const isSpotifyApp = (app) => /spotify/i.test(String(app || ''));

// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" -> "Spotify"; unknown ids are shortened.
export function playerName(app) {
  const id = String(app || '');
  for (const [re, name] of NAMES) if (re.test(id)) return name;
  const short = id.split('!').pop().replace(/\.exe$/i, '').split(/[\\/]/).pop();
  return short && short.length <= 24 ? short : 'a media player';
}

// Bracketed extras video sites add: (Official Video), [Lyrics], (HD), (Visualizer)…
const NOISE = /\s*[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|m\/v|clip|music video)\b[^)\]]*[)\]]/gi;
const TRAILING = /\s*[|｜].*$/; // "Song | Artist Channel"

// { title, artist, album, app } as the media session reports it -> { title, artist, album }.
export function tidyMediaInfo({ title = '', artist = '', album = '', app = '' }) {
  title = String(title).trim();
  artist = String(artist).trim();
  album = String(album).trim();
  if (isSpotifyApp(app)) return { title, artist, album };

  // Channel names: "Coldplay - Topic", "ColdplayVEVO", "Coldplay Official".
  artist = artist.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/\s+official$/i, '').trim();
  let t = title.replace(NOISE, '').replace(TRAILING, '').trim();
  // "Artist - Title" in the video title: trust it over the channel name.
  const dash = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    artist = dash[1].trim();
    t = dash[2].replace(NOISE, '').trim();
  }
  // Remaining "ft." credits belong to the artist list, not the title.
  t = t.replace(/\s+\(?(ft\.?|feat\.?)\s+[^)]*\)?$/i, '').trim();
  return { title: t || title, artist, album };
}
