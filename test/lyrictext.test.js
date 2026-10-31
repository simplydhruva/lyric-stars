import test from 'node:test';
import assert from 'node:assert/strict';
import { romanizeLine, romanizeLines, scriptOf } from '../web/js/romanize.js';
import { translateLines, chunkLines, looksEnglish } from '../web/js/translate.js';
import { Caption } from '../web/js/caption.js';

test('romanize: Korean', () => {
  assert.equal(romanizeLine('사랑해'), 'saranghae');
  assert.equal(romanizeLine('안녕하세요'), 'annyeonghaseyo');
  assert.equal(romanizeLine('한국'), 'hanguk');
});

test('romanize: Japanese kana', () => {
  assert.equal(romanizeLine('さくら'), 'sakura');
  assert.equal(romanizeLine('ありがとう'), 'arigatou');
  assert.equal(romanizeLine('きょう'), 'kyou');
  assert.equal(romanizeLine('しゃしん'), 'shashin');
  assert.equal(romanizeLine('ちゃんと'), 'chanto');
  assert.equal(romanizeLine('まって'), 'matte');
  assert.equal(romanizeLine('カタカナ'), 'katakana');
  assert.equal(romanizeLine('コーヒー'), 'koohii');
});

test('romanize: Cyrillic and Greek, with capitals kept', () => {
  assert.equal(romanizeLine('Привет, мир'), 'Privet, mir');
  assert.equal(romanizeLine('Щи'), 'Shchi');
  assert.equal(romanizeLine('Αγάπη'), 'Agapi');
});

test('romanize: nothing to do for Latin text or unsupported scripts', () => {
  assert.equal(romanizeLine('hello world'), null);
  assert.equal(romanizeLine('我爱你'), null); // Chinese characters need a dictionary
  assert.equal(romanizeLine(''), null);
  assert.equal(scriptOf('love'), null);
  assert.equal(romanizeLines(['hello', 'there']), null);
  assert.deepEqual(romanizeLines(['hello', 'さくら']), [null, 'sakura']);
});

test('looksEnglish tells English lyrics from other languages', () => {
  assert.equal(looksEnglish(['I know you are the one for me', 'and I love you so', 'never let me go']), true);
  assert.equal(looksEnglish(['Me gustas tú, me gustas tú', 'como la lluvia sobre el mar']), false);
  assert.equal(looksEnglish(['さくら さくら']), false);
});

test('chunkLines keeps requests short and skips empty lines', () => {
  const texts = ['a'.repeat(200), '', 'b'.repeat(150), 'c'.repeat(150), '  '];
  const chunks = chunkLines(texts);
  assert.deepEqual(chunks.map((c) => c.map((x) => x[0])), [[0, 2], [3]]);
});

const fakeFetch = (fn) => async (url) => {
  const q = decodeURIComponent(new URL(url).searchParams.get('q'));
  return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: fn(q) } }) };
};

test('translateLines maps results back to the right lines', async () => {
  const out = await translateLines(['hola', '', 'adios'], 'en', { fetchImpl: fakeFetch((q) => q.split('\n').map((l) => l + ' (en)').join('\n')) });
  assert.deepEqual(out, ['hola (en)', null, 'adios (en)']);
});

test('translateLines falls back to one line at a time when the service merges lines', async () => {
  const out = await translateLines(['uno', 'dos'], 'en', { fetchImpl: fakeFetch((q) => (q.includes('\n') ? 'merged' : q + '!')) });
  assert.deepEqual(out, ['uno!', 'dos!']);
});

test('translateLines gives up quietly when the service refuses, and drops unchanged lines', async () => {
  assert.equal(await translateLines(['hola'], 'en', { fetchImpl: fakeFetch(() => 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS') }), null);
  assert.equal(await translateLines(['hola'], 'en', { fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await translateLines(['hola'], 'en', { fetchImpl: fakeFetch((q) => q) }), null);
  assert.equal(await translateLines(['hola'], 'en', { fetchImpl: fakeFetch(() => 'hi'), shouldStop: () => true }), null);
});

test('caption shows the current line only, follows the options, and hides when empty', () => {
  const el = { hidden: true, children: [], replaceChildren(...c) { this.children = c; } };
  globalThis.document = { createElement: () => ({ className: '', textContent: '' }) };
  const timeline = [{ time: 1000, text: 'さくら' }, { time: 3000, text: 'hello' }];
  const c = new Caption(el);
  c.setTimeline(timeline);
  c.setOptions({ romanize: true, translate: true });
  c.setTranslation(['cherry blossom', 'hi']);
  c.frame(500);
  assert.equal(el.hidden, true);
  c.frame(1500);
  assert.deepEqual(el.children.map((x) => x.textContent), ['sakura', 'cherry blossom']);
  c.frame(3500);
  assert.deepEqual(el.children.map((x) => x.textContent), ['hi']);
  c.setOptions({ romanize: false, translate: false });
  c.frame(1500);
  assert.equal(el.hidden, true);
});
