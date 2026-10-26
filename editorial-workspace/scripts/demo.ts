// npm run demo
// Builds a throwaway project from sample-project/ in .demo-project/ and starts the
// workspace on it. Your real manuscript is not involved.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists } from '../server/fsutil.ts';
import { importChapters, importReference } from '../server/importer.ts';
import { Project } from '../server/project.ts';
import { main } from './cli.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.resolve(here, '../sample-project');
const target = path.resolve(here, '../.demo-project');

await main(async () => {
  if (!(await exists(target))) {
    const project = await Project.init(target, 'Sample Manuscript (demo data)', 'Author', {
      redevelopment: 'Sample: the story is being redeveloped. Older summaries, continuity records and drafts are historical.',
    });
    await importReference(project, path.join(sample, 'canon'), 'canon');
    await importReference(project, path.join(sample, 'directives'), 'directive');
    await importReference(project, path.join(sample, 'working-ideas'), 'idea');
    await importReference(project, path.join(sample, 'historical'), 'historical');
    await importReference(project, path.join(sample, 'legacy-manuscript'), 'legacy');
    await importChapters(project, path.join(sample, 'chapters'));
    console.log(`Demo project created at ${target}`);
  } else {
    console.log(`Using existing demo project at ${target} (delete the folder to start fresh)`);
  }
  if (!(await exists(path.resolve(here, '../dist/index.html')))) {
    await run('npx', ['vite', 'build']);
  }
  await fs.access(target);
  await run('npx', ['tsx', 'server/index.ts', '--project', target, ...process.argv.slice(2)]);
});

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: path.resolve(here, '..') });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}
