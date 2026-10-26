// Converts pasted prose to the workspace's Markdown, keeping paragraphs, italics and
// bold from Word, Google Docs, Pages, web pages and plain-text sources.

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TR', 'SECTION', 'ARTICLE', 'PRE']);
const SKIP = new Set(['STYLE', 'SCRIPT', 'META', 'TITLE', 'HEAD', 'XML', 'TEMPLATE']);

interface Fmt {
  italic: boolean;
  bold: boolean;
}

interface Run extends Fmt {
  text: string;
}

function formatOf(el: HTMLElement, inherited: Fmt): Fmt {
  let { italic, bold } = inherited;
  const tag = el.tagName;
  if (tag === 'I' || tag === 'EM' || tag === 'CITE') italic = true;
  if (tag === 'B' || tag === 'STRONG') bold = true;
  // Text copied from this workspace's own reading view carries its emphasis as classes.
  if (el.classList.contains('seg')) {
    if (el.classList.contains('i')) italic = true;
    if (el.classList.contains('b')) bold = true;
  }
  const style = el.getAttribute('style') ?? '';
  const fs = /font-style\s*:\s*(\w+)/i.exec(style)?.[1]?.toLowerCase();
  if (fs) italic = fs === 'italic' || fs === 'oblique';
  const fw = /font-weight\s*:\s*(\w+)/i.exec(style)?.[1]?.toLowerCase();
  // Google Docs wraps everything in <b style="font-weight:normal">, so style wins over tag.
  if (fw) bold = fw === 'bold' || fw === 'bolder' || Number(fw) >= 600;
  return { italic, bold };
}

/** Same rules as the .docx reader: spaces stay outside markers; bold italic is _**…**_. */
function emphasise(run: Run): string {
  if (!run.italic && !run.bold) return run.text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!;
  if (!m[2]) return run.text;
  const inner = run.bold && run.italic ? `_**${m[2]}**_` : run.bold ? `**${m[2]}**` : `*${m[2]}*`;
  return `${m[1]}${inner}${m[3]}`;
}

/** Returns Markdown, or null if the HTML holds no usable text. */
export function htmlToMarkdown(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: string[] = [];
  let runs: Run[] = [];

  const push = (text: string, fmt: Fmt) => {
    const last = runs[runs.length - 1];
    if (last && last.italic === fmt.italic && last.bold === fmt.bold) last.text += text;
    else runs.push({ text, ...fmt });
  };

  const flush = (prefix = '') => {
    const text = runs
      .map((r) => ({ ...r, text: r.text.replace(/[ \t ]+/g, ' ') }))
      .map(emphasise)
      .join('')
      .replace(/ *\n */g, '\n')
      .trim();
    if (text) blocks.push(prefix + text);
    runs = [];
  };

  const walk = (node: Node, fmt: Fmt) => {
    if (node.nodeType === Node.TEXT_NODE) {
      push((node.textContent ?? '').replace(/\s+/g, ' '), fmt);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (SKIP.has(el.tagName)) return;
    if (el.tagName === 'BR') {
      push('\n', { italic: false, bold: false });
      return;
    }
    if (el.tagName === 'HR') {
      flush();
      blocks.push('* * *');
      return;
    }
    const isBlock = BLOCK.has(el.tagName);
    if (isBlock) flush();
    const next = formatOf(el, fmt);
    el.childNodes.forEach((c) => walk(c, next));
    if (isBlock) {
      const level = /^H([1-3])$/.exec(el.tagName)?.[1];
      flush(level ? `${'#'.repeat(Number(level) + 1)} ` : el.tagName === 'LI' ? '- ' : el.tagName === 'BLOCKQUOTE' ? '> ' : '');
    }
  };

  walk(doc.body, { italic: false, bold: false });
  flush();
  const md = blocks.join('\n\n');
  return md.trim() ? md : null;
}

/** Plain text with one line per paragraph becomes blank-line-separated paragraphs. */
export function plainTextToMarkdown(text: string): string {
  const unix = text.replace(/\r\n?/g, '\n');
  const trimmed = unix.trim();
  if (trimmed.includes('\n') && !/\n[ \t]*\n/.test(trimmed)) return trimmed.split('\n').map((l) => l.trimEnd()).join('\n\n');
  return unix;
}
