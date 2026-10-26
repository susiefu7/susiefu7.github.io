// Plain-text helpers shared by server and client: word counts, scene detection and a
// small manuscript tokenizer that keeps exact source offsets, so a selection made in
// the rendered reading view maps back to precise characters in the Markdown file.

import type { Scene } from './types.ts';

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** Lines that separate scenes: "***", "* * *", "---", "#", "§". */
export const SCENE_BREAK = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|#|§)\s*$/;
const SCENE_HEADING = /^(#{2,3})\s+(.+?)\s*#*\s*$/;
const CHAPTER_HEADING = /^#\s+(.+?)\s*#*\s*$/;

interface Line {
  text: string;
  start: number;
  end: number; // exclusive, not including the newline
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl;
    lines.push({ text: text.slice(start, end).replace(/\r$/, ''), start, end });
    if (nl === -1) break;
    start = nl + 1;
  }
  return lines;
}

/**
 * Scenes begin at a level-2/3 heading or after a scene-break line. Text before the
 * first marker is the first scene. Empty scenes are skipped.
 */
export function parseScenes(text: string): Scene[] {
  const raw: { title: string | null; start: number; end: number }[] = [];
  let current = { title: null as string | null, start: 0, end: text.length };
  for (const line of splitLines(text)) {
    const heading = SCENE_HEADING.exec(line.text);
    if (heading || SCENE_BREAK.test(line.text)) {
      current.end = line.start;
      raw.push(current);
      current = {
        title: heading ? heading[2] : null,
        start: heading ? line.start : Math.min(text.length, line.end + 1),
        end: text.length,
      };
    }
  }
  raw.push(current);

  const scenes: Scene[] = [];
  for (const r of raw) {
    while (r.start < r.end && /\s/.test(text[r.start])) r.start++;
    const body = text.slice(r.start, r.end);
    const bodyWithoutChapterHeading = body
      .split('\n')
      .filter((l) => !CHAPTER_HEADING.test(l) && !SCENE_HEADING.test(l))
      .join('\n');
    const words = countWords(bodyWithoutChapterHeading);
    if (words === 0 && !r.title) continue;
    let title = r.title;
    if (!title) {
      const opening = bodyWithoutChapterHeading.match(WORD)?.slice(0, 7).join(' ') ?? '';
      title = opening ? `${opening}…` : 'Untitled scene';
    }
    scenes.push({ index: scenes.length + 1, title, start: r.start, end: r.end, wordCount: words });
  }
  return scenes;
}

// ── Manuscript tokenizer ────────────────────────────────────────────────────

export interface InlineRun {
  text: string; // an exact, contiguous slice of the source
  start: number; // absolute source offset of text[0]
  italic: boolean;
  bold: boolean;
}

export type BlockKind = 'paragraph' | 'heading' | 'chapter-heading' | 'scene-break' | 'quote';

export interface Block {
  kind: BlockKind;
  level: number;
  start: number;
  end: number;
  runs: InlineRun[];
}

const INLINE = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(\*|_)(?=\S)([\s\S]*?\S)\3/g;

/** Splits a source span into styled runs. Marker characters are omitted; offsets stay exact. */
export function parseInline(source: string, from: number, to: number, italic = false, bold = false): InlineRun[] {
  const runs: InlineRun[] = [];
  const slice = source.slice(from, to);
  INLINE.lastIndex = 0;
  let cursor = 0;
  const matches = [...slice.matchAll(INLINE)];
  for (const m of matches) {
    const at = m.index ?? 0;
    if (at > cursor) runs.push({ text: slice.slice(cursor, at), start: from + cursor, italic, bold });
    const isBold = Boolean(m[1]);
    const marker = isBold ? m[1] : m[3];
    const inner = isBold ? m[2] : m[4];
    const innerStart = from + at + marker.length;
    runs.push(
      ...parseInline(source, innerStart, innerStart + inner.length, italic || !isBold, bold || isBold),
    );
    cursor = at + m[0].length;
  }
  if (cursor < slice.length) runs.push({ text: slice.slice(cursor), start: from + cursor, italic, bold });
  return runs.filter((r) => r.text.length > 0);
}

/** Splits a chapter into display blocks separated by blank lines. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = splitLines(text);
  let group: Line[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const first = group[0];
    const start = first.start;
    const end = group[group.length - 1].end;
    const h1 = group.length === 1 ? CHAPTER_HEADING.exec(first.text) : null;
    const h = group.length === 1 ? SCENE_HEADING.exec(first.text) : null;
    if (group.length === 1 && SCENE_BREAK.test(first.text)) {
      blocks.push({ kind: 'scene-break', level: 0, start, end, runs: [] });
    } else if (h1) {
      const offset = first.text.indexOf(h1[1]);
      blocks.push({
        kind: 'chapter-heading',
        level: 1,
        start,
        end,
        runs: parseInline(text, start + offset, start + offset + h1[1].length),
      });
    } else if (h) {
      const offset = first.text.indexOf(h[2], h[1].length);
      blocks.push({
        kind: 'heading',
        level: h[1].length,
        start,
        end,
        runs: parseInline(text, start + offset, start + offset + h[2].length),
      });
    } else if (group.every((l) => /^\s*>/.test(l.text))) {
      const runs: InlineRun[] = [];
      group.forEach((l, i) => {
        const prefix = /^\s*>\s?/.exec(l.text)![0].length;
        if (i > 0) runs.push({ text: '\n', start: l.start - 1, italic: false, bold: false });
        runs.push(...parseInline(text, l.start + prefix, l.end));
      });
      blocks.push({ kind: 'quote', level: 0, start, end, runs });
    } else {
      blocks.push({ kind: 'paragraph', level: 0, start, end, runs: parseInline(text, start, end) });
    }
    group = [];
  };

  for (const line of lines) {
    if (line.text.trim() === '') flush();
    else if (SCENE_BREAK.test(line.text) || SCENE_HEADING.test(line.text) || CHAPTER_HEADING.test(line.text)) {
      flush();
      group.push(line);
      flush();
    } else group.push(line);
  }
  flush();
  return blocks;
}

export interface HighlightRange {
  id: string;
  start: number;
  end: number;
}

export interface RunSegment {
  text: string;
  start: number;
  italic: boolean;
  bold: boolean;
  ids: string[]; // comment ids covering this segment
}

/** Cuts runs at range boundaries so highlighted passages can be wrapped in <mark>. */
export function segmentRuns(runs: InlineRun[], ranges: HighlightRange[]): RunSegment[] {
  const out: RunSegment[] = [];
  for (const run of runs) {
    const runEnd = run.start + run.text.length;
    const cuts = new Set<number>([run.start, runEnd]);
    for (const r of ranges) {
      if (r.start > run.start && r.start < runEnd) cuts.add(r.start);
      if (r.end > run.start && r.end < runEnd) cuts.add(r.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const ids = ranges.filter((r) => r.start < b && r.end > a).map((r) => r.id);
      out.push({ text: run.text.slice(a - run.start, b - run.start), start: a, italic: run.italic, bold: run.bold, ids });
    }
  }
  return out;
}
