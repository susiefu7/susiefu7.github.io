// npm run setup -- [path] [--author "Name"]
//
// Creates The Long Picture's project for the redevelopment:
//   - the full folder layout, with an empty manuscript
//   - the redevelopment flag, so older summaries, continuity records and drafts are
//     shown as historical references rather than binding canon
//   - a blank Chapter 1, "Background", as a working draft (not approved)
// Refuses to touch an existing project. Generates no manuscript text.

import path from 'node:path';
import { createChapter } from '../server/chapters.ts';
import { Project } from '../server/project.ts';
import { main, option, positionals, projectPath } from './cli.ts';

export const REDEVELOPMENT_NOTE =
  'The novel is being redeveloped. Earlier chapter summaries, continuity records and chapter drafts ' +
  'are kept as historical references; they do not govern the redeveloped chapters.';

await main(async () => {
  const target = positionals()[0] ? path.resolve(positionals()[0]) : projectPath();
  const project = await Project.init(target, 'The Long Picture', option('author') ?? 'Author', { redevelopment: REDEVELOPMENT_NOTE });
  await createChapter(project, { number: 1, title: 'Background', text: '' });
  const p = `--project "${project.root}"`;
  console.log(`
Created The Long Picture at ${project.root}
  • manuscript/chapters/ch01 — Chapter 1, “Background”: blank working draft, not approved
  • redevelopment flag on: older records are labelled historical

Import your reference files (copied unaltered; nothing existing is replaced):
  npm run import -- canon             "<project bible, canon, style, current continuity>" ${p}
  npm run import -- historical        "<older chapter summaries & continuity records>" ${p}
  npm run import -- legacy-manuscript "<older chapter drafts>" ${p}

Then start the workspace:
  npm start -- ${p}
`);
});
