// Builds a self-contained request to paste into Claude.ai, ChatGPT or another
// assistant: ground rules, the task, the reply format, the chapter, and the
// directives and canon (historical and legacy material is left out: it doesn't govern).

import type { ChapterDocument, Layer, Redevelopment } from '../shared/types';

export type AiTask = 'review' | 'rewrite' | 'continuity' | 'chapter';

export const AI_TASKS: { id: AiTask; label: string; needsPassage: boolean; brief: string }[] = [
  {
    id: 'review',
    label: 'Review the selected passage',
    needsPassage: true,
    brief: 'Review the focus passage: prose, rhythm, dialogue, pacing and character psychology. Point to specific words. Be candid but constructive.',
  },
  {
    id: 'rewrite',
    label: 'Suggest rewrites for the selected passage',
    needsPassage: true,
    brief:
      'Suggest targeted rewrites for the focus passage, in the author’s voice and the style guide. Keep each rewrite to the sentence or two it replaces, and explain what it improves.',
  },
  {
    id: 'continuity',
    label: 'Check continuity against canon',
    needsPassage: false,
    brief:
      'Check the text against the directives and canon below for contradictions in names, facts, timeline, relationships and established details. Only report real conflicts, citing the reference file. If something is not established either way, say so rather than guessing.',
  },
  {
    id: 'chapter',
    label: 'Developmental review of the whole chapter',
    needsPassage: false,
    brief:
      'Give a developmental review of the whole chapter: structure, scene purpose, pacing, character arcs and how it serves the novel. Attach each point to the passage that best shows it.',
  },
];

export interface ReferenceText {
  path: string;
  layer: Layer;
  content: string;
}

const REFERENCE_BUDGET = 300_000; // characters; beyond this, files are listed rather than included

export function buildAiRequest(input: {
  projectTitle: string;
  redevelopment: Redevelopment | null;
  doc: ChapterDocument;
  task: AiTask;
  instruction: string;
  passage: string | null;
  references: ReferenceText[];
}): { text: string; omitted: string[] } {
  const { doc, task } = input;
  const brief = AI_TASKS.find((t) => t.id === task)!.brief;
  const standing = doc.approval ? (doc.draftMatchesApproved ? 'approved' : 'approved earlier; the draft has changed since') : 'WORKING DRAFT — not approved canon';

  const parts: (string | null)[] = [
    `You are an editor working with the author of a literary novel, “${input.projectTitle}”.`,
    '',
    'Ground rules:',
    '- Propose; never decide. The author makes every change.',
    '- Order of authority: author directives, then canon. Working drafts are not established fact.',
    input.redevelopment?.active ? `- The novel is being redeveloped: ${input.redevelopment.note}` : null,
    '- If the material below does not establish a fact, say it is not established. Never invent canon.',
    '- Give your reasoning for every note, citing reference files where relevant.',
    '',
    `TASK: ${brief}`,
    input.instruction.trim() ? `Author’s instruction: ${input.instruction.trim()}` : null,
    '',
    'REPLY FORMAT. Write each note exactly like this so it can be imported into the editorial workspace:',
    '',
    'NOTE',
    'Type: one of developmental, character, continuity, pacing, dialogue, prose',
    'Passage: the exact words from the chapter the note is about (one or two sentences, copied exactly)',
    'Note: your observation, addressed to the author',
    'Reasoning: why',
    'Suggested rewrite: (optional) replacement for exactly the words in Passage',
    'END NOTE',
    '',
    'You may begin with a short overall comment. Do not rewrite the whole chapter.',
    '',
    `=== CHAPTER ${doc.meta.number}: ${doc.meta.title} (${standing}) ===`,
    doc.text.trim() || '(empty)',
  ];
  if (input.passage) parts.push('', '=== FOCUS PASSAGE (from the chapter above) ===', input.passage);

  const omitted: string[] = [];
  let used = 0;
  const sections: [Layer, string][] = [
    ['directive', 'AUTHOR DIRECTIVES (highest authority)'],
    ['canon', 'LOCKED CANON'],
  ];
  for (const [layer, title] of sections) {
    const files = input.references.filter((r) => r.layer === layer);
    if (!files.length) continue;
    parts.push('', `=== REFERENCE: ${title} ===`);
    for (const f of files) {
      if (used + f.content.length > REFERENCE_BUDGET) {
        omitted.push(f.path);
        continue;
      }
      used += f.content.length;
      parts.push(`--- ${f.path} ---`, f.content.trim());
    }
  }
  if (omitted.length) parts.push('', `(Not included for length: ${omitted.join(', ')}.)`);
  if (!input.references.some((r) => r.layer === 'canon' || r.layer === 'directive')) {
    parts.push('', '(No canon or directives are in the reference library yet. Treat nothing as established beyond the chapter itself.)');
  }
  return { text: parts.filter((p) => p !== null).join('\n'), omitted };
}
