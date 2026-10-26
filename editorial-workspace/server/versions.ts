// Version history. Every save is a Git commit; named versions are labels on commits,
// recorded in editorial/versions/<chapter>.json. Restoring never discards anything:
// the current draft is labelled first, then the old text becomes a new commit.

import path from 'node:path';
import type { ChapterDocument, NamedVersion, VersionEntry, VersionKind } from '../shared/types.ts';
import { assertBaseHash, getChapter, readDraft, readMeta, writeDraftAndCommit } from './chapters.ts';
import { HttpError, exists, newId, nowIso, readJson, readText, resolveInside, sha256, walkFiles, writeJson } from './fsutil.ts';
import { LAYER_DIRS, type Project } from './project.ts';

export async function readNamedVersions(project: Project, id: string): Promise<NamedVersion[]> {
  return readJson<NamedVersion[]>(project.abs(project.versionsFile(id)), []);
}

/** Label the chapter's current committed state. Must run inside the project lock. */
export async function createVersionUnlocked(
  project: Project,
  id: string,
  name: string,
  note: string,
  kind: VersionKind,
): Promise<NamedVersion> {
  const text = await readDraft(project, id);
  // Make sure the exact current text is in a commit before labelling it.
  await project.git.commit([project.chapterText(id), project.chapterMeta(id)], `Save: ${id} (before "${name}")`);
  const commit = await project.git.lastCommitFor(project.chapterText(id));
  if (!commit) throw new HttpError(500, 'Could not record the version in Git');
  const version: NamedVersion = {
    id: newId('v'),
    chapterId: id,
    name,
    note,
    kind,
    commit,
    contentHash: sha256(text),
    createdAt: nowIso(),
  };
  const all = await readNamedVersions(project, id);
  all.push(version);
  await writeJson(project.abs(project.versionsFile(id)), all);
  await project.git.commit([project.versionsFile(id)], `Version: ${id} — ${name}`);
  return version;
}

export async function createVersion(
  project: Project,
  id: string,
  input: { name?: unknown; note?: unknown },
): Promise<NamedVersion> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new HttpError(400, 'A version needs a name');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  return project.lock.run(() => createVersionUnlocked(project, id, name, note, 'named'));
}

export async function listVersions(project: Project, id: string): Promise<VersionEntry[]> {
  await readDraft(project, id); // 404 if missing
  const named = await readNamedVersions(project, id);
  const byCommit = new Map<string, NamedVersion[]>();
  for (const v of named) byCommit.set(v.commit, [...(byCommit.get(v.commit) ?? []), v]);

  const entries: VersionEntry[] = [
    { ref: 'draft', label: 'Current draft', date: null, layer: 'draft', kind: 'draft', named: null, commit: null, restorable: false },
  ];

  for (const log of await project.git.log(project.chapterText(id))) {
    const labels = byCommit.get(log.commit);
    if (labels) {
      // One commit can carry several labels (e.g. a named version that was later approved).
      for (const v of [...labels].reverse()) {
        entries.push({
          ref: `commit:${log.commit}`,
          label: v.name,
          date: v.createdAt,
          layer: 'draft',
          kind: v.kind,
          named: v,
          commit: log.commit,
          restorable: true,
        });
      }
    } else {
      entries.push({
        ref: `commit:${log.commit}`,
        label: log.subject.replace(/^Save: \S+ — /, 'Saved — '),
        date: log.date,
        layer: 'draft',
        kind: 'save',
        named: null,
        commit: log.commit,
        restorable: true,
      });
    }
  }

  if (await exists(project.abs(project.approvedText(id)))) {
    entries.push({ ref: 'approved', label: 'Approved text (current)', date: null, layer: 'approved', kind: 'approved', named: null, commit: null, restorable: true });
  }
  for (const file of await walkFiles(project.abs(project.supersededDir(id)))) {
    const name = path.basename(file);
    entries.push({ ref: `superseded:${name}`, label: `Superseded approval — ${name.replace(/\.md$/, '')}`, date: null, layer: 'superseded', kind: 'superseded', named: null, commit: null, restorable: true });
  }
  const legacyRoot = project.abs(LAYER_DIRS.legacy!);
  for (const file of await walkFiles(legacyRoot)) {
    const rel = path.relative(legacyRoot, file).split(path.sep).join('/');
    if (!/\.(md|markdown|txt)$/i.test(rel)) continue;
    entries.push({ ref: `legacy:${rel}`, label: `Legacy — ${rel}`, date: null, layer: 'legacy', kind: 'legacy', named: null, commit: null, restorable: true });
  }
  return entries;
}

/** Resolve a version reference to its text. */
export async function readVersionText(project: Project, id: string, ref: unknown): Promise<{ text: string; label: string }> {
  if (typeof ref !== 'string' || !ref) throw new HttpError(400, 'Missing version reference');
  if (ref === 'draft') return { text: await readDraft(project, id), label: 'Current draft' };
  if (ref === 'approved') {
    const file = project.abs(project.approvedText(id));
    if (!(await exists(file))) throw new HttpError(404, 'This chapter has no approved text');
    return { text: await readText(file), label: 'Approved text' };
  }
  const [kind, value] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  if (kind === 'commit') {
    const named = (await readNamedVersions(project, id)).filter((v) => v.commit.startsWith(value) || value.startsWith(v.commit));
    const label = named.at(-1)?.name ?? `the version saved in ${value.slice(0, 7)}`;
    return { text: await project.git.show(value, project.chapterText(id)), label };
  }
  if (kind === 'superseded' || kind === 'legacy') {
    const base = project.abs(kind === 'superseded' ? project.supersededDir(id) : LAYER_DIRS.legacy!);
    const file = resolveInside(base, value);
    if (!(await exists(file))) throw new HttpError(404, 'File not found');
    return { text: await readText(file), label: `${kind === 'legacy' ? 'Legacy' : 'Superseded'} — ${value}` };
  }
  throw new HttpError(400, `Unknown version reference: ${ref}`);
}

/**
 * Bring an earlier text back as the working draft. The current draft is labelled
 * "Before restoring …" first, so the restore itself can be undone.
 */
export async function restoreVersion(
  project: Project,
  id: string,
  input: { ref?: unknown; baseHash?: unknown },
): Promise<{ chapter: ChapterDocument; safetyVersion: NamedVersion }> {
  const { text, label } = await readVersionText(project, id, input.ref);
  return project.lock.run(async () => {
    const current = await readDraft(project, id);
    assertBaseHash(current, input.baseHash);
    const safetyVersion = await createVersionUnlocked(
      project,
      id,
      `Before restoring “${label}”`,
      'Created automatically so the restore can be undone.',
      'pre-restore',
    );
    const meta = await readMeta(project, id);
    await writeDraftAndCommit(project, id, text, `Restore: ${id} — ${meta.title} from ${label}`);
    return { chapter: await getChapter(project, id), safetyVersion };
  });
}
