// Side-by-side comparison model. Paragraphs are aligned first, then changed
// paragraph pairs are compared word by word, so a revised sentence reads as a
// change to that sentence rather than as a deleted and an inserted block.

import { diffArrays, diffWordsWithSpace } from 'diff';
import { countWords } from './text.ts';

export interface DiffSegment {
  text: string;
  type: 'same' | 'ins' | 'del';
}

export type DiffRowKind = 'same' | 'changed' | 'added' | 'removed';

export interface DiffRow {
  kind: DiffRowKind;
  left: DiffSegment[] | null;
  right: DiffSegment[] | null;
}

export interface DiffStats {
  wordsAdded: number;
  wordsRemoved: number;
  paragraphsChanged: number;
  paragraphsAdded: number;
  paragraphsRemoved: number;
}

export interface DiffResult {
  rows: DiffRow[];
  stats: DiffStats;
  identical: boolean;
}

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function similarity(a: string, b: string): number {
  const parts = diffWordsWithSpace(a, b);
  let same = 0;
  for (const p of parts) if (!p.added && !p.removed) same += countWords(p.value);
  const total = Math.max(countWords(a), countWords(b), 1);
  return same / total;
}

function wordRow(a: string, b: string, stats: DiffStats): DiffRow {
  const left: DiffSegment[] = [];
  const right: DiffSegment[] = [];
  for (const part of diffWordsWithSpace(a, b)) {
    if (part.added) {
      right.push({ text: part.value, type: 'ins' });
      stats.wordsAdded += countWords(part.value);
    } else if (part.removed) {
      left.push({ text: part.value, type: 'del' });
      stats.wordsRemoved += countWords(part.value);
    } else {
      left.push({ text: part.value, type: 'same' });
      right.push({ text: part.value, type: 'same' });
    }
  }
  stats.paragraphsChanged++;
  return { kind: 'changed', left, right };
}

/** Pairs removed and added paragraphs that are recognisably the same paragraph, in order. */
function alignRun(removed: string[], added: string[], stats: DiffStats): DiffRow[] {
  const rows: DiffRow[] = [];
  let j = 0;
  for (let i = 0; i < removed.length; i++) {
    let match = -1;
    for (let k = j; k < Math.min(added.length, j + 4); k++) {
      if (similarity(removed[i], added[k]) >= 0.35) {
        match = k;
        break;
      }
    }
    if (match === -1) {
      rows.push({ kind: 'removed', left: [{ text: removed[i], type: 'del' }], right: null });
      stats.paragraphsRemoved++;
      stats.wordsRemoved += countWords(removed[i]);
      continue;
    }
    for (; j < match; j++) {
      rows.push({ kind: 'added', left: null, right: [{ text: added[j], type: 'ins' }] });
      stats.paragraphsAdded++;
      stats.wordsAdded += countWords(added[j]);
    }
    rows.push(wordRow(removed[i], added[match], stats));
    j = match + 1;
  }
  for (; j < added.length; j++) {
    rows.push({ kind: 'added', left: null, right: [{ text: added[j], type: 'ins' }] });
    stats.paragraphsAdded++;
    stats.wordsAdded += countWords(added[j]);
  }
  return rows;
}

export function compareTexts(oldText: string, newText: string): DiffResult {
  const stats: DiffStats = { wordsAdded: 0, wordsRemoved: 0, paragraphsChanged: 0, paragraphsAdded: 0, paragraphsRemoved: 0 };
  const rows: DiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length || added.length) rows.push(...alignRun(removed, added, stats));
    removed = [];
    added = [];
  };
  for (const change of diffArrays(splitParagraphs(oldText), splitParagraphs(newText))) {
    if (change.removed) removed.push(...change.value);
    else if (change.added) added.push(...change.value);
    else {
      flush();
      for (const p of change.value) {
        rows.push({ kind: 'same', left: [{ text: p, type: 'same' }], right: [{ text: p, type: 'same' }] });
      }
    }
  }
  flush();
  return { rows, stats, identical: rows.every((r) => r.kind === 'same') };
}
