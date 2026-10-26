// The Claude desktop connector, driven over the real MCP protocol by the SDK client.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EditorialComment } from '../shared/types.ts';
import { makeWorkspace, type TestWorkspace } from './helpers.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function connector(project: string, port: number): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), path.join(ROOT, 'server/mcp.ts'), '--project', project, '--port', String(port)],
      stderr: 'pipe',
    }),
  );
  return client;
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  return { text: r.content.map((c) => c.text).join('\n'), isError: Boolean(r.isError) };
}

describe('Claude desktop connector, using a running workspace', () => {
  let ws: TestWorkspace;
  let client: Client;
  before(async () => {
    ws = await makeWorkspace({ redevelopment: 'Being redeveloped.' });
    client = await connector(ws.root, Number(new URL(ws.base).port));
  });
  after(async () => {
    await client.close();
    await ws.close();
  });

  test('offers only reading and note-taking tools, with instructions', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'add_note',
      'get_project_overview',
      'list_notes',
      'read_chapter',
      'read_reference_file',
      'reply_to_note',
      'search_references',
    ]);
    assert.match(client.getInstructions() ?? '', /cannot change the manuscript or canon/);
    assert.match(client.getInstructions() ?? '', /Never invent canon/);
  });

  test('overview shows redevelopment, chapter standing and labelled layers', async () => {
    const { text } = await call(client, 'get_project_overview');
    assert.match(text, /Redevelopment in progress: Being redeveloped\./);
    assert.match(text, /1\. The Return — WORKING DRAFT — not approved canon/);
    assert.match(text, /Historical reference — pre-redevelopment:\n\s+historical\/chapter-summaries\.md/);
    assert.match(text, /Legacy manuscript — does not govern:/);
  });

  test('reads chapters and references; searching says when nothing is established', async () => {
    const chapter = await call(client, 'read_chapter', { chapter: '1' });
    assert.match(chapter.text, /Status: WORKING DRAFT/);
    assert.match(chapter.text, /The ferry came in under a low sky/);
    assert.match((await call(client, 'read_chapter', { chapter: 'The Logbooks' })).text, /forty-one/);
    assert.equal((await call(client, 'read_chapter', { chapter: '99' })).isError, true);
    assert.match((await call(client, 'read_reference_file', { path: 'canon/characters.md' })).text, /Layer: Locked canon/);
    assert.equal((await call(client, 'read_reference_file', { path: '../project.json' })).isError, true);
    assert.match((await call(client, 'search_references', { query: 'Tomas' })).text, /\[Locked canon\] canon\/characters\.md/);
    assert.match((await call(client, 'search_references', { query: 'zeppelin' })).text, /not established/);
  });

  test('adds a note on an approximately quoted passage without touching the text', async () => {
    const file = path.join(ws.root, 'manuscript/chapters/ch01/chapter.md');
    const before = await fs.readFile(file, 'utf8');
    const r = await call(client, 'add_note', {
      chapter: 'ch01',
      quote: '"You found the bread," he said.', // straight quotes; the draft uses straight quotes too
      category: 'dialogue',
      note: 'This line carries a lot of unspoken history.',
      reasoning: 'Tomas is described as speaking little (canon/characters.md).',
      suggested_rewrite: '"You found it," he said.',
      sources: [{ file: 'canon/characters.md', excerpt: 'Speaks little, notices everything' }],
    });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /has not changed/);
    assert.equal(await fs.readFile(file, 'utf8'), before);

    const { data: notes } = await ws.api<EditorialComment[]>('GET', '/api/chapters/ch01/comments');
    const note = notes.at(-1)!;
    assert.deepEqual([note.role, note.by, note.category, note.status], ['ai', 'Claude', 'dialogue', 'open']);
    assert.equal(note.originalQuote, '"You found the bread," he said.');
    assert.equal(note.suggestedText, '"You found it," he said.');
    assert.equal(note.refs[0].file, 'canon/characters.md');
    assert.ok(note.refs[0].line > 1);
    assert.match((await ws.project.git.run(['log', '-1', '--format=%s'])).trim(), /^Comment \(dialogue\) on ch01/);

    const reply = await call(client, 'reply_to_note', { chapter: '1', note_id: note.id, reply: 'On reflection, keep the original.' });
    assert.equal(reply.isError, false);
    const listed = await call(client, 'list_notes', { chapter: '1' });
    assert.match(listed.text, /Reply from Claude: On reflection/);
  });

  test('refuses notes it cannot place, and records nothing', async () => {
    const { data: before } = await ws.api<EditorialComment[]>('GET', '/api/chapters/ch01/comments');
    const missing = await call(client, 'add_note', { chapter: '1', quote: 'A sentence that is not in the chapter.', category: 'prose', note: 'x', reasoning: 'y' });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /No note was added/);
    const { data: after } = await ws.api<EditorialComment[]>('GET', '/api/chapters/ch01/comments');
    assert.equal(after.length, before.length);
  });
});

describe('Claude desktop connector, when the workspace is not running', () => {
  test('starts the workspace itself, which the browser can then use', async () => {
    const fresh = await makeWorkspace({ empty: true });
    const root = fresh.root;
    // A port nothing is listening on: the connector has to start the workspace itself.
    const port = await freePort();
    const client = await connector(root, port);
    try {
      const overview = await call(client, 'get_project_overview');
      assert.match(overview.text, /The manuscript is empty/);
      const res = await fetch(`http://127.0.0.1:${port}/api/project`);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).path, root);
    } finally {
      await client.close();
      await fresh.close();
    }
  });
});
