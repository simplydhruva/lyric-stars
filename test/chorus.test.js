import test from 'node:test';
import assert from 'node:assert/strict';
import { detectChorus, normalizeLine } from '../web/js/scenes/chorus.js';

const line = (...words) => ({ words: words.map((text) => ({ text })) });
const L = (text) => line(...text.split(' '));

test('normalizeLine ignores case and punctuation', () => {
  assert.equal(normalizeLine(line('Oh,', 'baby!')), 'oh baby');
  assert.equal(normalizeLine(line('OH', 'baby')), 'oh baby');
  assert.equal(normalizeLine(line('...')), '');
});

test('a line that comes back is the chorus, every time it is sung', () => {
  const lines = [L('Hold me tonight'), L('Verse one here'), L('hold me, tonight!'), L('Verse two there'), L('HOLD ME TONIGHT'), { words: [] }];
  const c = detectChorus(lines);
  assert.deepEqual(c.map((x) => x.chorus), [true, false, true, false, true, false]);
  assert.deepEqual(c.map((x) => x.occurrence), [0, 0, 1, 0, 2, 0]);
  assert.deepEqual(c.map((x) => x.count), [3, 1, 3, 1, 3, 1]);
  assert.deepEqual(c.map((x) => x.firstIndex), [0, 1, 0, 3, 0, 5]);
});

test('a nearly identical line counts as the same line', () => {
  const c = detectChorus([L('hold me in the light tonight'), L('something else entirely different'), L('hold me in the light tonight yeah')]);
  assert.equal(c[2].group, c[0].group);
  assert.equal(c[2].occurrence, 1);
  assert.equal(c[1].chorus, false);
});

test('very short lines (oh, yeah) are never the chorus', () => {
  const c = detectChorus([L('Oh'), L('Oh'), L('Yeah yeah'), L('Yeah yeah')]);
  assert.equal(c[0].chorus, false);
  assert.equal(c[1].group, -1);
  assert.equal(c[2].chorus, true);
});

test('different lines that share a few words stay different', () => {
  const c = detectChorus([L('walking down the road tonight'), L('walking down the street today')]);
  assert.equal(c[0].chorus, false);
});

test('no lines is fine', () => {
  assert.deepEqual(detectChorus([]), []);
});
