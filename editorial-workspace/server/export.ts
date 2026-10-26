// Export the manuscript as one Markdown file, from drafts or from approved text.

import { listChapters, readDraft } from './chapters.ts';
import { readTextIfExists } from './fsutil.ts';
import type { Project } from './project.ts';

export async function exportManuscript(project: Project, which: 'draft' | 'approved'): Promise<string> {
  const title = project.info(false).title;
  const parts = [`# ${title}`, '', `_Exported ${new Date().toISOString().slice(0, 10)} — ${which === 'approved' ? 'approved text only' : 'working drafts'}_`, ''];
  for (const chapter of await listChapters(project)) {
    const text =
      which === 'approved'
        ? await readTextIfExists(project.abs(project.approvedText(chapter.id)))
        : await readDraft(project, chapter.id);
    parts.push(`\n## Chapter ${chapter.number}: ${chapter.title}\n`);
    // Demote the chapter's own headings so they sit under the chapter heading.
    parts.push(text === null ? '_Not yet approved._' : text.replace(/^(#{1,5})\s/gm, '#$1 ').trim(), '');
  }
  return `${parts.join('\n').trim()}\n`;
}
