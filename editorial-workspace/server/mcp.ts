// Connector for the Claude desktop app (Model Context Protocol over stdio).
//
// Claude can read chapters and the reference library and leave editorial notes. It
// cannot change chapter text or canon: there is no tool for that. Every request goes
// through the workspace's own HTTP API, so the same checks, locks and Git history
// apply as in the browser. If the workspace isn't running, this process starts it,
// so http://localhost:4317 also works while the Claude app is open.
//
//   tsx server/mcp.ts --project <path> [--port 4317]
// Set up automatically by `npm run connect-claude`.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { describeMiss, findQuote } from '../shared/quote.ts';
import type {
  ChapterDocument,
  ChapterSummary,
  EditorialComment,
  Layer,
  ProjectInfo,
  ReferenceFile,
  SearchResult,
} from '../shared/types.ts';
import { COMMENT_CATEGORIES, LAYER_LABELS } from '../shared/types.ts';
import { createApp } from './app.ts';
import { defaultProjectPath } from './paths.ts';
import { Project } from './project.ts';

// stdout carries the protocol; anything else printed there would corrupt it.
console.log = console.error;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const projectPath = path.resolve(arg('project') ?? defaultProjectPath());
const port = Number(arg('port') ?? process.env.TLP_PORT ?? 4317);
const base = `http://127.0.0.1:${port}`;
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const AUTHOR = 'Claude';

const same = (a: string, b: string) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
};

// ── Reaching the workspace ───────────────────────────────────────────────────

let ready: Promise<void> | null = null;

async function probe(): Promise<ProjectInfo | null> {
  try {
    const res = await fetch(`${base}/api/project`);
    return res.ok ? ((await res.json()) as ProjectInfo) : null;
  } catch {
    return null;
  }
}

/** Use the running workspace, or start it in this process. */
async function connect(): Promise<void> {
  const running = await probe();
  if (running) {
    if (!same(running.path, projectPath)) {
      throw new Error(`The workspace running on port ${port} has a different project open (${running.path}).`);
    }
    return;
  }
  const project = await Project.open(projectPath);
  await new Promise<void>((resolve, reject) => {
    createApp(project, { staticDir }).listen(port, '127.0.0.1', (error?: Error) => (error ? reject(error) : resolve()));
  }).catch(async (error) => {
    if (await probe()) return; // started elsewhere at the same moment
    throw error;
  });
}

function ensureConnected(): Promise<void> {
  ready ??= connect().catch((e) => {
    ready = null; // try again on the next request
    throw e;
  });
  return ready;
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  await ensureConnected();
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Workspace': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;

// ── Formatting ───────────────────────────────────────────────────────────────

function chapterStanding(c: { approval: unknown; draftMatchesApproved: boolean | null }): string {
  if (!c.approval) return 'WORKING DRAFT — not approved canon';
  return c.draftMatchesApproved ? 'APPROVED (draft matches the approved text)' : 'APPROVED earlier — the working draft has changed since';
}

async function resolveChapter(ref: string): Promise<ChapterSummary> {
  const chapters = await api<ChapterSummary[]>('GET', '/chapters');
  const wanted = ref.trim().toLowerCase().replace(/^chapter\s+/, '');
  const found =
    chapters.find((c) => c.id === wanted) ??
    chapters.find((c) => String(c.number) === wanted) ??
    chapters.find((c) => c.title.toLowerCase() === wanted);
  if (!found) {
    throw new Error(`No chapter “${ref}”. Chapters: ${chapters.map((c) => `${c.number} ${c.title}`).join('; ') || 'none yet'}.`);
  }
  return found;
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const failure = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true });

async function run(fn: () => Promise<string>) {
  try {
    return text(await fn());
  } catch (e) {
    return failure(e instanceof Error ? e.message : String(e));
  }
}

// ── Server ───────────────────────────────────────────────────────────────────

