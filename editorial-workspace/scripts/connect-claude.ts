// npm run connect-claude -- [--project path] [--config path-to-claude_desktop_config.json]
//
// Registers the workspace connector with the Claude desktop app, so Claude can read
// your chapters and reference library and leave editorial notes (it cannot change
// the text). Other connectors in Claude's settings are left as they are, and the
// settings file is backed up before it is changed.

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists } from '../server/fsutil.ts';
import { main, option, projectPath } from './cli.ts';

export const SERVER_KEY = 'the-long-picture';

export function claudeConfigPath(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming'), 'Claude/claude_desktop_config.json');
  return path.join(os.homedir(), '.config/Claude/claude_desktop_config.json');
}

await main(async () => {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const project = projectPath();
  if (!(await exists(path.join(project, 'project.json')))) {
    throw new Error(`No manuscript project at ${project}. Run "npm run setup" first, or pass --project.`);
  }
  const tsxCli = path.join(appRoot, 'node_modules/tsx/dist/cli.mjs');
  if (!(await exists(tsxCli))) throw new Error('Dependencies are missing. Run "npm install" first.');

  const configPath = path.resolve(option('config') ?? claudeConfigPath());
  let config: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
  if (await exists(configPath)) {
    const raw = await fs.readFile(configPath, 'utf8');
    try {
      config = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`Claude's settings file could not be read (${configPath}). It was not changed. Fix or remove it, then try again.`);
    }
    const backup = `${configPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await fs.copyFile(configPath, backup);
    console.log(`Backed up Claude's settings to ${backup}`);
  }
  config.mcpServers = {
    ...(config.mcpServers ?? {}),
    [SERVER_KEY]: {
      command: process.execPath,
      args: [tsxCli, path.join(appRoot, 'server/mcp.ts'), '--project', project],
    },
  };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  // The connector also serves the workspace pages, which need the built interface.
  if (!(await exists(path.join(appRoot, 'dist/index.html'))) && !option('config')) {
    console.log('Building the workspace interface…');
    spawnSync('npx', ['vite', 'build'], { cwd: appRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  }

  console.log(`
Connected. Claude's settings: ${configPath}
Project: ${project}

Next:
  1. Quit the Claude desktop app completely and open it again.
  2. In a new chat, ask for example:
       "Using The Long Picture workspace, read Chapter 1 and check it against the
        canon. Leave notes on anything that contradicts it."
  3. Claude's notes appear in the workspace (http://localhost:4317) in the Notes
     panel, marked as AI suggestions. Nothing changes in your text unless you
     accept a suggestion.

While the Claude app is open it keeps the workspace running, so you don't need
"npm start" at the same time.
`);
});
