// Translated lyrics, from the free MyMemory web service (no key, no account). Off unless the user turns it on,
// because it sends the song's lyric text to that service. The result is kept on disk per song and language, so a
// song is only ever looked up once. If the service is slow, full or down, the song just shows without translation.

export const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
];

const ENDPOINT = 'https://api.mymemory.translated.net/get';
const CHUNK_CHARS = 400; // the service allows about 500 bytes per request
const MAX_REQUESTS = 40; // a safety stop per song
const COMMON_ENGLISH = new Set('the you and to me my it in is of that on for with this your we be are all but not just so know like when what i i\'m don\'t baby oh yeah love can no up out they there got one now never way say go'.split(' '));

// True for lyrics that are clearly English, so they are not sent anywhere to be "translated" into English.
export function looksEnglish(texts) {
  const words = texts.join(' ').toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < 6) return false;
  const letters = texts.join('').match(/\p{L}/gu) || [];
  const ascii = letters.filter((c) => c.charCodeAt(0) < 128).length;
  if (letters.length && ascii / letters.length < 0.9) return false;
  return words.filter((w) => COMMON_ENGLISH.has(w)).length / words.length > 0.2;
}

// Groups the non-empty lines into requests of at most CHUNK_CHARS; each item is [lineIndex, text].
export function chunkLines(texts) {
  const chunks = [];
  let cur = [];
  let size = 0;
  texts.forEach((t, i) => {
    const text = String(t || '').trim();
    if (!text) return;
    if (cur.length && size + text.length + 1 > CHUNK_CHARS) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push([i, text]);
    size += text.length + 1;
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function ask(text, to, fetchImpl) {
  const url = `${ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`Autodetect|${to}`)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const body = await res.json();
  const out = body?.responseData?.translatedText;
  if (body?.responseStatus && Number(body.responseStatus) !== 200) throw new Error(`translate ${body.responseStatus}`);
  if (typeof out !== 'string' || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) throw new Error('translate refused');
  return out;
}

// Returns one translation per line (null where a line is empty, failed, or came back unchanged), or null when
// nothing could be translated. `fetchImpl` is injectable for tests.
export async function translateLines(texts, to, { fetchImpl = fetch, shouldStop = () => false } = {}) {
  const result = texts.map(() => null);
  let requests = 0;
  let any = false;
  for (const chunk of chunkLines(texts)) {
    if (shouldStop() || requests >= MAX_REQUESTS) break;
    try {
      requests++;
      const parts = (await ask(chunk.map((c) => c[1]).join('\n'), to, fetchImpl)).split('\n');
      let pieces = parts.length === chunk.length ? parts : null;
      if (!pieces) {
        // The service merged or split lines: ask again one line at a time (within the request limit).
        pieces = [];
        for (const [, text] of chunk) {
          if (shouldStop() || requests >= MAX_REQUESTS) {
            pieces.push(null);
            continue;
          }
          requests++;
          pieces.push(await ask(text, to, fetchImpl).catch(() => null));
        }
      }
      chunk.forEach(([i, text], k) => {
        const t = pieces[k]?.trim();
        if (t && t.toLowerCase() !== text.toLowerCase()) {
          result[i] = t;
          any = true;
        }
      });
    } catch {
      break; // rate-limited or offline: stop asking, keep what we have
    }
  }
  return any ? result : null;
}
