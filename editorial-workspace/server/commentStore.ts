// Low-level storage for editorial comments, plus re-anchoring after the text changes.

import { reanchor, stickierState } from '../shared/anchor.ts';
import type { EditorialComment } from '../shared/types.ts';
import { nowIso, readJson, writeJson } from './fsutil.ts';
import type { Project } from './project.ts';

export async function readComments(project: Project, chapterId: string): Promise<EditorialComment[]> {
  return readJson<EditorialComment[]>(project.abs(project.commentsFile(chapterId)), []);
}

export async function writeComments(project: Project, chapterId: string, comments: EditorialComment[]): Promise<void> {
  await writeJson(project.abs(project.commentsFile(chapterId)), comments);
}

/**
 * Re-locate every comment against a new text. Returns true if anything changed.
 * The original quote is never modified.
 */
export async function reanchorComments(project: Project, chapterId: string, text: string): Promise<boolean> {
  const comments = await readComments(project, chapterId);
  let changed = false;
  for (const c of comments) {
    const result = reanchor(c.anchor, text);
    const state = stickierState(c.anchorState, result.state);
    if (
      state !== c.anchorState ||
      result.anchor.start !== c.anchor.start ||
      result.anchor.end !== c.anchor.end ||
      result.anchor.exact !== c.anchor.exact
    ) {
      // A detached anchor keeps its last known quote so it can be found again later.
      c.anchor = result.state === 'detached' ? { ...c.anchor, start: result.anchor.start, end: result.anchor.end } : result.anchor;
      c.anchorState = state;
      c.updatedAt = nowIso();
      changed = true;
    }
  }
  if (changed) await writeComments(project, chapterId, comments);
  return changed;
}
