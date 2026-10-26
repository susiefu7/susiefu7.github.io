// npm run init-project -- [path] [--title "The Long Picture"] [--author "Name"]
// Creates an empty manuscript project. Refuses to touch an existing one.

import path from 'node:path';
import { Project } from '../server/project.ts';
import { main, option, positionals, projectPath } from './cli.ts';

await main(async () => {
  const target = positionals()[0] ? path.resolve(positionals()[0]) : projectPath();
  const project = await Project.init(target, option('title') ?? 'The Long Picture', option('author') ?? 'Author');
  console.log(`\nCreated a manuscript project at ${project.root}`);
  console.log(`\nNext steps:`);
  console.log(`  npm run import -- canon "/path/to/your/reference documents" --project "${project.root}"`);
  console.log(`  npm start -- --project "${project.root}"\n`);
});
