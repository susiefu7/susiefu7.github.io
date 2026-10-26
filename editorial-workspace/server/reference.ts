// The reference library: canon, directives, working ideas, historical records and
// archives. Read-only here (see importer.ts for adding and reclassifying files).
// Canon text changes only through confirmed proposals.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Layer, ReferenceFile, SearchHit, SearchResult } from '../shared/types.ts';
import { referenceText } from './convert.ts';
import { HttpError, exists, readJson, readText, sha256, walkFiles } from './fsutil.ts';
import { CHAPTERS_DIR, LAYER_DIRS, type Project } from './project.ts';

/** Plain-text files: the only kind a canon proposal may append to. */
export const TEXT_EXT = /\.(md|markdown|txt)$/i;
/** Files the library can display and search (.docx through a read-only conversion). */
export const READABLE_EXT = /\.(md|markdown|txt|docx)$/i;

export interface ManifestEntry {
  sha256: string;
  size: number;
  importedAt: string;
  source: string;
  /** Set when an author-confirmed proposal changed the file after import. */
  updates?: { date: string; proposalId: string; sha256: string }[];
  /** Author-confirmed moves between layers (e.g. canon → historical). */
  moves?: { date: string; from: string; to: string }[];
}

export interface Manifest {
  files: Record<string, ManifestEntry>;
}

export async function readManifest(project: Project): Promise<Manifest> {
  return readJson<Manifest>(project.abs(project.manifestFile), { files: {} });
}

export const BROWSABLE: Layer[] = ['canon', 'directive', 'idea', 'historical', 'approved', 'superseded', 'legacy'];

const textCache = new Map<string, { hash: string; text: string; converted: boolean; warnings: string[] }>();

/** The readable text of a library file. A .docx is converted in memory; the file is untouched. */
export async function readableText(abs: string): Promise<{ text: string; converted: boolean; warnings: string[] }> {
  const bytes = await fs.readFile(abs);
  const hash = sha256(bytes);
  const cached = textCache.get(abs);
  if (cached && cached.hash === hash) return cached;
  let result;
  try {
    result = referenceText(abs, bytes);
  } catch (e) {
    throw new HttpError(422, `${path.basename(abs)} could not be read: ${e instanceof Error ? e.message : e}`);
  }
  textCache.set(abs, { hash, ...result });
  return result;
}

function toRel(project: Project, abs: string): string {
  return path.relative(project.root, abs).split(path.sep).join('/');
}

export async function listReferenceFiles(project: Project): Promise<ReferenceFile[]> {
  const manifest = await readManifest(project);
  const out: ReferenceFile[] = [];
  for (const layer of BROWSABLE) {
    for (const abs of await walkFiles(project.abs(LAYER_DIRS[layer]!))) {
      const rel = toRel(project, abs);
      const stat = await fs.stat(abs);
      let integrity: ReferenceFile['integrity'] = 'n/a';
      const entry = manifest.files[rel];
      if (entry) {
        const expected = entry.updates?.at(-1)?.sha256 ?? entry.sha256;
        integrity = sha256(await fs.readFile(abs)) === expected ? 'verified' : 'changed';
      } else if (layer === 'canon' || layer === 'historical' || layer === 'legacy') {
        integrity = 'untracked';
      }
      out.push({
        path: rel,
        name: path.basename(rel),
        layer,
        searchable: READABLE_EXT.test(rel),
        converted: /\.docx$/i.test(rel),
        size: stat.size,
        integrity,
      });
    }
  }
  return out;
}

/** Read a reference file. Only folders in the reference library are reachable. */
export async function readReferenceFile(
  project: Project,
  rel: unknown,
): Promise<{ path: string; layer: Layer; content: string; hash: string; converted: boolean; warnings: string[] }> {
  if (typeof rel !== 'string') throw new HttpError(400, 'Missing path');
  const abs = project.abs(rel);
  const normalised = toRel(project, abs);
  const layer = project.layerOf(normalised);
  if (!layer || !BROWSABLE.includes(layer)) throw new HttpError(403, 'Not a reference file');
  if (!READABLE_EXT.test(normalised)) throw new HttpError(415, 'This file is stored in the project, but the workspace can only display .md, .txt and .docx files.');
  if (!(await exists(abs))) throw new HttpError(404, 'File not found');
  const { text, converted, warnings } = await readableText(abs);
  return { path: normalised, layer, content: text, hash: sha256(text), converted, warnings };
}

