// Renders reference documents (canon, directives …) as read-only HTML, block by block,
// keeping each block's starting line so citations can scroll to the right place.

import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: false });
// Reference files are the author's own, but raw HTML is shown as text, never executed.
marked.use({
  renderer: {
    html({ text }) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  },
});

export interface RenderedBlock {
  line: number; // 1-based line where the block starts
  html: string;
}

export function renderReference(source: string): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  let line = 1;
  const tokens = marked.lexer(source);
  for (const token of tokens) {
    if (token.type !== 'space') {
      // Keep the document's link definitions so reference-style links still resolve.
      blocks.push({ line, html: marked.parser(Object.assign([token], { links: tokens.links })) });
    }
    line += (token.raw.match(/\n/g) ?? []).length;
  }
  return blocks;
}
