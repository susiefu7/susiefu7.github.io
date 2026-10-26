// npm run backup -- [destination folder] [--project path]
// Writes a single-file Git bundle containing the project's complete history, then
// verifies it. Restore with:  git clone <file>.bundle TheLongPicture

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Project } from '../server/project.ts';
import { main, positionals, projectPath } from './cli.ts';

await main(async () => {
  const project = await Project.open(projectPath()); // also commits any outside edits first
  const dest = path.resolve(positionals()[0] ?? path.join(path.dirname(project.root), 'TheLongPicture-backups'));
  await fs.mkdir(dest, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const file = path.join(dest, `${path.basename(project.root)}-${stamp}.bundle`);
  await project.git.bundle(file);
  const { size } = await fs.stat(file);
  console.log(`\nBackup written and verified: ${file} (${(size / 1024).toFixed(0)} KB)`);
  console.log(`Restore with:  git clone "${file}" TheLongPicture-restored\n`);
});
