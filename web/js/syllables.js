// Syllable counting: English pronunciation dictionary first, then a
// vowel-group rule that works tolerably for most Latin-script languages.
import { EXCEPTIONS } from './data/syllable-exceptions.js';

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/g;

let dict = null;
function dictionary() {
  if (!dict) {
    dict = new Map();
    // Format: "count:word word word|count:word ..."
    for (const group of EXCEPTIONS.split('|')) {
      const [n, words] = group.split(':');
      for (const w of words.split(' ')) dict.set(w, Number(n));
    }
  }
  return dict;
}

// Vowel groups with silent-e rules. `latin` must be lowercase a-z only.
export function vowelGroupSyllables(latin) {
  const groups = latin.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 0;
  // Silent trailing e ("love", "shine"), but not "-le" ("little") or one-vowel words ("the").
  if (n > 1 && /[^aeiouy]e$/.test(latin) && !/[^aeiouy]le$/.test(latin)) n--;
  if (n > 1 && /[^aeiouy]es$/.test(latin) && !/(?:[cgsxz]|ch|sh)es$/.test(latin)) n--;
  return Math.max(1, n);
}

// The key used for dictionary lookups: lowercase letters and apostrophes.
export function dictKey(word) {
  return String(word || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');
}

export function countSyllables(word) {
  const w = String(word || '').toLowerCase();
  const cjk = w.match(CJK);
  if (cjk) return cjk.length;
  const key = dictKey(w);
  if (key && dictionary().has(key)) return dictionary().get(key);
  const latin = w.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  if (latin) return vowelGroupSyllables(latin);
  const letters = w.replace(/[^\p{L}]/gu, '');
  return letters ? Math.max(1, Math.round(letters.length / 3)) : 0;
}
