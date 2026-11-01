// Emojis for the kinetic scene: a small word -> emoji dictionary (English only; other languages simply get none).
// A word is matched case-insensitively and by a simple stem ("burning" -> "burn", "tears" -> "tear"). At most
// MAX_PER_LINE emojis are shown for a line (the first matches), so the line stays clean. The emoji is drawn on the
// same start frame as its word and never changes when or where the word appears.

export const MAX_PER_LINE = 2;
export const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

const GROUPS = [
  ['❤️', 'love loved loves loving heart hearts beloved darling'],
  ['🔥', 'fire fires flame flames burn burns burning burned blaze inferno'],
  ['🌙', 'night nights midnight moon moonlight moonlit'],
  ['⭐', 'star stars starlight'],
  ['☀️', 'sun sunshine sunlight sunrise sunset'],
  ['🌧️', 'rain raining rains'],
  ['😢', 'cry cries cried crying tear tears sad sob'],
  ['💃', 'dance dances danced dancing dancer'],
  ['💋', 'kiss kisses kissed kissing'],
  ['💭', 'dream dreams dreaming dreamed'],
  ['🌊', 'ocean sea wave waves tide'],
  ['🌹', 'rose roses'],
  ['🌸', 'flower flowers blossom bloom'],
  ['🌈', 'rainbow'],
  ['⚡', 'lightning thunder electric'],
  ['❄️', 'snow snowing winter frozen freeze'],
  ['🌍', 'world earth'],
  ['🌎', 'planet'],
  ['🎵', 'song songs sing sings singing music melody'],
  ['🎸', 'guitar'],
  ['🎤', 'microphone'],
  ['🥂', 'champagne toast cheers'],
  ['🍷', 'wine'],
  ['🍺', 'beer'],
  ['🚗', 'car cars drive driving drove'],
  ['✈️', 'plane airplane fly flying flew'],
  ['🏠', 'home house'],
  ['🌃', 'city'],
  ['👑', 'queen king crown'],
  ['💎', 'diamond diamonds'],
  ['💰', 'money cash rich'],
  ['💔', 'broken heartbreak heartbroken'],
  ['😊', 'smile smiles smiling happy'],
  ['😂', 'laugh laughing laughter'],
  ['😈', 'devil'],
  ['👼', 'angel angels'],
  ['👻', 'ghost ghosts'],
  ['💀', 'dead death die dying skull'],
  ['🙏', 'pray prayer'],
  ['👀', 'eyes'],
  ['👁️', 'eye'],
  ['✋', 'hand hands'],
  ['👣', 'footsteps'],
  ['🕊️', 'dove peace'],
  ['🦋', 'butterfly butterflies'],
  ['🐺', 'wolf wolves'],
  ['🐦', 'bird birds'],
  ['🐎', 'horse horses'],
  ['🌲', 'forest tree trees'],
  ['⛰️', 'mountain mountains'],
  ['🏖️', 'beach'],
  ['🌴', 'paradise'],
  ['🌅', 'dawn morning'],
  ['🌌', 'galaxy universe'],
  ['☁️', 'cloud clouds'],
  ['🌪️', 'storm storms tornado'],
  ['💧', 'water drop drops'],
  ['🕯️', 'candle candles'],
  ['🔑', 'key keys'],
  ['🔒', 'lock locked'],
  ['⏰', 'clock'],
  ['📞', 'phone telephone'],
  ['🎁', 'gift gifts present'],
  ['🎉', 'party celebrate celebration'],
  ['🎄', 'christmas'],
  ['💍', 'ring marry married wedding'],
  ['💪', 'strong strength'],
  ['🏆', 'win winner champion trophy'],
  ['🍎', 'apple'],
  ['🍯', 'honey'],
  ['🍬', 'sugar candy'],
  ['☕', 'coffee'],
  ['🌟', 'shine shining shines glow glowing sparkle sparkling'],
  ['✨', 'magic magical'],
  ['💫', 'dizzy'],
  ['🌠', 'wish wishes'],
  ['🕺', 'groove'],
  ['🥀', 'wilt wither'],
];

const EMOJI_OF = new Map();
for (const [emoji, words] of GROUPS) for (const w of words.split(' ')) if (!EMOJI_OF.has(w)) EMOJI_OF.set(w, emoji);

// Possible stems of a lower-case word, most specific first.
function stems(w) {
  const out = [w];
  if (w.endsWith('ing') && w.length > 5) out.push(w.slice(0, -3), w.slice(0, -3) + 'e', w.slice(0, -4));
  if (w.endsWith('ed') && w.length > 4) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ies') && w.length > 4) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) out.push(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3) out.push(w.slice(0, -1));
  if (w.endsWith('ly') && w.length > 4) out.push(w.slice(0, -2));
  return out;
}

const memo = new Map();
// 'Burning,' -> '🔥'; null when the word has no emoji.
export function emojiOf(text) {
  let e = memo.get(text);
  if (e === undefined) {
    const plain = String(text).toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '').replace(/['’]s$/, '');
    e = null;
    if (plain) for (const s of stems(plain)) if (EMOJI_OF.has(s)) { e = EMOJI_OF.get(s); break; }
    if (memo.size > 5000) memo.clear();
    memo.set(text, e);
  }
  return e;
}

// Which words of a line get an emoji: an array the length of the line with an emoji or null in each place, at
// most `max` of them (the first matches). A pure function of the words, so it is the same on every frame.
export function emojisForLine(words, max = MAX_PER_LINE) {
  let left = max;
  return words.map((w) => {
    if (left <= 0) return null;
    const e = emojiOf(w.text);
    if (e) left--;
    return e;
  });
}
