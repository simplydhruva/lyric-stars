import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, lineIndexAt } from '../web/js/lyrics/lrc.js';

test('parses timestamps with 2- and 3-digit fractions', () => {
  const lines = parseLrc('[00:01.50]one\n[00:02.250]two\n[01:03]three');
  assert.deepEqual(lines.map((l) => l.time), [1500, 2250, 63000]);
  assert.deepEqual(lines.map((l) => l.text), ['one', 'two', 'three']);
});

test('ignores metadata, keeps empty gap lines, sorts', () => {
  const lines = parseLrc('[ar:Someone]\n[ti:Song]\n[00:05.00]later\n[00:01.00]first\n[00:03.00]');
  assert.deepEqual(lines, [
    { time: 1000, text: 'first' },
    { time: 3000, text: '' },
    { time: 5000, text: 'later' },
  ]);
});

test('expands repeated timestamps on one line', () => {
  const lines = parseLrc('[00:01.00][00:10.00]chorus');
  assert.deepEqual(lines.map((l) => l.time), [1000, 10000]);
});

test('applies offset tag (positive shows lyrics earlier)', () => {
  const lines = parseLrc('[offset:+500]\n[00:02.00]x');
  assert.equal(lines[0].time, 1500);
});

test('strips enhanced word tags from text', () => {
  const lines = parseLrc('[00:01.00]<00:01.00>Look <00:01.40>at <00:01.70>the');
  assert.equal(lines[0].text, 'Look at the');
});

test('lineIndexAt finds the active line', () => {
  const lines = parseLrc('[00:01.00]a\n[00:02.00]b\n[00:03.00]c');
  assert.equal(lineIndexAt(lines, 500), -1);
  assert.equal(lineIndexAt(lines, 1000), 0);
  assert.equal(lineIndexAt(lines, 2999), 1);
  assert.equal(lineIndexAt(lines, 99999), 2);
});

test('parseLrc reads enhanced word tags', () => {
  const lines = parseLrc('[00:10.00]<00:10.00>Look <00:10.50>at the <00:11.20>stars<00:12.00>\n[00:13.00]plain line');
  assert.equal(lines[0].text, 'Look at the stars');
  assert.deepEqual(lines[0].words.map((w) => [w.text, w.start]), [
    ['Look', 10000], ['at', 10500], ['the', 10850], ['stars', 11200],
  ]);
  assert.equal(lines[0].wordsEnd, 12000);
  assert.equal(lines[1].words, undefined);
});

test('parseLrc applies [offset:] to word tags', () => {
  const lines = parseLrc('[offset:500]\n[00:10.00]<00:10.00>a <00:11.00>b');
  assert.equal(lines[0].time, 9500);
  assert.deepEqual(lines[0].words.map((w) => w.start), [9500, 10500]);
});
