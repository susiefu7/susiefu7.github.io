// Chapter approval and author-confirmed canon updates.
//
// Approving a chapter freezes a copy of the draft in approved/. A later approval moves
// the earlier copy to archive/superseded/ first; approved text is never overwritten.
// Approval also drafts proposed updates to canon files — these change nothing until
// the author reviews and separately confirms each one.

import path from 'node:path';
import { countWords, parseScenes } from '../shared/text.ts';
import type { ApprovalRecord, CanonProposal } from '../shared/types.ts';
import { assertBaseHash, readApprovals, readDraft, readMeta } from './chapters.ts';
import {
  HttpError,
  atomicWrite,
  exists,
  newId,
  nowIso,
  readJson,
  readText,
  readTextIfExists,
  sha256,
  uniquePath,
  walkFiles,
  writeJson,
  writeNewFile,
} from './fsutil.ts';
import { LAYER_DIRS, type Project } from './project.ts';
import { TEXT_EXT, canonHeadings, readManifest } from './reference.ts';
import { createVersionUnlocked } from './versions.ts';

export async function approveChapter(
  project: Project,
  id: string,
  input: { baseHash?: unknown; note?: unknown; confirm?: unknown },
): Promise<{ approval: ApprovalRecord; proposals: CanonProposal[] }> {
  if (input.confirm !== true) throw new HttpError(400, 'Approval must be confirmed explicitly by the author.');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  return project.lock.run(async () => {
    const text = await readDraft(project, id);
    assertBaseHash(text, input.baseHash);
    if (!text.trim()) throw new HttpError(400, 'An empty chapter cannot be approved.');
    const meta = await readMeta(project, id);
    const approvedRel = project.approvedText(id);
    const approvedAbs = project.abs(approvedRel);
    const date = nowIso();

    let supersededFile: string | undefined;
    const previous = await readTextIfExists(approvedAbs);
    if (previous !== null) {
      if (sha256(previous) === sha256(text)) throw new HttpError(409, 'This exact text is already the approved version.');
      // Freeze the earlier approval in the archive before replacing it.
      const target = await uniquePath(project.abs(`${project.supersededDir(id)}/${date.slice(0, 10)}-approved.md`));
      await writeNewFile(target, previous);
      if (sha256(await readText(target)) !== sha256(previous)) throw new HttpError(500, 'Could not archive the previous approved text; nothing was changed.');
      supersededFile = path.relative(project.root, target).split(path.sep).join('/');
    }
    await atomicWrite(approvedAbs, text);

    const version = await createVersionUnlocked(project, id, `Approved ${date.slice(0, 10)}`, note, 'approval');
    const approval: ApprovalRecord = {
      id: newId('a'),
      chapterId: id,
      date,
      commit: version.commit,
      contentHash: sha256(text),
      approvedFile: approvedRel,
      wordCount: countWords(text),
      note,
      supersededFile,
    };
    const approvals = await readApprovals(project, id);
    approvals.push(approval);
    await writeJson(project.abs(project.approvalsFile(id)), approvals);

    const proposals = await draftProposals(project, id, meta.number, meta.title, text, approval);
    await project.git.commit(
      [approvedRel, project.approvalsFile(id), project.proposalsDir, ...(supersededFile ? [supersededFile] : [])],
      `Approve: ${id} — ${meta.title} (author decision${note ? `: ${note.slice(0, 60)}` : ''})`,
    );
    return { approval, proposals };
  });
}

async function findCanonFile(project: Project, pattern: RegExp): Promise<string | null> {
  for (const abs of await walkFiles(project.abs(LAYER_DIRS.canon!))) {
    const rel = path.relative(project.root, abs).split(path.sep).join('/');
    if (TEXT_EXT.test(rel) && pattern.test(path.basename(rel))) return rel;
  }
  return null;
}

/**
 * Draft summary and continuity updates. Without an AI editor these contain only what
 * can be derived mechanically (scene list, counts, canon names that occur in the text)
 * and clearly marked places for the author to write. Nothing is invented.
 */
async function draftProposals(
  project: Project,
  id: string,
  number: number,
  title: string,
  text: string,
  approval: ApprovalRecord,
): Promise<CanonProposal[]> {
  const scenes = parseScenes(text);
  const day = approval.date.slice(0, 10);
  const summary = [
    `## Chapter ${number}: ${title}`,
    '',
    `_Approved ${day} · ${approval.wordCount.toLocaleString('en-GB')} words · ${scenes.length} scene${scenes.length === 1 ? '' : 's'}_`,
    '',
    '[Author to write the chapter summary here.]',
    '',
    ...scenes.map((s) => `${s.index}. ${s.title}`),
  ].join('\n');

  const mentions: string[] = [];
  for (const { name } of await canonHeadings(project)) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const count = text.match(re)?.length ?? 0;
    if (count > 0) mentions.push(`- ${name} — ${count} mention${count === 1 ? '' : 's'}`);
  }
  const continuity = [
    `## Chapter ${number}: ${title} — continuity (approved ${day})`,
    '',
    'Canon entries named in this chapter (found by matching headings in the canon files; please verify):',
    ...(mentions.length ? mentions : ['- None found automatically.']),
    '',
    'New facts established in this chapter:',
    '- [Author to list any new, now-binding details here.]',
  ].join('\n');

  const make = async (kind: CanonProposal['kind'], content: string, pattern: RegExp): Promise<CanonProposal> => {
    const targetFile = (await findCanonFile(project, pattern)) ?? `canon/${kind === 'summary' ? 'chapter-summaries' : 'continuity'}-updates.md`;
    const existing = await readTextIfExists(project.abs(targetFile));
    const proposal: CanonProposal = {
      id: newId('p'),
      chapterId: id,
      approvalId: approval.id,
      kind,
      targetFile,
      content,
      status: 'pending',
      createdAt: nowIso(),
      decidedAt: null,
      appliedCommit: null,
      targetHashAtCreation: existing === null ? null : sha256(existing),
    };
    await writeJson(project.abs(`${project.proposalsDir}/${proposal.id}.json`), proposal);
    return proposal;
  };
  return [await make('summary', summary, /summar/i), await make('continuity', continuity, /continuity/i)];
}

