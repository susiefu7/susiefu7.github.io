import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.ts';
import { importChapters, importReference } from '../server/importer.ts';
import { Project } from '../server/project.ts';

export const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sample-project');

export interface TestWorkspace {
  project: Project;
  root: string;
  base: string;
  api: <T = any>(method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; data: T }>;
  close: () => Promise<void>;
}

export async function makeWorkspace(options: { empty?: boolean; redevelopment?: string } = {}): Promise<TestWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tlp-test-'));
  const project = await Project.init(path.join(root, 'project'), 'Test Project', 'Author', { redevelopment: options.redevelopment });
  if (!options.empty) {
    await importReference(project, path.join(SAMPLE, 'canon'), 'canon');
    await importReference(project, path.join(SAMPLE, 'directives'), 'directive');
    await importReference(project, path.join(SAMPLE, 'working-ideas'), 'idea');
    await importReference(project, path.join(SAMPLE, 'historical'), 'historical');
    await importReference(project, path.join(SAMPLE, 'legacy-manuscript'), 'legacy');
    await importChapters(project, path.join(SAMPLE, 'chapters'));
  }

  const server = createApp(project).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const api: TestWorkspace['api'] = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', 'X-Workspace': '1', ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON (e.g. export) */
    }
    return { status: res.status, data };
  };

  return {
    project,
    root: project.root,
    base,
    api,
    close: async () => {
      await new Promise((r) => server.close(r));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
