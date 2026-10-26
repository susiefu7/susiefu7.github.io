// Assembles the material an AI editor may consult, in order of authority.

import path from 'node:path';
import { readDraft, readMeta } from '../chapters.ts';
import { walkFiles } from '../fsutil.ts';
import { AUTHORITY_ORDER, LAYER_DIRS, type Project } from '../project.ts';
import { READABLE_EXT, readableText } from '../reference.ts';
import type { ContextExcerpt, EditorialContext } from './types.ts';

export const GROUND_RULES = [
  'You are advising the author. Propose; never decide. Every suggestion needs your reasoning.',
  'Author directives outrank canon; canon outranks approved chapters; drafts and working ideas are not established fact.',
  'Legacy chapters come from an earlier development of the novel and do not govern the current draft.',
  'The novel is being redeveloped: historical chapter summaries and continuity records describe the earlier version and are not binding.',
  'If the supplied material does not establish a fact, say that it is not established. Do not invent canon.',
  'Quote the source file for every factual claim about the story world.',
];

export async function buildContext(
  project: Project,
  chapterId: string,
  options: { includeLegacy?: boolean; includeIdeas?: boolean; includeHistorical?: boolean } = {},
): Promise<EditorialContext> {
  const layers = [
    ...AUTHORITY_ORDER,
    ...(options.includeIdeas ? (['idea'] as const) : []),
    ...(options.includeHistorical ? (['historical'] as const) : []),
    ...(options.includeLegacy ? (['legacy'] as const) : []),
  ];
  const excerpts: ContextExcerpt[] = [];
  for (const [authority, layer] of layers.entries()) {
    for (const abs of await walkFiles(project.abs(LAYER_DIRS[layer]!))) {
      if (!READABLE_EXT.test(abs)) continue;
      excerpts.push({ file: path.relative(project.root, abs), layer, authority, text: (await readableText(abs)).text });
    }
  }
  const meta = await readMeta(project, chapterId);
  return { chapterId, chapterTitle: meta.title, draft: await readDraft(project, chapterId), excerpts, groundRules: GROUND_RULES };
}
