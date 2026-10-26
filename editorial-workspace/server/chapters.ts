// Chapters: listing, reading, saving and crash recovery.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { countWords, parseScenes } from '../shared/text.ts';
import type {
  ApprovalRecord,
  ChapterDocument,
  ChapterMeta,
  ChapterSummary,
  RecoveryInfo,
  WorkingStatus,
} from '../shared/types.ts';
import { WORKING_STATUSES } from '../shared/types.ts';
import { readComments, reanchorComments } from './commentStore.ts';
import {
  HttpError,
  atomicWrite,
  exists,
  nowIso,
  readJson,
  readTextIfExists,
  sha256,
  uniquePath,
  writeJson,
} from './fsutil.ts';
import { CHAPTERS_DIR, RECOVERY_DIR, type Project } from './project.ts';

function inferMeta(id: string, text: string): ChapterMeta {
  const digits = /(\d+)/.exec(id);
  const heading = /^#\s+(.+)$/m.exec(text);
  return {
    id,
    number: digits ? Number(digits[1]) : 0,
    title: heading ? heading[1].trim() : id,
    status: 'drafting',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export async function chapterExists(project: Project, id: string): Promise<boolean> {
  return exists(project.abs(project.chapterText(id)));
}

export async function assertChapter(project: Project, id: string): Promise<void> {
  if (!(await chapterExists(project, id))) throw new HttpError(404, `No chapter "${id}"`);
}

export async function readDraft(project: Project, id: string): Promise<string> {
  await assertChapter(project, id);
  return (await readTextIfExists(project.abs(project.chapterText(id)))) ?? '';
}

export async function readMeta(project: Project, id: string): Promise<ChapterMeta> {
  const stored = await readJson<ChapterMeta | null>(project.abs(project.chapterMeta(id)), null);
  if (stored) return { ...stored, id };
  return inferMeta(id, await readDraft(project, id));
}

export async function readApprovals(project: Project, id: string): Promise<ApprovalRecord[]> {
  return readJson<ApprovalRecord[]>(project.abs(project.approvalsFile(id)), []);
}

async function approvalState(project: Project, id: string, draftHash: string) {
  const approvals = await readApprovals(project, id);
  const approval = approvals.at(-1) ?? null;
  if (!approval) return { approval: null, draftMatchesApproved: null };
  const approvedText = await readTextIfExists(project.abs(project.approvedText(id)));
  return { approval, draftMatchesApproved: approvedText !== null && sha256(approvedText) === draftHash };
}

export async function listChapters(project: Project): Promise<ChapterSummary[]> {
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(project.abs(CHAPTERS_DIR), { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: ChapterSummary[] = [];
  for (const id of entries) {
    try {
      project.assertChapterId(id);
    } catch {
      continue; // folder names that are not valid ids are ignored, never touched
    }
    if (!(await chapterExists(project, id))) continue;
    const text = await readDraft(project, id);
    const meta = await readMeta(project, id);
    const comments = await readComments(project, id);
    out.push({
      ...meta,
      wordCount: countWords(text),
      sceneCount: parseScenes(text).length,
      ...(await approvalState(project, id, sha256(text))),
      openComments: comments.filter((c) => c.status === 'open').length,
    });
  }
  return out.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
}

export async function readRecovery(project: Project, id: string): Promise<RecoveryInfo | null> {
  return readJson<RecoveryInfo | null>(project.abs(project.recoveryFile(id)), null);
}

export async function getChapter(project: Project, id: string): Promise<ChapterDocument> {
  const text = await readDraft(project, id);
  const hash = sha256(text);
  const recovery = await readRecovery(project, id);
  return {
    meta: await readMeta(project, id),
    text,
    hash,
    scenes: parseScenes(text),
    wordCount: countWords(text),
    ...(await approvalState(project, id, hash)),
    recovery: recovery && recovery.text !== text ? recovery : null,
  };
}

export function assertBaseHash(current: string, baseHash: unknown): void {
  if (typeof baseHash !== 'string' || sha256(current) !== baseHash) {
    throw new HttpError(
      409,
      'The chapter on disk has changed since you opened it (perhaps in another window or editor). ' +
        'Nothing was overwritten. Reload the chapter to see the newer text; your unsaved text is kept in recovery.',
      { currentHash: sha256(current) },
    );
  }
}

/**
 * Write the draft, re-anchor its comments and commit both. Must be called inside the
 * project lock. The previous text is always recoverable from Git.
 */
export async function writeDraftAndCommit(project: Project, id: string, text: string, message: string): Promise<string | null> {
  const meta = await readMeta(project, id);
  meta.updatedAt = nowIso();
  await atomicWrite(project.abs(project.chapterText(id)), text);
  await writeJson(project.abs(project.chapterMeta(id)), meta);
  await reanchorComments(project, id, text);
  return project.git.commit([project.chapterText(id), project.chapterMeta(id), project.commentsFile(id)], message);
}

export async function saveChapter(
  project: Project,
  id: string,
  text: unknown,
  baseHash: unknown,
): Promise<ChapterDocument> {
  if (typeof text !== 'string') throw new HttpError(400, 'Missing chapter text');
  return project.lock.run(async () => {
    const current = await readDraft(project, id);
    if (current !== text) {
      assertBaseHash(current, baseHash);
      const meta = await readMeta(project, id);
      await writeDraftAndCommit(project, id, text, `Save: ${id} — ${meta.title}`);
    }
    const recovery = await readRecovery(project, id);
    if (recovery && recovery.text === text) await fs.rm(project.abs(project.recoveryFile(id)), { force: true });
    return getChapter(project, id);
  });
}

/**
 * Create a chapter, empty or from supplied text (pasted or converted from a file).
 * A new chapter is always a working draft; nothing is approved by creating it.
 */
export async function createChapter(
  project: Project,
  input: { title?: unknown; number?: unknown; text?: unknown; source?: unknown },
): Promise<ChapterDocument> {
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : 'Untitled chapter';
  const text = typeof input.text === 'string' ? input.text : '';
  const source = typeof input.source === 'string' && input.source.trim() ? path.basename(input.source.trim()) : null;
  return project.lock.run(async () => {
    const existing = await listChapters(project);
    const number =
      typeof input.number === 'number' && Number.isInteger(input.number) && input.number > 0
        ? input.number
        : Math.max(0, ...existing.map((c) => c.number)) + 1;
    const id = `ch${String(number).padStart(2, '0')}`;
    if (await chapterExists(project, id)) throw new HttpError(409, `Chapter ${number} already exists`);
    const meta: ChapterMeta = { id, number, title, status: 'drafting', createdAt: nowIso(), updatedAt: nowIso() };
    await atomicWrite(project.abs(project.chapterText(id)), text);
    await writeJson(project.abs(project.chapterMeta(id)), meta);
    await project.git.commit([project.chapterDir(id)], `Add chapter: ${id} — ${title}${source ? ` (text imported from ${source})` : ''}`);
    return getChapter(project, id);
  });
}

export async function updateMeta(
  project: Project,
  id: string,
  patch: { title?: unknown; status?: unknown },
): Promise<ChapterDocument> {
  return project.lock.run(async () => {
    const meta = await readMeta(project, id);
    if (typeof patch.title === 'string' && patch.title.trim()) meta.title = patch.title.trim();
    if (patch.status !== undefined) {
      if (!WORKING_STATUSES.includes(patch.status as WorkingStatus)) throw new HttpError(400, 'Unknown status');
      meta.status = patch.status as WorkingStatus;
    }
    meta.updatedAt = nowIso();
    await writeJson(project.abs(project.chapterMeta(id)), meta);
    await project.git.commit([project.chapterMeta(id)], `Update details: ${id} — ${meta.title}`);
    return getChapter(project, id);
  });
}

/** Unsaved editor text, written every few seconds. Outside Git; never replaces the draft by itself. */
export async function writeRecovery(project: Project, id: string, text: unknown): Promise<void> {
  if (typeof text !== 'string') throw new HttpError(400, 'Missing text');
  await assertChapter(project, id);
  const info: RecoveryInfo = { savedAt: nowIso(), text };
  await writeJson(project.abs(project.recoveryFile(id)), info);
}

/** "Discard" moves the recovery text aside rather than deleting it. */
export async function discardRecovery(project: Project, id: string): Promise<void> {
  const file = project.abs(project.recoveryFile(id));
  if (!(await exists(file))) return;
  const stamp = nowIso().replace(/[:.]/g, '-');
  const target = await uniquePath(project.abs(`${RECOVERY_DIR}/discarded/${id}-${stamp}.json`));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(file, target);
}
