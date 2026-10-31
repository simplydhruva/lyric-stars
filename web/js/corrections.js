// The user's own timings for a track: words tapped or dragged in the editor,
// or an imported file. They are stored per track and exported in the same
// format the timing harness reads as reference songs.
import { parseLrc } from './lyrics/lrc.js';
import { splitWords } from './timing.js';

export const FORMAT = 'lyricstars-timings';

export function key(track) {
  return `timings:${track.key}`;
}

// A blank record for the current lyrics.
export function create(track, lines, { recordId = null, ownLyrics = false } = {}) {
  return {
    format: FORMAT,
    version: 1,
    track: { title: track.title, artist: track.artist, album: track.album || '', durationMs: track.durationMs || 0 },
    recordId,
    ownLyrics, // true when the lyrics themselves came from the user
    lines: lines.map((l) => ({ time: l.time, text: l.text })),
  };
}

const sameText = (a, b) => a.length === b.length && a.every((l, i) => l.text === b[i].text);

// Combines found lyrics with the user's timings.
// Returns the lines to build the timeline from, or null when the timings belong to other lyrics.
export function apply(lines, record) {
  if (!record?.lines?.length) return lines;
  if (record.ownLyrics) return record.lines.map(copyLine);
  if (!lines || !sameText(lines, record.lines)) return null;
  return lines.map((l, i) => {
    const r = record.lines[i];
    return r.words?.length ? { ...copyLine(r), time: l.time } : l;
  });
}

function copyLine(l) {
  const out = { time: l.time, text: l.text };
  if (l.words?.length) {
    out.words = l.words.map((w) => ({ text: w.text, start: w.start }));
    out.timing = l.timing || 'yours';
  }
  if (l.wordsEnd != null) out.wordsEnd = l.wordsEnd;
  return out;
}

// Sets one line's word starts (all of them, in order). Returns a new record.
export function setLineWords(record, index, starts) {
  const lines = record.lines.map((l, i) => {
    if (i !== index) return l;
    const words = splitWords(l.text).map((text, k) => ({ text, start: Math.round(starts[k]) }));
    return { time: l.time, text: l.text, words, timing: 'yours' };
  });
  return { ...record, lines };
}

export function clearLine(record, index) {
  return { ...record, lines: record.lines.map((l, i) => (i === index ? { time: l.time, text: l.text } : l)) };
}

export function timedLineCount(record) {
  return record?.lines?.filter((l) => l.words?.length).length || 0;
}

// ---- export / import ---------------------------------------------------------

export function toJson(record) {
  return JSON.stringify(record, null, 1);
}

export function fileName(track, ext) {
  const safe = `${track.artist} - ${track.title}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  return `${safe || 'timings'}.${ext}`;
}

// Enhanced LRC with the user's word times; lines without them keep plain line times.
export function toLrc(record) {
  const stamp = (ms) => {
    const t = Math.max(0, Math.round(ms / 10));
    return `${String(Math.floor(t / 6000)).padStart(2, '0')}:${String(Math.floor(t / 100) % 60).padStart(2, '0')}.${String(t % 100).padStart(2, '0')}`;
  };
  const head = [`[ti:${record.track.title}]`, `[ar:${record.track.artist}]`];
  if (record.track.album) head.push(`[al:${record.track.album}]`);
  const body = record.lines.map((l) =>
    l.words?.length
      ? `[${stamp(l.time)}]${l.words.map((w) => `<${stamp(w.start)}>${w.text}`).join(' ')}`
      : `[${stamp(l.time)}]${l.text}`
  );
  return [...head, ...body].join('\n') + '\n';
}

export class ImportError extends Error {}

// Accepts our JSON export or an LRC file (plain or enhanced) for the current track.
export function parseImport(text, track, currentLines) {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (trimmed.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new ImportError('That file is not valid JSON.');
    }
    if (data.format !== FORMAT || !Array.isArray(data.lines)) throw new ImportError('That is not a Lyric Stars timings file.');
    const lines = data.lines
      .filter((l) => Number.isFinite(l.time) && typeof l.text === 'string')
      .map((l) => {
        const out = { time: l.time, text: l.text };
        const words = Array.isArray(l.words) ? l.words.filter((w) => typeof w.text === 'string' && Number.isFinite(w.start)) : [];
        if (words.length && words.length === splitWords(l.text).length) {
          out.words = words.map((w) => ({ text: w.text, start: w.start }));
          out.timing = 'yours';
        }
        return out;
      })
      .sort((a, b) => a.time - b.time);
    if (!lines.length) throw new ImportError('That timings file has no lines.');
    // Timings for the same lyrics merge in; anything else is treated as the user's own lyrics.
    const ownLyrics = data.ownLyrics || !currentLines || !sameText(currentLines, lines);
    return { ...create(track, lines, { recordId: data.recordId ?? null, ownLyrics }), lines, offsetMs: data.offsetMs };
  }
  const lines = parseLrc(trimmed);
  if (!lines.some((l) => l.text)) throw new ImportError('No timed lyric lines found. LRC lines look like [01:23.45] words.');
  for (const l of lines) if (l.words?.length) l.timing = 'word';
  return { ...create(track, lines, { ownLyrics: true }), lines };
}
