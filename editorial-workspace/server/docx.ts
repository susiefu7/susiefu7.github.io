// Reads the text of a Word .docx file and renders it as Markdown, without external
// dependencies. A .docx is a ZIP archive; the body text is in word/document.xml.
// Only reading happens here: source files are never modified.

import { inflateRawSync } from 'node:zlib';

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** Extract one file from a ZIP archive, or null if it is not present. */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Not a valid .docx file (no ZIP directory found).');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('This .docx uses ZIP64, which is not supported. Re-save it from Word.');

  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged .docx (bad ZIP directory).');
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;

    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('Damaged .docx (bad ZIP entry).');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + compressed);
    if (size > MAX_ENTRY_BYTES) throw new Error('This .docx is too large to read.');
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    throw new Error(`This .docx uses an unsupported compression method (${method}).`);
  }
  return null;
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const lower = e.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    return String.fromCodePoint(lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10));
  });
}

/** <w:i/>, <w:i w:val="1"/> etc. are on; w:val="0"/"false"/"off" is off. */
function toggleOn(props: string, tag: 'i' | 'b'): boolean {
  const m = new RegExp(`<w:${tag}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(props);
  if (!m) return false;
  return !m[1] || !['0', 'false', 'off', 'none'].includes(m[1].toLowerCase());
}

interface Run {
  text: string;
  italic: boolean;
  bold: boolean;
}

/** Wrap a run in Markdown emphasis, keeping surrounding spaces outside the markers. */
function emphasise(run: Run): string {
  if (!run.italic && !run.bold) return run.text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!;
  if (!m[2]) return run.text;
  // Bold italic is written _**…**_ so the reading view's parser cannot misread it.
  const inner = run.bold && run.italic ? `_**${m[2]}**_` : run.bold ? `**${m[2]}**` : `*${m[2]}*`;
  return `${m[1]}${inner}${m[3]}`;
}

export interface Conversion {
  markdown: string;
  warnings: string[];
}

export function docxToMarkdown(file: Buffer): Conversion {
  const xmlBuf = readZipEntry(file, 'word/document.xml');
  if (!xmlBuf) throw new Error('This file does not look like a Word document (word/document.xml is missing).');
  const xml = xmlBuf.toString('utf8');
  const warnings = new Set<string>();

  if (/<w:del\b/.test(xml) || /<w:ins\b/.test(xml)) warnings.add('The document has tracked changes; they were read as if accepted.');
  if (/<w:comment\b/.test(readZipEntry(file, 'word/comments.xml')?.toString('utf8') ?? '')) warnings.add('Word comments were not imported.');
  if (/<w:footnoteReference\b/.test(xml)) warnings.add('Footnotes were not imported.');
  if (/<w:tbl\b/.test(xml)) warnings.add('Tables were flattened into paragraphs.');
  if (/<w:drawing\b|<w:pict\b/.test(xml)) warnings.add('Images were not imported.');

  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const paragraphs: string[] = [];

  for (const pm of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const inner = pm[1] ?? '';
    const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(inner)?.[0] ?? '';
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(pPr)?.[1] ?? '';

    const runs: Run[] = [];
    // Deleted text (<w:delText>) is skipped by only reading <w:t>; moved-from text likewise.
    for (const rm of inner.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const r = rm[1];
      const rPr = /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(r)?.[0] ?? '';
      let text = '';
      for (const piece of r.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\b[^>]*\/>|<w:(tab|br|cr|noBreakHyphen|softHyphen)\b[^>]*\/>/g)) {
        if (piece[1] !== undefined) text += decodeXml(piece[1]);
        else if (piece[2] === 'tab') text += '\t';
        else if (piece[2] === 'br' || piece[2] === 'cr') text += '\n';
        else if (piece[2] === 'noBreakHyphen') text += '-';
      }
      if (!text) continue;
      const run = { text, italic: toggleOn(rPr, 'i'), bold: toggleOn(rPr, 'b') };
      const last = runs[runs.length - 1];
      if (last && last.italic === run.italic && last.bold === run.bold) last.text += run.text;
      else runs.push(run);
    }

    let line = runs.map(emphasise).join('').replace(/[ \t]+$/g, '');
    if (!line.trim()) continue; // Word often uses empty paragraphs for spacing

    const heading = /^(?:Heading|heading)\s*([1-6])$/.exec(style);
    if (/^Title$/i.test(style)) line = `# ${line.replace(/^\*+|\*+$/g, '').trim()}`;
    else if (heading) line = `${'#'.repeat(Number(heading[1]))} ${line.replace(/^\*+|\*+$/g, '').trim()}`;
    else if (/<w:numPr\b/.test(pPr) || /^List/i.test(style)) line = `- ${line.trim()}`;
    else if (/^(?:Quote|IntenseQuote|BlockText)$/i.test(style)) line = `> ${line.trim()}`;
    paragraphs.push(line);
  }

  return { markdown: paragraphs.length ? `${paragraphs.join('\n\n')}\n` : '', warnings: [...warnings] };
}
