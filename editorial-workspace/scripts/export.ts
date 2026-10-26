// npm run export -- [draft|approved] [output.md] [--project path]
// Writes the whole manuscript as a single Markdown file.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exportManuscript } from '../server/export.ts';
import { Project } from '../server/project.ts';
import { main, positionals, projectPath } from './cli.ts';

await main(async () => {
  const [kind = 'draft', out] = positionals();
  if (kind !== 'draft' && kind !== 'approved') throw new Error('Usage: npm run export -- [draft|approved] [output.md]');
  const project = await Project.open(projectPath());
  const file = path.resolve(out ?? `manuscript-${kind}-${new Date().toISOString().slice(0, 10)}.md`);
  try {
    await fs.access(file);
    throw new Error(`${file} already exists; choose another file name.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await fs.writeFile(file, await exportManuscript(project, kind), { flag: 'wx' });
  console.log(`\nExported ${kind} manuscript to ${file}\n`);
});
