// Editorial comments: create, discuss, classify, decide. Comments are never deleted —
// a rejected note and the author's reasons remain part of the record.

import { createAnchor } from '../shared/anchor.ts';
import type {
  AuthorDecision,
  CanonReference,
  ChapterDocument,
  CommentCategory,
  CommentStatus,
  ContributorRole,
  EditorialComment,
} from '../shared/types.ts';
import { COMMENT_CATEGORIES, COMMENT_STATUSES } from '../shared/types.ts';
import { assertBaseHash, getChapter, readDraft, readMeta, writeDraftAndCommit } from './chapters.ts';
import { readComments, writeComments } from './commentStore.ts';
import { HttpError, newId, nowIso } from './fsutil.ts';
import type { Project } from './project.ts';
import { createVersionUnlocked } from './versions.ts';

const ROLES: ContributorRole[] = ['author', 'editor', 'ai'];

function str(v: unknown, field: string, required = true): string {
  if (typeof v === 'string' && (v.trim() || !required)) return v.trim();
  if (!required && (v === undefined || v === null)) return '';
  throw new HttpError(400, `Missing ${field}`);
}

function parseRefs(v: unknown): CanonReference[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new HttpError(400, 'refs must be a list');
  return v.map((r) => ({
    file: str(r?.file, 'reference file'),
    layer: r?.layer,
    line: Number(r?.line) || 1,
    excerpt: str(r?.excerpt ?? '', 'excerpt', false).slice(0, 600),
  }));
}

async function commitComments(project: Project, chapterId: string, message: string): Promise<void> {
  await project.git.commit([project.commentsFile(chapterId)], message);
}

async function findComment(project: Project, chapterId: string, commentId: string) {
  const comments = await readComments(project, chapterId);
  const comment = comments.find((c) => c.id === commentId);
  if (!comment) throw new HttpError(404, 'Comment not found');
  return { comments, comment };
}

