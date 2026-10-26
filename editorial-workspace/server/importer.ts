// Importing existing material. Files are copied byte for byte, never altered, and an
// existing file in the project is never replaced. Source folders are only read.

import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChapterMeta } from '../shared/types.ts';
import { chapterExists } from './chapters.ts';
import { exists, nowIso, sha256, walkFiles, writeJson } from './fsutil.ts';
import { LAYER_DIRS, type Project } from './project.ts';
import { readManifest } from './reference.ts';

export type ImportTarget = 'canon' | 'directive' | 'idea' | 'legacy';

export interface ImportReport {
  copied: string[];
  alreadyPresent: string[];
  conflicts: string[]; // a different file with the same name exists; left untouched
  commit: string | null;
}

export async function importReference(project: Project, sourceDir: string, target: ImportTarget): Promise<ImportReport> {
  const source = path.resolve(sourceDir);
  if (!(await exists(source))) throw new Error(`Source folder not found: ${source}`);
  const destRoot = LAYER_DIRS[target]!;
  const report: ImportReport = { copied: [], alreadyPresent: [], conflicts: [], commit: null };
  const manifest = await readManifest(project);

  return project.lock.run(async () => {
    for (const file of await walkFiles(source)) {
      const relInSource = path.relative(source, file);
      const rel = `${destRoot}/${relInSource.split(path.sep).join('/')}`;
      const dest = project.abs(rel);
      const bytes = await fs.readFile(file);
      const hash = sha256(bytes);
      if (await exists(dest)) {
        if (sha256(await fs.readFile(dest)) === hash) report.alreadyPresent.push(rel);
        else report.conflicts.push(rel);
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(file, dest, constants.COPYFILE_EXCL);
      if (sha256(await fs.readFile(dest)) !== hash) throw new Error(`Copy verification failed for ${rel}`);
      if (target === 'canon' || target === 'legacy') {
        manifest.files[rel] = { sha256: hash, size: bytes.length, importedAt: nowIso(), source: file };
      }
      report.copied.push(rel);
    }
    if (report.copied.length > 0) {
      await writeJson(project.abs(project.manifestFile), manifest);
      report.commit = await project.git.commit(
        [destRoot, project.manifestFile],
        `Import ${report.copied.length} ${target} file(s) from ${path.basename(source)} (unaltered)`,
      );
    }
    return report;
  });
}

/**
 * Import chapter drafts: each Markdown/text file becomes a chapter. The chapter number
 * comes from the first number in the file name; the title from a leading "# " heading.
 */
export async function importChapters(project: Project, sourceDir: string): Promise<ImportReport> {
  const source = path.resolve(sourceDir);
  const report: ImportReport = { copied: [], alreadyPresent: [], conflicts: [], commit: null };
  return project.lock.run(async () => {
    const files = (await walkFiles(source)).filter((f) => /\.(md|markdown|txt)$/i.test(f));
    for (const file of files) {
      const name = path.basename(file).replace(/\.[^.]+$/, '');
      const digits = /(\d+)/.exec(name);
      if (!digits) {
        report.conflicts.push(`${path.basename(file)} (no chapter number in the file name)`);
        continue;
      }
      const number = Number(digits[1]);
      const id = `ch${String(number).padStart(2, '0')}`;
      if (await chapterExists(project, id)) {
        report.conflicts.push(`${path.basename(file)} (chapter ${number} already exists)`);
        continue;
      }
      const text = await fs.readFile(file, 'utf8');
      const heading = /^#\s+(.+)$/m.exec(text);
      const meta: ChapterMeta = {
        id,
        number,
        title: heading ? heading[1].trim() : name.replace(/^[\d\s._-]+/, '') || `Chapter ${number}`,
        status: 'drafting',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await fs.mkdir(project.abs(project.chapterDir(id)), { recursive: true });
      await fs.copyFile(file, project.abs(project.chapterText(id)), constants.COPYFILE_EXCL);
      await writeJson(project.abs(project.chapterMeta(id)), meta);
      report.copied.push(project.chapterText(id));
    }
    if (report.copied.length > 0) {
      report.commit = await project.git.commit(['manuscript'], `Import ${report.copied.length} chapter draft(s) from ${path.basename(source)}`);
    }
    return report;
  });
}
