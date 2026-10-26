// `npm run connect-claude` edits the Claude desktop app's settings safely, and the
// command it writes really starts the connector.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Project } from '../server/project.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

async function connectClaude(project: string, config: string) {
  return run(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), path.join(ROOT, 'scripts/connect-claude.ts'), '--project', project, '--config', config], {
    cwd: ROOT,
  });
}

test('adds the connector, keeps other settings, backs up, and the command works', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tlp-claude-'));
  const project = (await Project.init(path.join(dir, 'TheLongPicture'), 'The Long Picture', 'A')).root;
  const config = path.join(dir, 'Claude/claude_desktop_config.json');
  await fs.mkdir(path.dirname(config), { recursive: true });
  const original = { theme: 'dark', mcpServers: { other: { command: 'other-tool', args: [] } } };
  await fs.writeFile(config, JSON.stringify(original));

  await connectClaude(project, config);
  const written = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.equal(written.theme, 'dark');
  assert.deepEqual(written.mcpServers.other, original.mcpServers.other);
  const entry = written.mcpServers['the-long-picture'];
  assert.equal(entry.command, process.execPath);
  assert.deepEqual(entry.args.slice(-2), ['--project', project]);
  const backups = (await fs.readdir(path.dirname(config))).filter((f) => f.includes('.backup-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(path.dirname(config), backups[0]), 'utf8')), original);

  // Start the connector exactly as Claude would, on a spare port.
  const client = new Client({ name: 'claude-desktop-stand-in', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: entry.command, args: [...entry.args, '--port', '4391'], stderr: 'pipe' }));
  const result = (await client.callTool({ name: 'get_project_overview', arguments: {} })) as { content: { text: string }[] };
  assert.match(result.content[0].text, /Project: The Long Picture/);
  await client.close();

  // Running it again updates the entry rather than duplicating it.
  await connectClaude(project, config);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(config, 'utf8')).mcpServers).sort(), ['other', 'the-long-picture']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a damaged settings file is left untouched', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tlp-claude-'));
  const project = (await Project.init(path.join(dir, 'P'), 'P', 'A')).root;
  const config = path.join(dir, 'claude_desktop_config.json');
  await fs.writeFile(config, '{ not json');
  await assert.rejects(connectClaude(project, config), /could not be read/);
  assert.equal(await fs.readFile(config, 'utf8'), '{ not json');
  await fs.rm(dir, { recursive: true, force: true });
});
