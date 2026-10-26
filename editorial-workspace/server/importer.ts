// Adding existing material to a project, and moving reference files between layers.
// Reference files are copied byte for byte, never altered, and an existing file in the
// project is never replaced. Source folders are only read.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChapterMeta, EditorialComment, Layer } from '../shared/types.ts';
import { chapterExists } from './chapters.ts';
import { IMPORTABLE, convertToMarkdown } from './convert.ts';
import { HttpError, exists, nowIso, readJson, sha256, walkFiles, writeJson, writeNewFile } from './fsutil.ts';
import { EDITORIAL_DIR, LAYER_DIRS, type Project } from './project.ts';
import { readManifest } from './reference.ts';

/** Layers that hold imported reference material (and can be reclassified between). */
export type ImportTarget = 'canon' | 'directive' | 'idea' | 'historical' | 'legacy';
export const IMPORT_TARGETS: ImportTarget[] = ['canon', 'directive', 'idea', 'historical', 'legacy'];

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export interface ImportReport {
  copied: string[];
  alreadyPresent: string[];
  conflicts: string[]; // a different file with the same name exists; left untouched
  notes: string[]; // e.g. conversion warnings for imported chapters
  commit: string | null;
}

const emptyReport = (): ImportReport => ({ copied: [], alreadyPresent: [], conflicts: [], notes: [], commit: null });

interface IncomingFile {
  rel: string; // path inside the layer folder, with forward slashes
  bytes: Buffer;
  source: string;
}

/** Copy files into a layer, create-only. Must run inside the project lock. */
async function addFiles(project: Project, target: ImportTarget, files: IncomingFile[], label: string): Promise<ImportReport> {
  const destRoot = LAYER_DIRS[target]!;
  const report = emptyReport();
  const manifest = await readManifest(project);
  for (const file of files) {
    const rel = `${destRoot}/${file.rel}`;
    const dest = project.abs(rel);
    const hash = sha256(file.bytes);
    if (await exists(dest)) {
      if (sha256(await fs.readFile(dest)) === hash) report.alreadyPresent.push(rel);
      else report.conflicts.push(rel);
      continue;
    }
    await writeNewFile(dest, file.bytes);
    if (sha256(await fs.readFile(dest)) !== hash) throw new Error(`Copy verification failed for ${rel}`);
    manifest.files[rel] = { sha256: hash, size: file.bytes.length, importedAt: nowIso(), source: file.source };
    report.copied.push(rel);
  }
  if (report.copied.length > 0) {
    await writeJson(project.abs(project.manifestFile), manifest);
    report.commit = await project.git.commit(
      [...report.copied, project.manifestFile],
      `Import ${report.copied.length} ${target} file(s) from ${label} (unaltered)`,
    );
  }
  return report;
}

export async function importReference(project: Project, sourceDir: string, target: ImportTarget): Promise<ImportReport> {
  if (!IMPORT_TARGETS.includes(target)) throw new Error(`Unknown import target: ${target}`);
  const source = path.resolve(sourceDir);
  if (!(await exists(source))) throw new Error(`Source folder not found: ${source}`);
  return project.lock.run(async () => {
    const files: IncomingFile[] = [];
    for (const file of await walkFiles(source)) {
      files.push({ rel: path.relative(source, file).split(path.sep).join('/'), bytes: await fs.readFile(file), source: file });
    }
    return addFiles(project, target, files, path.basename(source));
  });
}

/** One file added from the browser. Same guarantees as the command-line import. */
export async function uploadReferenceFile(project: Project, target: unknown, name: unknown, bytes: unknown): Promise<ImportReport> {
  if (!IMPORT_TARGETS.includes(target as ImportTarget)) throw new HttpError(400, 'Choose where the file belongs');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new HttpError(400, 'The file is empty');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Files over 30 MB cannot be added');
  const clean = typeof name === 'string' ? path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').trim() : '';
  if (!clean || clean.startsWith('.') || clean.length > 200) throw new HttpError(400, 'Invalid file name');
  const report = await project.lock.run(() =>
    addFiles(project, target as ImportTarget, [{ rel: clean, bytes, source: `${clean} (added in the workspace)` }], clean),
  );
  if (report.conflicts.length) {
    throw new HttpError(409, `A different file called “${clean}” is already in that folder. Nothing was replaced; rename the file and try again.`);
  }
  return report;
}

/**
 * Move a reference file to another layer — e.g. an old continuity record from canon
 * to historical. An explicit author decision: it changes what counts as canon.
 * The file's bytes are not changed; links from editorial notes follow the move.
 */
