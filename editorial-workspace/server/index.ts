// Entry point: `npm start` (builds the UI first) or `npm run serve`.
//
//   --project <path>   manuscript project folder (or TLP_PROJECT; default ~/TheLongPicture)
//   --port <n>         port to listen on (or TLP_PORT; default 4317)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { defaultProjectPath } from './paths.ts';
import { Project } from './project.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const projectPath = path.resolve(arg('project') ?? defaultProjectPath());
const port = Number(arg('port') ?? process.env.TLP_PORT ?? 4317);
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

try {
  const project = await Project.open(projectPath);
  const app = createApp(project, { staticDir });
  // Express 5 reports listen errors (e.g. port in use) through this callback.
  app.listen(port, '127.0.0.1', (error?: Error) => {
    if (error) {
      const inUse = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
      console.error(inUse ? `\nPort ${port} is already in use — is the workspace already running? Try --port 4318.\n` : `\n${error.message}\n`);
      process.exit(1);
    }
    console.log(`\n  The Long Picture — Editorial Workspace`);
    console.log(`  Project: ${projectPath}`);
    console.log(`  Open:    http://localhost:${port}\n`);
  });
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
}