const AUTHORITY: Record<string, number> = { directive: 0, canon: 1, approved: 2, draft: 3, idea: 4, historical: 5, superseded: 6, legacy: 7 };

function tokenize(query: string): { phrases: string[] } {
  const phrases: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) phrases.push((m[1] ?? m[2]).toLowerCase());
  return { phrases };
}

/**
 * Full-text search. A line matches when it contains every term (quoted phrases match
 * exactly). Results say which layer each hit comes from, so canon is never confused
 * with ideas, drafts or legacy text.
 */
export async function search(project: Project, query: unknown, layers?: Layer[]): Promise<SearchResult> {
  const q = typeof query === 'string' ? query.trim() : '';
  if (q.length < 2) throw new HttpError(400, 'Search for at least two characters');
  const { phrases } = tokenize(q);
  const files: { rel: string; layer: Layer }[] = [];
  const unsearchable: string[] = [];
  for (const f of await listReferenceFiles(project)) {
    if (layers && !layers.includes(f.layer)) continue;
    if (f.searchable) files.push({ rel: f.path, layer: f.layer });
    else unsearchable.push(f.path);
  }
  if (!layers || layers.includes('draft')) {
    for (const abs of await walkFiles(project.abs(CHAPTERS_DIR))) {
      if (abs.endsWith('chapter.md')) files.push({ rel: toRel(project, abs), layer: 'draft' });
    }
  }

  const hits: SearchHit[] = [];
  for (const { rel, layer } of [...files]) {
    let text: string;
    try {
      text = layer === 'draft' ? await readText(project.abs(rel)) : (await readableText(project.abs(rel))).text;
    } catch {
      unsearchable.push(rel); // e.g. a damaged .docx — reported, never silently skipped
      files.splice(files.findIndex((f) => f.rel === rel), 1);
      continue;
    }
    const lines = text.split('\n');
    let heading: string | null = null;
    lines.forEach((line, i) => {
      const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      if (h) heading = h[1];
      const lower = line.toLowerCase();
      if (!phrases.every((p) => lower.includes(p))) return;
      const at = lower.indexOf(phrases[0]);
      const from = Math.max(0, at - 90);
      const to = Math.min(line.length, at + phrases[0].length + 150);
      hits.push({
        file: rel,
        layer,
        line: i + 1,
        heading: h ? h[1] : heading,
        snippet: `${from > 0 ? '…' : ''}${line.slice(from, to).trim().replace(/^#{1,6}\s+/, '')}${to < line.length ? '…' : ''}`,
        inHeading: Boolean(h),
      });
    });
  }
  hits.sort(
    (a, b) =>
      Number(b.inHeading) - Number(a.inHeading) ||
      (AUTHORITY[a.layer] ?? 9) - (AUTHORITY[b.layer] ?? 9) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  return { query: q, hits: hits.slice(0, 400), filesSearched: files.length, unsearchable };
}

/** Short headings in canon files (usually character, place or event names). */
export async function canonHeadings(project: Project): Promise<{ name: string; file: string }[]> {
  const out: { name: string; file: string }[] = [];
  const seen = new Set<string>();
  for (const abs of await walkFiles(project.abs(LAYER_DIRS.canon!))) {
    if (!READABLE_EXT.test(abs)) continue;
    const text = await readableText(abs).then((r) => r.text, () => '');
    for (const line of text.split('\n')) {
      const h = /^#{2,4}\s+(.+?)\s*#*\s*$/.exec(line);
      if (!h) continue;
      const name = h[1].replace(/[*_`]/g, '').trim();
      if (name.split(/\s+/).length > 4 || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, file: toRel(project, abs) });
    }
  }
  return out;
}
