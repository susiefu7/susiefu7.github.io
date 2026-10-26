// Keeps editorial comments attached to their passages as the text is revised.
// Anchors store the quoted text plus a little surrounding context (in the manner of
// a W3C TextQuoteSelector) and the last known offsets.

import type { AnchorState, TextAnchor } from './types.ts';

const CONTEXT = 48;

export function createAnchor(text: string, start: number, end: number): TextAnchor {
  const s = Math.max(0, Math.min(start, end, text.length));
  const e = Math.min(text.length, Math.max(start, end));
  return {
    start: s,
    end: e,
    exact: text.slice(s, e),
    prefix: text.slice(Math.max(0, s - CONTEXT), s),
    suffix: text.slice(e, e + CONTEXT),
  };
}

export interface ReanchorResult {
  anchor: TextAnchor;
  state: AnchorState;
}

function allIndexesOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    found.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return found;
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** How well the text around a candidate position matches the anchor's stored context. */
function contextScore(text: string, anchor: TextAnchor, at: number): number {
  const before = text.slice(Math.max(0, at - CONTEXT), at);
  const after = text.slice(at + anchor.exact.length, at + anchor.exact.length + CONTEXT);
  return commonSuffixLength(before, anchor.prefix) + commonPrefixLength(after, anchor.suffix);
}

/** Locate the anchor in a revised text. Never throws; worst case is "detached". */
export function reanchor(anchor: TextAnchor, text: string): ReanchorResult {
  const { exact } = anchor;

  // 1. Unchanged in place.
  if (exact && text.slice(anchor.start, anchor.end) === exact) {
    return { anchor: createAnchor(text, anchor.start, anchor.end), state: 'anchored' };
  }

  // 2. The same words exist elsewhere.
  const hits = allIndexesOf(text, exact);
  if (hits.length > 0) {
    const scored = hits
      .map((at) => ({ at, score: contextScore(text, anchor, at), distance: Math.abs(at - anchor.start) }))
      .sort((a, b) => b.score - a.score || a.distance - b.distance);
    const best = scored[0];
    const runnerUp = scored[1];
    const maxScore = anchor.prefix.length + anchor.suffix.length;
    const unique = hits.length === 1;
    const clearWinner = !runnerUp || best.score >= runnerUp.score + 8;
    const strongContext = maxScore === 0 || best.score >= Math.min(12, maxScore);
    const state: AnchorState = unique || (clearWinner && strongContext) ? 'relocated' : 'uncertain';
    return { anchor: createAnchor(text, best.at, best.at + exact.length), state };
  }

  // 3. The passage itself was edited: look for its opening and closing words, or its context.
  const edge = Math.min(24, Math.floor(exact.length / 3));
  if (edge >= 8) {
    const heads = allIndexesOf(text, exact.slice(0, edge));
    const tails = allIndexesOf(text, exact.slice(exact.length - edge));
    const candidates: { start: number; end: number; distance: number }[] = [];
    for (const h of heads) {
      for (const t of tails) {
        const end = t + edge;
        if (end > h && end - h <= exact.length * 2 + 200) {
          candidates.push({ start: h, end, distance: Math.abs(h - anchor.start) });
        }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    if (candidates[0]) {
      return { anchor: createAnchor(text, candidates[0].start, candidates[0].end), state: 'uncertain' };
    }
  }
  const pre = anchor.prefix.slice(-24);
  const suf = anchor.suffix.slice(0, 24);
  if (pre.length >= 12 && suf.length >= 12) {
    for (const p of allIndexesOf(text, pre)) {
      const from = p + pre.length;
      const s = text.indexOf(suf, from);
      if (s !== -1 && s - from <= exact.length * 2 + 200 && s > from) {
        return { anchor: createAnchor(text, from, s), state: 'uncertain' };
      }
    }
  }

  // 4. Lost. Keep the stored quote; clamp offsets so the UI never points past the end.
  const start = Math.min(anchor.start, text.length);
  return { anchor: { ...anchor, start, end: start }, state: 'detached' };
}

const SEVERITY: Record<AnchorState, number> = { anchored: 0, relocated: 1, uncertain: 2, detached: 3 };

/**
 * Flags are sticky: once a comment's position has been uncertain, it stays flagged
 * until the author confirms or re-attaches it — a later save can't clear it silently.
 */
export function stickierState(previous: AnchorState, computed: AnchorState): AnchorState {
  // A lost passage that turns up again still needs the author's confirmation.
  if (previous === 'detached' && computed !== 'detached') return 'uncertain';
  return SEVERITY[computed] >= SEVERITY[previous] ? computed : previous;
}