export async function reclassifyReferenceFile(
  project: Project,
  input: { path?: unknown; to?: unknown; confirm?: unknown },
): Promise<{ path: string; layer: Layer }> {
  if (input.confirm !== true) throw new HttpError(400, 'Moving a file between layers must be confirmed by the author.');
  const to = input.to as ImportTarget;
  if (!IMPORT_TARGETS.includes(to)) throw new HttpError(400, 'Unknown destination');
  if (typeof input.path !== 'string') throw new HttpError(400, 'Missing path');
  const from = path.relative(project.root, project.abs(input.path)).split(path.sep).join('/');
  const fromLayer = project.layerOf(from) as ImportTarget | null;
  if (!fromLayer || !IMPORT_TARGETS.includes(fromLayer)) throw new HttpError(400, 'Only canon, directive, idea, historical and legacy files can be moved');
  if (fromLayer === to) throw new HttpError(400, 'The file is already there');

  return project.lock.run(async () => {
    const src = project.abs(from);
    if (!(await exists(src))) throw new HttpError(404, 'File not found');
    const inner = from.slice(LAYER_DIRS[fromLayer]!.length + 1);
    const dest = `${LAYER_DIRS[to]}/${inner}`;
    if (await exists(project.abs(dest))) throw new HttpError(409, `${dest} already exists; nothing was moved.`);
    await fs.mkdir(path.dirname(project.abs(dest)), { recursive: true });
    await fs.rename(src, project.abs(dest));

    const touched = [from, dest];
    const manifest = await readManifest(project);
    if (manifest.files[from]) {
      manifest.files[dest] = { ...manifest.files[from], moves: [...(manifest.files[from].moves ?? []), { date: nowIso(), from, to: dest }] };
      delete manifest.files[from];
      await writeJson(project.abs(project.manifestFile), manifest);
      touched.push(project.manifestFile);
    }
    // Keep citations in editorial notes pointing at the file.
    for (const abs of await walkFiles(project.abs(`${EDITORIAL_DIR}/comments`))) {
      if (!abs.endsWith('.json')) continue;
      const comments = await readJson<EditorialComment[]>(abs, []);
      let changed = false;
      for (const c of comments) {
        for (const r of c.refs) {
          if (r.file === from) {
            r.file = dest;
            r.layer = to;
            changed = true;
          }
        }
      }
      if (changed) {
        await writeJson(abs, comments);
        touched.push(path.relative(project.root, abs).split(path.sep).join('/'));
      }
    }
    await project.git.commit(touched, `Reclassify (author decision): ${from} → ${dest}`);
    return { path: dest, layer: to };
  });
}

/**
 * Import chapter drafts: each .md, .txt or .docx file becomes a working-draft chapter
 * (never an approved one). The number comes from the first number in the file name;
 * the title from a leading "# " heading, else the rest of the file name.
 */
export async function importChapters(project: Project, sourceDir: string): Promise<ImportReport> {
  const source = path.resolve(sourceDir);
  if (!(await exists(source))) throw new Error(`Source folder not found: ${source}`);
  const report = emptyReport();
  return project.lock.run(async () => {
    for (const file of await walkFiles(source)) {
      const base = path.basename(file);
      if (!IMPORTABLE.test(base)) {
        report.conflicts.push(`${base} (not a .md, .txt or .docx file)`);
        continue;
      }
      const name = base.replace(/\.[^.]+$/, '');
      const digits = /(\d+)/.exec(name);
      if (!digits) {
        report.conflicts.push(`${base} (no chapter number in the file name)`);
        continue;
      }
      const number = Number(digits[1]);
      const id = `ch${String(number).padStart(2, '0')}`;
      if (await chapterExists(project, id)) {
        report.conflicts.push(`${base} (chapter ${number} already exists)`);
        continue;
      }
      const converted = convertToMarkdown(base, await fs.readFile(file));
      for (const w of converted.warnings) report.notes.push(`${base}: ${w}`);
      const heading = /^#\s+(.+)$/m.exec(converted.markdown);
      const meta: ChapterMeta = {
        id,
        number,
        title: heading ? heading[1].replace(/[*_]/g, '').trim() : name.replace(/^[\s\d._-]+/, '').trim() || `Chapter ${number}`,
        status: 'drafting',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await writeNewFile(project.abs(project.chapterText(id)), converted.markdown);
      await writeJson(project.abs(project.chapterMeta(id)), meta);
      report.copied.push(project.chapterText(id));
    }
    if (report.copied.length > 0) {
      report.commit = await project.git.commit(['manuscript'], `Import ${report.copied.length} chapter draft(s) from ${path.basename(source)} (working drafts, not approved)`);
    }
    return report;
  });
}