export async function createComment(project: Project, chapterId: string, input: Record<string, unknown>): Promise<EditorialComment> {
  const category = input.category as CommentCategory;
  if (!COMMENT_CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown comment category');
  const role = (input.role ?? 'author') as ContributorRole;
  if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown role');
  const body = str(input.body, 'comment text');
  const start = Number(input.start);
  const end = Number(input.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) throw new HttpError(400, 'Select a passage to comment on');

  return project.lock.run(async () => {
    const text = await readDraft(project, chapterId);
    // Offsets are only meaningful against the text the client was looking at.
    assertBaseHash(text, input.baseHash);
    if (end > text.length) throw new HttpError(400, 'Selection is outside the chapter');
    const anchor = createAnchor(text, start, end);
    const comment: EditorialComment = {
      id: newId('c'),
      chapterId,
      category,
      status: 'open',
      by: str(input.by ?? project.authorName, 'name'),
      role,
      body,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      originalQuote: anchor.exact,
      originalCommit: await project.git.lastCommitFor(project.chapterText(chapterId)),
      anchor,
      anchorState: 'anchored',
      suggestedText: typeof input.suggestedText === 'string' && input.suggestedText ? input.suggestedText : null,
      reasoning: typeof input.reasoning === 'string' && input.reasoning.trim() ? input.reasoning.trim() : null,
      refs: parseRefs(input.refs),
      replies: [],
      decision: null,
    };
    const comments = await readComments(project, chapterId);
    comments.push(comment);
    await writeComments(project, chapterId, comments);
    await commitComments(project, chapterId, `Comment (${category}) on ${chapterId}: ${body.slice(0, 60)}`);
    return comment;
  });
}

export async function updateComment(
  project: Project,
  chapterId: string,
  commentId: string,
  patch: Record<string, unknown>,
): Promise<EditorialComment> {
  return project.lock.run(async () => {
    const { comments, comment } = await findComment(project, chapterId, commentId);
    const changes: string[] = [];
    if (patch.category !== undefined) {
      if (!COMMENT_CATEGORIES.includes(patch.category as CommentCategory)) throw new HttpError(400, 'Unknown category');
      comment.category = patch.category as CommentCategory;
      changes.push(`category → ${comment.category}`);
    }
    if (patch.body !== undefined) {
      comment.body = str(patch.body, 'comment text');
      changes.push('text edited');
    }
    if (patch.refs !== undefined) {
      comment.refs = parseRefs(patch.refs);
      changes.push('references updated');
    }
    if (patch.status !== undefined) {
      if (!COMMENT_STATUSES.includes(patch.status as CommentStatus)) throw new HttpError(400, 'Unknown status');
      comment.status = patch.status as CommentStatus;
      changes.push(`status → ${comment.status}`);
    }
    if (patch.decision !== undefined) {
      const d = patch.decision as Partial<AuthorDecision> | null;
      if (d === null) comment.decision = null;
      else {
        if (!['accepted', 'rejected', 'deferred', 'resolved'].includes(String(d.decision))) throw new HttpError(400, 'Unknown decision');
        comment.decision = { decision: d.decision!, note: str(d.note ?? '', 'note', false), date: nowIso() };
      }
      changes.push('author decision recorded');
    }
    comment.updatedAt = nowIso();
    await writeComments(project, chapterId, comments);
    await commitComments(project, chapterId, `Comment ${commentId} on ${chapterId}: ${changes.join(', ') || 'updated'}`);
    return comment;
  });
}

export async function replyToComment(
  project: Project,
  chapterId: string,
  commentId: string,
  input: Record<string, unknown>,
): Promise<EditorialComment> {
  const role = (input.role ?? 'author') as ContributorRole;
  if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown role');
  const body = str(input.body, 'reply');
  return project.lock.run(async () => {
    const { comments, comment } = await findComment(project, chapterId, commentId);
    comment.replies.push({ id: newId('r'), by: str(input.by ?? project.authorName, 'name'), role, body, createdAt: nowIso() });
    comment.updatedAt = nowIso();
    await writeComments(project, chapterId, comments);
    await commitComments(project, chapterId, `Reply on ${chapterId} comment ${commentId}`);
    return comment;
  });
}

/** The author confirms that a flagged comment still points at the right passage. */
export async function confirmAnchor(project: Project, chapterId: string, commentId: string): Promise<EditorialComment> {
  return project.lock.run(async () => {
    const { comments, comment } = await findComment(project, chapterId, commentId);
    if (comment.anchorState === 'detached') throw new HttpError(400, 'This passage can no longer be found. Select its new location and re-attach instead.');
    comment.anchorState = 'anchored';
    comment.updatedAt = nowIso();
    await writeComments(project, chapterId, comments);
    await commitComments(project, chapterId, `Confirm comment position ${commentId} on ${chapterId}`);
    return comment;
  });
}

/** Attach a comment to a newly selected passage. The original quote is kept. */
export async function reattachComment(
  project: Project,
  chapterId: string,
  commentId: string,
  input: Record<string, unknown>,
): Promise<EditorialComment> {
  const start = Number(input.start);
  const end = Number(input.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) throw new HttpError(400, 'Select a passage');
  return project.lock.run(async () => {
    const text = await readDraft(project, chapterId);
    assertBaseHash(text, input.baseHash);
    const { comments, comment } = await findComment(project, chapterId, commentId);
    comment.anchor = createAnchor(text, start, end);
    comment.anchorState = 'anchored';
    comment.updatedAt = nowIso();
    await writeComments(project, chapterId, comments);
    await commitComments(project, chapterId, `Re-attach comment ${commentId} on ${chapterId}`);
    return comment;
  });
}

/**
 * Apply a comment's suggested replacement text. This is the only path by which an
 * editor's or AI's wording enters the draft, and it always:
 *   1. requires the author's explicit action,
 *   2. refuses if the passage position is uncertain or the text has moved on,
 *   3. snapshots the draft first ("pre-ai" for AI suggestions).
 */
export async function acceptSuggestion(
  project: Project,
  chapterId: string,
  commentId: string,
  input: Record<string, unknown>,
): Promise<{ chapter: ChapterDocument; comment: EditorialComment }> {
  return project.lock.run(async () => {
    const text = await readDraft(project, chapterId);
    assertBaseHash(text, input.baseHash);
    let { comment } = await findComment(project, chapterId, commentId);
    if (comment.suggestedText === null) throw new HttpError(400, 'This comment has no suggested text');
    if (comment.anchorState === 'uncertain' || comment.anchorState === 'detached') {
      throw new HttpError(409, 'The passage this suggestion refers to has changed. Confirm or re-attach its position first.');
    }
    if (text.slice(comment.anchor.start, comment.anchor.end) !== comment.anchor.exact) {
      throw new HttpError(409, 'The passage no longer matches the suggestion. Nothing was changed.');
    }
    const snippet = comment.anchor.exact.slice(0, 40).replace(/\s+/g, ' ');
    const snapshot = await createVersionUnlocked(
      project,
      chapterId,
      comment.role === 'ai' ? `Before AI-assisted revision: “${snippet}…”` : `Before accepting suggestion: “${snippet}…”`,
      `Suggestion by ${comment.by} (${comment.role}), comment ${comment.id}.`,
      comment.role === 'ai' ? 'pre-ai' : 'pre-suggestion',
    );
    const replacement = comment.suggestedText;
    const revised = text.slice(0, comment.anchor.start) + replacement + text.slice(comment.anchor.end);

    // Record the decision before re-anchoring so the accepted comment points at the new wording.
    const comments = await readComments(project, chapterId);
    comment = comments.find((c) => c.id === commentId)!;
    comment.status = 'resolved';
    comment.decision = {
      decision: 'accepted',
      note: `Suggestion applied. Earlier text kept in version “${snapshot.name}”.`,
      date: nowIso(),
    };
    comment.anchor = createAnchor(revised, comment.anchor.start, comment.anchor.start + replacement.length);
    comment.updatedAt = nowIso();
    await writeComments(project, chapterId, comments);

    const meta = await readMeta(project, chapterId);
    await writeDraftAndCommit(project, chapterId, revised, `Accept suggestion: ${chapterId} — ${meta.title} (comment ${commentId})`);
    const updated = (await readComments(project, chapterId)).find((c) => c.id === commentId)!;
    return { chapter: await getChapter(project, chapterId), comment: updated };
  });
}
