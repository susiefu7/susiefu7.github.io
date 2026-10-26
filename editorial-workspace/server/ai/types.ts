// Contract for a future AI editor. Nothing in the MVP depends on an implementation.
//
// Rules every implementation must follow (enforced by the surrounding code, not by trust):
//  - It only ever returns suggestions. It has no write access to the project.
//  - Suggestions become EditorialComments with role "ai", a category, reasoning and,
//    optionally, suggestedText. They are applied only through acceptSuggestion(),
//    which snapshots the draft first (version kind "pre-ai").
//  - Its context comes from buildContext(), which orders material by authority and
//    labels every excerpt with its layer. Legacy text is excluded unless requested.
//  - When the context does not establish a fact, it must say so rather than invent one.

import type { CommentCategory, Layer } from '../../shared/types.ts';

export interface ContextExcerpt {
  file: string;
  layer: Layer;
  /** Lower is more authoritative: directive < canon < approved < draft < idea < legacy. */
  authority: number;
  text: string;
}

export interface EditorialContext {
  chapterId: string;
  chapterTitle: string;
  draft: string;
  excerpts: ContextExcerpt[];
  /** Plain-language rules sent with every request. */
  groundRules: string[];
}

export type ReviewFocus = CommentCategory | 'psychology' | 'compare-scenes';

export interface PassageRequest {
  chapterId: string;
  start: number;
  end: number;
  focus: ReviewFocus[];
  instruction?: string;
}

export interface AISuggestion {
  category: CommentCategory;
  start: number;
  end: number;
  body: string; // the editorial observation
  reasoning: string; // why — always required
  suggestedText: string | null; // optional targeted rewrite of [start, end)
  citedSources: { file: string; excerpt: string }[];
}

export interface EditorialAssistant {
  readonly name: string;
  readonly available: boolean;
  reviewPassage(context: EditorialContext, request: PassageRequest): Promise<AISuggestion[]>;
  suggestRewrite(context: EditorialContext, request: PassageRequest): Promise<AISuggestion[]>;
  checkContinuity(context: EditorialContext): Promise<AISuggestion[]>;
  compareScenes(context: EditorialContext, a: { start: number; end: number }, b: { start: number; end: number }): Promise<string>;
}