export async function listProposals(project: Project, chapterId?: string): Promise<CanonProposal[]> {
  const out: CanonProposal[] = [];
  for (const abs of await walkFiles(project.abs(project.proposalsDir))) {
    if (!abs.endsWith('.json')) continue;
    const p = await readJson<CanonProposal | null>(abs, null);
    if (p && (!chapterId || p.chapterId === chapterId)) out.push(p);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function loadProposal(project: Project, pid: string): Promise<{ file: string; proposal: CanonProposal }> {
  if (!/^p_[a-z0-9]+$/.test(pid)) throw new HttpError(400, 'Invalid proposal id');
  const file = `${project.proposalsDir}/${pid}.json`;
  const proposal = await readJson<CanonProposal | null>(project.abs(file), null);
  if (!proposal) throw new HttpError(404, 'Proposal not found');
  return { file, proposal };
}

function assertCanonTarget(project: Project, target: unknown): string {
  if (typeof target !== 'string' || !target.startsWith('canon/') || !/\.(md|markdown|txt)$/i.test(target)) {
    throw new HttpError(400, 'Canon updates can only target a text file inside canon/.');
  }
  project.abs(target); // rejects path traversal
  return target;
}

export async function updateProposal(project: Project, pid: string, patch: { content?: unknown; targetFile?: unknown }): Promise<CanonProposal> {
  return project.lock.run(async () => {
    const { file, proposal } = await loadProposal(project, pid);
    if (proposal.status !== 'pending') throw new HttpError(409, 'Only pending proposals can be edited');
    if (typeof patch.content === 'string') proposal.content = patch.content;
    if (patch.targetFile !== undefined) proposal.targetFile = assertCanonTarget(project, patch.targetFile);
    await writeJson(project.abs(file), proposal);
    await project.git.commit([file], `Edit canon proposal ${pid}`);
    return proposal;
  });
}

export async function rejectProposal(project: Project, pid: string): Promise<CanonProposal> {
  return project.lock.run(async () => {
    const { file, proposal } = await loadProposal(project, pid);
    if (proposal.status !== 'pending') throw new HttpError(409, 'This proposal has already been decided');
    proposal.status = 'rejected';
    proposal.decidedAt = nowIso();
    await writeJson(project.abs(file), proposal);
    await project.git.commit([file], `Reject canon proposal ${pid} (author decision)`);
    return proposal;
  });
}

/** Append the proposal to its canon file. Requires confirmation and an up-to-date preview. */
export async function applyProposal(
  project: Project,
  pid: string,
  input: { confirm?: unknown; expectedTargetHash?: unknown },
): Promise<CanonProposal> {
  if (input.confirm !== true) throw new HttpError(400, 'Canon updates must be confirmed explicitly by the author.');
  return project.lock.run(async () => {
    const { file, proposal } = await loadProposal(project, pid);
    if (proposal.status !== 'pending') throw new HttpError(409, 'This proposal has already been decided');
    const target = assertCanonTarget(project, proposal.targetFile);
    const abs = project.abs(target);
    const current = await readTextIfExists(abs);
    const currentHash = current === null ? null : sha256(current);
    if ((input.expectedTargetHash ?? null) !== currentHash) {
      throw new HttpError(409, 'The canon file changed after you previewed this update. Please review it again.');
    }
    const updated = current === null ? `${proposal.content.trim()}\n` : `${current.replace(/\s*$/, '')}\n\n${proposal.content.trim()}\n`;
    if (current === null) await writeNewFile(abs, updated);
    else await atomicWrite(abs, updated);

    const manifest = await readManifest(project);
    const entry = manifest.files[target] ?? { sha256: currentHash ?? '', size: 0, importedAt: nowIso(), source: '(created by author-confirmed proposal)' };
    entry.updates = [...(entry.updates ?? []), { date: nowIso(), proposalId: pid, sha256: sha256(updated) }];
    manifest.files[target] = entry;
    await writeJson(project.abs(project.manifestFile), manifest);

    proposal.status = 'applied';
    proposal.decidedAt = nowIso();
    await writeJson(project.abs(file), proposal);
    proposal.appliedCommit = await project.git.commit(
      [target, project.manifestFile, file],
      `Canon update (author-confirmed): ${target} from proposal ${pid}`,
    );
    await writeJson(project.abs(file), proposal);
    await project.git.commit([file], `Record commit for canon proposal ${pid}`);
    return proposal;
  });
}

export async function canonTargets(project: Project): Promise<string[]> {
  const out: string[] = [];
  for (const abs of await walkFiles(project.abs(LAYER_DIRS.canon!))) {
    const rel = path.relative(project.root, abs).split(path.sep).join('/');
    if (TEXT_EXT.test(rel)) out.push(rel);
  }
  return out;
}

export async function previewProposal(project: Project, pid: string): Promise<{ proposal: CanonProposal; current: string | null; currentHash: string | null; exists: boolean }> {
  const { proposal } = await loadProposal(project, pid);
  const target = assertCanonTarget(project, proposal.targetFile);
  const current = await readTextIfExists(project.abs(target));
  return { proposal, current, currentHash: current === null ? null : sha256(current), exists: await exists(project.abs(target)) };
}