const INSTRUCTIONS = `You are working as an editor with the author of a long literary novel, inside their private editorial workspace.

- You can read chapters and the reference library, search it, read existing editorial notes, add notes and reply to notes. You cannot change the manuscript or canon; the author makes every decision.
- Order of authority: author directives, then locked canon, then approved chapters. Working drafts and working ideas are not established fact. Historical records and the legacy manuscript describe the novel before its redevelopment and do not govern the new chapters.
- If the reference library does not establish something, say so plainly. Never invent canon, and never present a guess as fact.
- Start with get_project_overview. Read the chapter before commenting on it, and check names, events and relationships against the references.
- Every note needs your reasoning. Quote the passage exactly as it appears in the draft. Offer a suggested rewrite only for the exact words you quote.
- To propose new prose, attach it as a suggested rewrite to the passage it would replace, or give it in the conversation for the author to paste in. Never say text has been added to the manuscript.`;

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'the-long-picture-workspace', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'get_project_overview',
    {
      title: 'Project overview',
      description: 'The project, its redevelopment status, the rules of authority, every chapter with its status, and the files in the reference library. Call this first.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const [project, chapters, files] = await Promise.all([
          api<ProjectInfo>('GET', '/project'),
          api<ChapterSummary[]>('GET', '/chapters'),
          api<ReferenceFile[]>('GET', '/reference'),
        ]);
        const lines = [`Project: ${project.title}`];
        if (project.redevelopment?.active) lines.push(`Redevelopment in progress: ${project.redevelopment.note}`);
        lines.push(
          '',
          'Authority: author directives > locked canon > approved chapters. Working drafts and ideas are not established fact. Historical and legacy material does not govern.',
          '',
          `Chapters (${chapters.length}):`,
        );
        if (!chapters.length) lines.push('  (The manuscript is empty.)');
        for (const c of chapters) {
          lines.push(`  ${c.number}. ${c.title} — ${chapterStanding(c)}; ${c.wordCount} words, ${c.sceneCount} scenes, ${c.openComments} open notes`);
        }
        const order: Layer[] = ['directive', 'canon', 'approved', 'idea', 'historical', 'legacy', 'superseded'];
        lines.push('', 'Reference library (use read_reference_file with the path):');
        for (const layer of order) {
          const list = files.filter((f) => f.layer === layer);
          if (!list.length) continue;
          lines.push(`  ${LAYER_LABELS[layer]}:`);
          for (const f of list) lines.push(`    ${f.path}${f.searchable ? '' : ' (not readable)'}`);
        }
        if (!files.length) lines.push('  (No reference files yet.)');
        return lines.join('\n');
      }),
  );

  server.registerTool(
    'read_chapter',
    {
      title: 'Read a chapter',
      description: 'Read a chapter in full (Markdown). By default the working draft; ask for "approved" to read the frozen approved text.',
      inputSchema: {
        chapter: z.string().describe('Chapter number, id (e.g. "ch03") or title'),
        version: z.enum(['draft', 'approved']).optional().describe('Which text to read (default: draft)'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ chapter, version }) =>
      run(async () => {
        const c = await resolveChapter(chapter);
        const doc = await api<ChapterDocument>('GET', `/chapters/${c.id}`);
        const body = version === 'approved' ? (await api<{ text: string }>('GET', `/chapters/${c.id}/text?ref=approved`)).text : doc.text;
        const scenes = doc.scenes.map((s) => `  ${s.index}. ${s.title} (${s.wordCount} words)`).join('\n');
        return [
          `Chapter ${c.number}: ${c.title}`,
          `Status: ${chapterStanding(doc)}. Showing the ${version === 'approved' ? 'approved text' : 'working draft'}.`,
          `${doc.wordCount} words. Scenes:\n${scenes || '  (none)'}`,
          '',
          '-----',
          body.trim() ? body : '(This chapter is empty.)',
        ].join('\n');
      }),
  );

  server.registerTool(
    'read_reference_file',
    {
      title: 'Read a reference file',
      description: 'Read a file from the reference library (canon, directives, ideas, historical records, legacy manuscript, approved copies), with its layer.',
      inputSchema: { path: z.string().describe('Path as listed by get_project_overview, e.g. "canon/characters.md"') },
      annotations: { readOnlyHint: true },
    },
    ({ path: file }) =>
      run(async () => {
        const f = await api<{ path: string; layer: Layer; content: string }>('GET', `/reference/file?path=${enc(file)}`);
        return `${f.path}\nLayer: ${LAYER_LABELS[f.layer]}\n-----\n${f.content}`;
      }),
  );

  server.registerTool(
    'search_references',
    {
      title: 'Search references',
      description:
        'Search the reference library and the chapter drafts for a name, place, event or phrase (quote a phrase for an exact match). Each hit is labelled with its layer. No hits means it is not established.',
      inputSchema: { query: z.string().describe('Words or a "quoted phrase"') },
      annotations: { readOnlyHint: true },
    },
    ({ query }) =>
      run(async () => {
        const r = await api<SearchResult>('GET', `/search?q=${enc(query)}`);
        if (!r.hits.length) {
          return `No reference found for “${r.query}” in ${r.filesSearched} files. It is not established — say so rather than inventing it.${
            r.unsearchable.length ? ` (${r.unsearchable.length} file(s) could not be read: ${r.unsearchable.join(', ')}.)` : ''
          }`;
        }
        return [
          `${r.hits.length} result(s) for “${r.query}”:`,
          ...r.hits.slice(0, 60).map((h) => `- [${LAYER_LABELS[h.layer]}] ${h.file}, line ${h.line}${h.heading ? ` (${h.heading})` : ''}: ${h.snippet}`),
          r.hits.length > 60 ? `…and ${r.hits.length - 60} more; narrow the search.` : '',
        ].join('\n');
      }),
  );

  server.registerTool(
    'list_notes',
    {
      title: 'List editorial notes',
      description: 'The editorial notes on a chapter: who wrote them, the passage, the discussion and the author’s decisions.',
      inputSchema: {
        chapter: z.string().describe('Chapter number, id or title'),
        include_closed: z.boolean().optional().describe('Also show resolved, rejected and deferred notes'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ chapter, include_closed }) =>
      run(async () => {
        const c = await resolveChapter(chapter);
        const notes = (await api<EditorialComment[]>('GET', `/chapters/${c.id}/comments`)).filter((n) => include_closed || n.status === 'open');
        if (!notes.length) return `No ${include_closed ? '' : 'open '}notes on Chapter ${c.number}.`;
        return notes
          .map((n) =>
            [
              `[${n.id}] ${n.category}, ${n.status}, by ${n.by} (${n.role})${n.anchorState !== 'anchored' ? ` — position ${n.anchorState}` : ''}`,
              `  Passage: “${n.originalQuote.slice(0, 300)}”`,
              `  Note: ${n.body}`,
              ...n.replies.map((r) => `  Reply from ${r.by}: ${r.body}`),
              n.decision ? `  Author decision: ${n.decision.decision}${n.decision.note ? ` — ${n.decision.note}` : ''}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n\n');
      }),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add an editorial note',
      description:
        'Attach an editorial note to a passage of a chapter. It appears in the workspace as an AI suggestion for the author to accept, reject or discuss. The chapter text is not changed.',
      inputSchema: {
        chapter: z.string().describe('Chapter number, id or title'),
        quote: z.string().describe('The passage, quoted exactly from the current draft (a sentence or two is best). For a long passage: "opening words ... closing words".'),
        category: z.enum(COMMENT_CATEGORIES as [string, ...string[]]).describe('Type of note'),
        note: z.string().describe('The editorial observation, addressed to the author'),
        reasoning: z.string().describe('Why — the evidence and editorial reasoning behind the note'),
        suggested_rewrite: z.string().optional().describe('Optional replacement for exactly the quoted words. Only applied if the author accepts it.'),
        sources: z
          .array(z.object({ file: z.string(), excerpt: z.string() }))
          .optional()
          .describe('Reference passages that support the note (file path and a short excerpt)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      run(async () => {
        const c = await resolveChapter(input.chapter);
        const doc = await api<ChapterDocument>('GET', `/chapters/${c.id}`);
        const match = findQuote(doc.text, input.quote);
        if (!match.ok) throw new Error(`No note was added. ${describeMiss(match)}`);

        const refs = [];
        const unresolved: string[] = [];
        for (const s of input.sources ?? []) {
          try {
            const f = await api<{ path: string; layer: Layer; content: string }>('GET', `/reference/file?path=${enc(s.file)}`);
            const probeText = s.excerpt.slice(0, 40).toLowerCase();
            const line = f.content.split('\n').findIndex((l) => l.toLowerCase().includes(probeText));
            refs.push({ file: f.path, layer: f.layer, line: line === -1 ? 1 : line + 1, excerpt: s.excerpt.slice(0, 600) });
          } catch {
            unresolved.push(s.file);
          }
        }
        const created = await api<EditorialComment>('POST', `/chapters/${c.id}/comments`, {
          start: match.start,
          end: match.end,
          baseHash: doc.hash,
          category: input.category,
          body: input.note,
          reasoning: input.reasoning,
          suggestedText: input.suggested_rewrite ?? null,
          refs,
          role: 'ai',
          by: AUTHOR,
        });
        return [
          `Note ${created.id} added to Chapter ${c.number} (${input.category}) on “${created.originalQuote.slice(0, 120)}${created.originalQuote.length > 120 ? '…' : ''}”.`,
          'The author will see it in the Notes panel and decide. The chapter text has not changed.',
          unresolved.length ? `These sources were not found in the library and were left out: ${unresolved.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join('\n');
      }),
  );

  server.registerTool(
    'reply_to_note',
    {
      title: 'Reply to a note',
      description: 'Add a reply to an existing editorial note, e.g. to answer the author or record a disagreement. Get note ids from list_notes.',
      inputSchema: {
        chapter: z.string().describe('Chapter number, id or title'),
        note_id: z.string().describe('The note id, e.g. "c_abc123"'),
        reply: z.string().describe('The reply'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ chapter, note_id, reply }) =>
      run(async () => {
        const c = await resolveChapter(chapter);
        await api('POST', `/chapters/${c.id}/comments/${enc(note_id)}/replies`, { body: reply, role: 'ai', by: AUTHOR });
        return `Reply added to note ${note_id}.`;
      }),
  );

  return server;
}

// Start when run directly (not when imported by tests).
if (process.argv[1] && same(process.argv[1], fileURLToPath(import.meta.url))) {
  ensureConnected().catch((e) => console.error(`Workspace not available yet: ${e instanceof Error ? e.message : e}`));
  await buildServer().connect(new StdioServerTransport());
}
