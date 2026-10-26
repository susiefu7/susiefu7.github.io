// Turns an incoming file (.md, .markdown, .txt, .docx) into chapter Markdown.
// Used when importing or pasting prose; the source file itself is never changed.

import path from 'node:path';
import { countWords } from '../shared/text.ts';
import { docxToMarkdown, type Conversion } from './docx.ts';
import { HttpError } from './fsutil.ts';

export const IMPORTABLE = /\.(md|markdown|txt|docx)$/i;
export const READABLE_REFERENCE = /\.(md|markdown|txt|docx)$/i;

/** Decode text bytes: UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252. */
export function decodeText(bytes: Buffer, warnings: string[] = []): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf8');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    warnings.push('The file was not UTF-8; it was read as Windows-1252 (Western European). Check accented characters.');
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Many plain-text sources put a single line break between paragraphs. Markdown would
 * join those lines into one paragraph, so when a text has no blank lines at all,
 * each line break is treated as a paragraph break.
 */
export function normaliseParagraphs(text: string, warnings: string[] = []): string {
  const unix = text.replace(/\r\n?/g, '\n');
  const lines = unix.trim().split('\n');
  if (lines.length > 1 && !/\n[ \t]*\n/.test(unix.trim())) {
    warnings.push('Single line breaks were treated as paragraph breaks.');
    return `${lines.map((l) => l.trimEnd()).join('\n\n')}\n`;
  }
  return unix;
}

export interface ConvertedText extends Conversion {
  format: 'markdown' | 'text' | 'docx';
  words: number;
}

export function convertToMarkdown(fileName: string, bytes: Buffer): ConvertedText {
  const ext = path.extname(fileName).toLowerCase();
  if (!IMPORTABLE.test(ext)) throw new HttpError(415, 'Only .md, .markdown, .txt and .docx files can be imported as chapter text.');
  let result: ConvertedText;
  if (ext === '.docx') {
    let conv: Conversion;
    try {
      conv = docxToMarkdown(bytes);
    } catch (e) {
      throw new HttpError(422, e instanceof Error ? e.message : 'Could not read this .docx file.');
    }
    result = { ...conv, format: 'docx', words: 0 };
  } else {
    const warnings: string[] = [];
    const text = decodeText(bytes, warnings);
    const markdown = ext === '.txt' ? normaliseParagraphs(text, warnings) : text.replace(/\r\n?/g, '\n');
    result = { markdown, warnings, format: ext === '.txt' ? 'text' : 'markdown', words: 0 };
  }
  result.words = countWords(result.markdown);
  return result;
}

/** Readable text of a reference file for display and search (never written back). */
export function referenceText(fileName: string, bytes: Buffer): { text: string; converted: boolean; warnings: string[] } {
  if (/\.docx$/i.test(fileName)) {
    const { markdown, warnings } = docxToMarkdown(bytes);
    return { text: markdown, converted: true, warnings };
  }
  return { text: decodeText(bytes), converted: false, warnings: [] };
}
