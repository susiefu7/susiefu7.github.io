// Reads editorial notes out of a reply pasted from Claude.ai, ChatGPT or another
// assistant. The request asks for blocks like:
//
//   NOTE
//   Type: dialogue
//   Passage: the exact words
//   Note: …
//   Reasoning: …
//   Suggested rewrite: … (optional)
//   END NOTE
//
// Chat apps often add bold labels, bullets or headings; those are tolerated.

import type { CommentCategory } from './types.ts';
import { COMMENT_CATEGORIES } from './types.ts';

export interface ParsedNote {
  category: CommentCategory;
  passage: string;
  note: string;
  reasoning: string;
  suggestedRewrite: string | null;
}

const FIELDS: Record<string, keyof Omit<ParsedNote, 'category'> | 'category'> = {
  type: 'category',
  category: 'category',
  passage: 'passage',
  quote: 'passage',
  note: 'note',
  comment: 'note',
  reasoning: 'reasoning',
  why: 'reasoning',
  'suggested rewrite': 'suggestedRewrite',
  rewrite: 'suggestedRewrite',
};

const START = /^\s*(?:[#>*_\-\s]*)NOTE(?:\s*\d+)?\s*[*_:]*\s*$/i;
const END = /^\s*(?:[#>*_\-\s]*)END\s+NOTE\b/i;
const FIELD = /^\s*(?:[-*>]\s*)?(?:\*\*|__)?\s*(type|category|passage|quote|note|comment|reasoning|why|suggested rewrite|rewrite)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i;

/** Remove quotation marks only when they wrap the whole value (dialogue keeps its own). */
function unquote(s: string): string {
  const t = s.trim();
  const m = /^["“]([\s\S]*)["”]$/.exec(t);
  return m && !/["“”]/.test(m[1]) ? m[1].trim() : t;
}

export function parseAiReply(reply: string): ParsedNote[] {
  const notes: ParsedNote[] = [];
  let current: Record<string, string> | null = null;
  let field: string | null = null;

  const finish = () => {
    if (current && (current.passage?.trim() || current.note?.trim())) {
      const raw = (current.category ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
      const category = (COMMENT_CATEGORIES as string[]).includes(raw) ? (raw as CommentCategory) : 'developmental';
      const rewrite = current.suggestedRewrite ? unquote(current.suggestedRewrite) : '';
      notes.push({
        category,
        passage: unquote(current.passage ?? ''),
        note: (current.note ?? '').trim(),
        reasoning: (current.reasoning ?? '').trim(),
        suggestedRewrite: rewrite && !/^(none|n\/a|-|\(none\)|\(optional\))$/i.test(rewrite) ? rewrite : null,
      });
    }
    current = null;
    field = null;
  };

  for (const line of reply.replace(/\r\n?/g, '\n').split('\n')) {
    if (END.test(line)) {
      finish();
      continue;
    }
    if (START.test(line)) {
      finish();
      current = {};
      continue;
    }
    if (!current) continue;
    const m = FIELD.exec(line);
    if (m) {
      field = FIELDS[m[1].toLowerCase()];
      current[field] = m[2].replace(/\*\*$/, '');
    } else if (field) {
      current[field] += `\n${line}`;
    }
  }
  finish();
  return notes;
}
