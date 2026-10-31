// Romanization: writes a line in Latin letters so it can be sung along to. Fully offline, from small built-in tables.
// Supported: Korean (Hangul), Japanese kana (Hepburn), Russian and other Cyrillic, Greek.
// NOT supported: Chinese characters and Japanese kanji (they need a dictionary), Hindi, Arabic, Thai and others.
// romanizeLine() returns null when a line has nothing it can write out, so those lines simply show no romanization.

// ---- Korean (Revised Romanization, letter by letter: no sound-change rules) -----------
const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWELS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'kk', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'p', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

function hangul(ch) {
  const n = ch.codePointAt(0) - 0xac00;
  if (n < 0 || n > 11171) return null;
  return INITIALS[Math.floor(n / 588)] + VOWELS[Math.floor((n % 588) / 28)] + FINALS[n % 28];
}

// ---- Japanese kana (Hepburn) ----------------------------------------------------------
const KANA_BASE =
  'あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno ' +
  'はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa ゐi ゑe をo んn ' +
  'がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo だda ぢji づzu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo ゔvu';
const KANA_SMALL = 'ゃya ゅyu ょyo ぁa ぃi ぅu ぇe ぉo';
const KANA = new Map();
for (const pair of KANA_BASE.split(' ')) KANA.set(pair[0], pair.slice(1));
const SMALL = new Map(KANA_SMALL.split(' ').map((p) => [p[0], p.slice(1)]));
const toHira = (c) => {
  const n = c.codePointAt(0);
  return n >= 0x30a1 && n <= 0x30f6 ? String.fromCodePoint(n - 0x60) : c; // katakana -> hiragana
};

function kana(text) {
  const chars = [...text].map(toHira);
  let out = '';
  let double = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === 'っ') {
      double = true;
      continue;
    }
    if (c === 'ー') {
      const last = out[out.length - 1];
      if (last && 'aiueo'.includes(last)) out += last; // long vowel: written as a doubled vowel
      continue;
    }
    let syl = KANA.get(c);
    if (syl === undefined) {
      out += c;
      double = false;
      continue;
    }
    const next = chars[i + 1];
    if (next && SMALL.has(next)) {
      const s = SMALL.get(next);
      if ('ゃゅょ'.includes(next)) {
        // きゃ -> kya, しゃ -> sha, ちゃ -> cha, じゃ -> ja
        syl = /^(sh|ch|j)i$/.test(syl) ? syl.slice(0, -1) + s.slice(1) : syl.slice(0, -1) + s;
      } else syl = syl.length > 1 && /^(sh|ch|ts|j|f)/.test(syl) ? syl.replace(/[aiueo]$/, s) : syl.slice(0, -1) + s; // ふぁ -> fa, てぃ -> ti
      i++;
    }
    if (double) {
      out += syl[0] === 'c' && syl[1] === 'h' ? 't' : syl[0]; // っ doubles the next consonant (cch -> tch)
      double = false;
    }
    out += syl;
  }
  return out;
}

// ---- Cyrillic and Greek ----------------------------------------------------------------
const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz',
};
const GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
  ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o', ά: 'a', έ: 'e', ή: 'i', ί: 'i', ό: 'o', ύ: 'y', ώ: 'o', ϊ: 'i', ϋ: 'y',
};

function viaTable(text, table) {
  let out = '';
  for (const c of text) {
    const lower = c.toLowerCase();
    const r = table[lower];
    if (r === undefined) out += c;
    else out += c !== lower && r ? r[0].toUpperCase() + r.slice(1) : r;
  }
  return out;
}

const RANGES = {
  hangul: /[가-힣]/,
  kana: /[ぁ-ゖァ-ヺー]/,
  cyrillic: /[Ѐ-ӿ]/,
  greek: /[Ͱ-Ͽ]/,
};

// 'hangul' | 'kana' | 'cyrillic' | 'greek' | null: the first supported script a line contains.
export function scriptOf(text) {
  for (const [name, re] of Object.entries(RANGES)) if (re.test(text)) return name;
  return null;
}

export function romanizeLine(text) {
  const script = scriptOf(text);
  if (!script) return null;
  let out = '';
  if (script === 'cyrillic') out = viaTable(text, CYRILLIC);
  else if (script === 'greek') out = viaTable(text, GREEK);
  else {
    // Hangul and kana can sit in one line with other characters: write what we can, keep the rest.
    let run = '';
    const flush = () => {
      if (run) out += kana(run);
      run = '';
    };
    for (const c of text) {
      if (RANGES.kana.test(c)) run += c;
      else {
        flush();
        out += hangul(c) ?? c;
      }
    }
    flush();
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out && out.toLowerCase() !== text.toLowerCase() ? out : null;
}

// One romanization per line (null where there is nothing to show), or null when the song has none at all.
export function romanizeLines(texts) {
  const out = texts.map(romanizeLine);
  return out.some(Boolean) ? out : null;
}
