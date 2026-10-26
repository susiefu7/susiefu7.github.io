// npm run import -- <kind> <source folder> [--project path]
//
//   canon       reference documents (master canon, characters, style, briefs …) → canon/
//   directives  current author instructions for the redevelopment            → directives/
//   ideas       working ideas, explicitly not canon                           → working-ideas/
//   legacy      previously approved chapters from the earlier development     → archive/legacy/
//   chapters    chapter drafts (one file per chapter, number in the file name) → manuscript/chapters/
//
// Files are copied unaltered; nothing in the project is ever replaced. Stop the
// workspace server before importing.

import { importChapters, importReference, type ImportTarget } from '../server/importer.ts';
import { Project } from '../server/project.ts';
import { main, positionals, projectPath } from './cli.ts';

const KINDS: Record<string, ImportTarget | 'chapters'> = {
  canon: 'canon',
  reference: 'canon',
  directives: 'directive',
  ideas: 'idea',
  legacy: 'legacy',
  chapters: 'chapters',
};

await main(async () => {
  const [kind, source] = positionals();
  const target = KINDS[kind ?? ''];
  if (!target || !source) {
    throw new Error('Usage: npm run import -- <canon|directives|ideas|legacy|chapters> <source folder> [--project path]');
  }
  const project = await Project.open(projectPath());
  const report = target === 'chapters' ? await importChapters(project, source) : await importReference(project, source, target);
  console.log(`\nImported ${report.copied.length} file(s) into ${project.root}`);
  for (const f of report.copied) console.log(`  + ${f}`);
  if (report.alreadyPresent.length) console.log(`\nAlready present and identical (skipped): ${report.alreadyPresent.length}`);
  if (report.conflicts.length) {
    console.log(`\nNOT imported — a different file already exists (nothing was overwritten):`);
    for (const f of report.conflicts) console.log(`  ! ${f}`);
  }
  console.log('');
});
