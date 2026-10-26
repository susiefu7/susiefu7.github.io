// End-to-end tests of the HTTP API against a real Git-backed project.
// The guiding property: no action can silently destroy manuscript text.

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { sha256 } from '../server/fsutil.ts';
import { importReference } from '../server/importer.ts';
import type { ChapterDocument, EditorialComment, VersionEntry } from '../shared/types.ts';
import { SAMPLE, makeWorkspace, type TestWorkspace } from './helpers.ts';

let ws: TestWorkspace;
before(async () => {
  ws = await makeWorkspace();
});
after(async () => {
  await ws.close();
});

async function chapter(id = 'ch01'): Promise<ChapterDocument> {
  const { status, data } = await ws.api<ChapterDocument>('GET', `/api/chapters/${id}`);
  assert.equal(status, 200);
  return data;
}

async function save(id: string, text: string, baseHash: string) {
  return ws.api<ChapterDocument & { error?: string }>('PUT', `/api/chapters/${id}`, { text, baseHash });
}

async function gitLog(): Promise<string[]> {
  return (await ws.project.git.run(['log', '--format=%s'])).trim().split('\n');
}

describe('import', () => {
  test('reference files are copied byte for byte and the source is untouched', async () => {
    for (const name of await fs.readdir(path.join(SAMPLE, 'canon'))) {
      const original = await fs.readFile(path.join(SAMPLE, 'canon', name));
      const copy = await fs.readFile(path.join(ws.root, 'canon', name));
      assert.equal(sha256(copy), sha256(original), name);
    }
    const { data: files } = await ws.api('GET', '/api/reference');
    const canon = files.filter((f: any) => f.layer === 'canon');
    assert.ok(canon.length >= 6);
    assert.ok(canon.every((f: any) => f.integrity === 'verified'));
  });

  test('re-importing never overwrites a different existing file', async () => {
    const tmp = path.join(ws.root, '..', 'conflict-src');
    await fs.mkdir(tmp, { recursive: true });
    await fs.writeFile(path.join(tmp, 'characters.md'), 'A DIFFERENT FILE');
    const before = await fs.readFile(path.join(ws.root, 'canon/characters.md'), 'utf8');
    const report = await importReference(ws.project, tmp, 'canon');
    assert.deepEqual(report.conflicts, ['canon/characters.md']);
    assert.equal(await fs.readFile(path.join(ws.root, 'canon/characters.md'), 'utf8'), before);
  });
});

describe('chapters', () => {
  test('lists chapters with number, title, status and word count', async () => {
    const { data } = await ws.api('GET', '/api/chapters');
    assert.deepEqual(data.map((c: any) => [c.id, c.number, c.title]), [
      ['ch01', 1, 'The Return'],
      ['ch02', 2, 'The Logbooks'],
      ['ch03', 3, 'The Sale'],
    ]);
    assert.ok(data[0].wordCount > 300);
    assert.equal(data[0].sceneCount, 3);
  });

  test('saving writes the file and commits it', async () => {
    const doc = await chapter();
    const text = doc.text.replace('low sky', 'low, pewter sky');
    const { status, data } = await save('ch01', text, doc.hash);
    assert.equal(status, 200);
    assert.equal(data.text, text);
    assert.equal(await fs.readFile(path.join(ws.root, 'manuscript/chapters/ch01/chapter.md'), 'utf8'), text);
    assert.match((await gitLog())[0], /^Save: ch01/);
  });

  test('a save based on a stale copy is refused and overwrites nothing', async () => {
    const doc = await chapter();
    const { status, data } = await save('ch01', 'CLOBBER', sha256('an older text'));
    assert.equal(status, 409);
    assert.match(data.error ?? '', /Nothing was overwritten/);
    assert.equal((await chapter()).text, doc.text);
  });

  test('edits made outside the app are detected before saving over them', async () => {
    const doc = await chapter('ch03');
    const file = path.join(ws.root, 'manuscript/chapters/ch03/chapter.md');
    await fs.appendFile(file, '\nAn edit made in another editor.\n');
    const { status } = await save('ch03', `${doc.text}\nMy edit.`, doc.hash);
    assert.equal(status, 409);
    assert.match(await fs.readFile(file, 'utf8'), /another editor/);
    // What the server does on its next start: record the outside edit in history.
    await ws.project.git.commit(['manuscript'], 'Record changes made outside the workspace');
  });

  test('a long chapter (≈8,000 words) saves and reads back intact', async () => {
    const created = await ws.api<ChapterDocument>('POST', '/api/chapters', { title: 'A long chapter' });
    assert.equal(created.status, 200);
    const para = 'She walked the length of the harbour wall and counted the boats, as she had as a child, and lost count. ';
    const text = Array.from({ length: 80 }, (_, i) => (i % 20 === 19 ? '* * *' : para.repeat(5))).join('\n\n');
    const started = Date.now();
    const { status, data } = await save(created.data.meta.id, text, created.data.hash);
    assert.equal(status, 200);
    assert.ok(data.wordCount > 7000, `word count ${data.wordCount}`);
    assert.equal(data.scenes.length, 4);
    assert.ok(Date.now() - started < 5000);
  });

  test('chapter ids cannot escape the project', async () => {
    const { status } = await ws.api('GET', '/api/chapters/..%2F..%2Fetc');
    assert.ok(status === 400 || status === 404);
  });
});

describe('recovery', () => {
  test('unsaved text is kept, offered back, and "discard" moves it aside', async () => {
    const doc = await chapter('ch02');
    await ws.api('PUT', '/api/chapters/ch02/recovery', { text: `${doc.text}\nUnsaved line.` });
    const withRecovery = await chapter('ch02');
    assert.match(withRecovery.recovery!.text, /Unsaved line/);
    await ws.api('POST', '/api/chapters/ch02/recovery/discard');
    assert.equal((await chapter('ch02')).recovery, null);
    const discarded = await fs.readdir(path.join(ws.root, '.recovery/discarded'));
    assert.equal(discarded.length, 1);
  });
});

describe('versions, comparison and restore', () => {
  test('named versions, reading old text, and a restore that can itself be undone', async () => {
    const doc = await chapter('ch02');
    const named = await ws.api('POST', '/api/chapters/ch02/versions', { name: 'Before the storm rewrite', note: 'Baseline' });
    assert.equal(named.status, 200);
    const original = doc.text;

    const rewritten = original.replace('There were forty-one of them', 'There were forty of them, give or take');
    const saved = await save('ch02', rewritten, doc.hash);
    assert.equal(saved.status, 200);

    const { data: versions } = await ws.api<VersionEntry[]>('GET', '/api/chapters/ch02/versions');
    const baseline = versions.find((v) => v.label === 'Before the storm rewrite')!;
    assert.ok(baseline);
    const old = await ws.api('GET', `/api/chapters/ch02/text?ref=${encodeURIComponent(baseline.ref)}`);
    assert.equal(old.data.text, original);

    const restored = await ws.api('POST', '/api/chapters/ch02/restore', { ref: baseline.ref, baseHash: saved.data.hash });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.chapter.text, original);

    // The rewritten text was preserved as a "pre-restore" version.
    const safety = restored.data.safetyVersion;
    assert.equal(safety.kind, 'pre-restore');
    const kept = await ws.api('GET', `/api/chapters/ch02/text?ref=commit:${safety.commit}`);
    assert.equal(kept.data.text, rewritten);
  });

  test('restore with a stale base is refused', async () => {
    const { data: versions } = await ws.api<VersionEntry[]>('GET', '/api/chapters/ch02/versions');
    const r = await ws.api('POST', '/api/chapters/ch02/restore', { ref: versions[1].ref, baseHash: 'stale' });
    assert.equal(r.status, 409);
  });

  test('legacy chapters are listed for comparison', async () => {
    const { data: versions } = await ws.api<VersionEntry[]>('GET', '/api/chapters/ch01/versions');
    const legacy = versions.find((v) => v.layer === 'legacy')!;
    assert.ok(legacy);
    const { data } = await ws.api('GET', `/api/chapters/ch01/text?ref=${encodeURIComponent(legacy.ref)}`);
    assert.match(data.text, /last bus/);
  });

  test('version refs cannot read arbitrary files', async () => {
    const r = await ws.api('GET', `/api/chapters/ch01/text?ref=${encodeURIComponent('legacy:../../project.json')}`);
    assert.equal(r.status, 400);
    const r2 = await ws.api('GET', `/api/chapters/ch01/text?ref=${encodeURIComponent('commit:HEAD;rm')}`);
    assert.equal(r2.status, 400);
  });
});

describe('editorial comments', () => {
  const quote = 'She had not meant to come back in winter.';

  async function comment(body: Record<string, unknown>) {
    const doc = await chapter();
    const start = doc.text.indexOf(quote);
    return ws.api<EditorialComment>('POST', '/api/chapters/ch01/comments', {
      start,
      end: start + quote.length,
      baseHash: doc.hash,
      category: 'pacing',
      body: 'Does this land too early?',
      ...body,
    });
  }

  test('attaches to a passage and survives edits elsewhere', async () => {
    const { status, data: c } = await comment({});
    assert.equal(status, 200);
    assert.equal(c.originalQuote, quote);
    const doc = await chapter();
    await save('ch01', `A new first line.\n\n${doc.text}`, doc.hash);
    const { data: comments } = await ws.api<EditorialComment[]>('GET', '/api/chapters/ch01/comments');
    const after = comments.find((x) => x.id === c.id)!;
    assert.equal(after.anchorState, 'relocated');
    const text = (await chapter()).text;
    assert.equal(text.slice(after.anchor.start, after.anchor.end), quote);
  });

  test('is flagged when its passage is rewritten, and the flag sticks', async () => {
    const { data: c } = await comment({ category: 'prose' });
    let doc = await chapter();
    await save('ch01', doc.text.replace(quote, 'She had not meant to come back in the dead of winter.'), doc.hash);
    let { data: comments } = await ws.api<EditorialComment[]>('GET', '/api/chapters/ch01/comments');
    assert.equal(comments.find((x) => x.id === c.id)!.anchorState, 'uncertain');
    assert.equal(comments.find((x) => x.id === c.id)!.originalQuote, quote);

    doc = await chapter();
    await save('ch01', `${doc.text}\n\nAn unrelated closing line.`, doc.hash);
    ({ data: comments } = await ws.api<EditorialComment[]>('GET', '/api/chapters/ch01/comments'));
    assert.equal(comments.find((x) => x.id === c.id)!.anchorState, 'uncertain');

    const confirmed = await ws.api<EditorialComment>('POST', `/api/chapters/ch01/comments/${c.id}/confirm-anchor`);
    assert.equal(confirmed.data.anchorState, 'anchored');
  });

  test('status, replies and author decisions are recorded; comments are never deleted', async () => {
    const { data: comments } = await ws.api<EditorialComment[]>('GET', '/api/chapters/ch01/comments');
    const c = comments[0];
    await ws.api('POST', `/api/chapters/ch01/comments/${c.id}/replies`, { body: 'I disagree — the reader needs this now.', role: 'author' });
    const updated = await ws.api<EditorialComment>('PATCH', `/api/chapters/ch01/comments/${c.id}`, {
      status: 'rejected',
      decision: { decision: 'rejected', note: 'Keeping the line. The early admission is the point.' },
    });
    assert.equal(updated.data.status, 'rejected');
    assert.equal(updated.data.replies.length, 1);
    assert.match(updated.data.decision!.note, /Keeping the line/);
    const del = await ws.api('DELETE', `/api/chapters/ch01/comments/${c.id}`);
    assert.equal(del.status, 404);
  });

  test('accepting an AI suggestion snapshots the draft first', async () => {
    const target = 'It was a relief.';
    let doc = await chapter();
    const start = doc.text.indexOf(target);
    const { data: c } = await ws.api<EditorialComment>('POST', '/api/chapters/ch01/comments', {
      start,
      end: start + target.length,
      baseHash: doc.hash,
      category: 'prose',
      body: 'Consider making the relief physical.',
      role: 'ai',
      by: 'AI editor',
      suggestedText: 'Her shoulders came down an inch.',
      reasoning: 'Shows rather than tells.',
    });
    // Nothing changes until the author accepts.
    assert.ok((await chapter()).text.includes(target));

    doc = await chapter();
    const r = await ws.api('POST', `/api/chapters/ch01/comments/${c.id}/accept-suggestion`, { baseHash: doc.hash });
    assert.equal(r.status, 200);
    assert.ok(r.data.chapter.text.includes('Her shoulders came down an inch.'));
    assert.equal(r.data.comment.status, 'resolved');

    const { data: versions } = await ws.api<VersionEntry[]>('GET', '/api/chapters/ch01/versions');
    const snapshot = versions.find((v) => v.kind === 'pre-ai')!;
    assert.ok(snapshot, 'pre-AI snapshot exists');
    const old = await ws.api('GET', `/api/chapters/ch01/text?ref=${encodeURIComponent(snapshot.ref)}`);
    assert.ok(old.data.text.includes(target));
  });
});

describe('approval and canon proposals', () => {
  test('approval requires explicit confirmation', async () => {
    const doc = await chapter('ch02');
    const r = await ws.api('POST', '/api/chapters/ch02/approve', { baseHash: doc.hash });
    assert.equal(r.status, 400);
    assert.equal(await fs.stat(path.join(ws.root, 'approved/ch02.md')).catch(() => null), null);
  });

  test('approving freezes the text; later edits and re-approval never overwrite it', async () => {
    const canonBefore = await fs.readFile(path.join(ws.root, 'canon/chapter-summaries.md'), 'utf8');
    let doc = await chapter('ch02');
    const approvedText = doc.text;
    const r = await ws.api('POST', '/api/chapters/ch02/approve', { baseHash: doc.hash, confirm: true, note: 'First approval' });
    assert.equal(r.status, 200);
    assert.equal(await fs.readFile(path.join(ws.root, 'approved/ch02.md'), 'utf8'), approvedText);
    assert.equal(r.data.proposals.length, 2);
    assert.ok(r.data.proposals.every((p: any) => p.status === 'pending'));
    // Canon is untouched by approval itself.
    assert.equal(await fs.readFile(path.join(ws.root, 'canon/chapter-summaries.md'), 'utf8'), canonBefore);
    assert.match((await gitLog())[0], /^Approve: ch02/);

    // Experimenting with a rewrite leaves the approved text alone.
    await save('ch02', `${approvedText}\n\nAn experimental new ending.`, doc.hash);
    assert.equal(await fs.readFile(path.join(ws.root, 'approved/ch02.md'), 'utf8'), approvedText);
    doc = await chapter('ch02');
    assert.equal(doc.draftMatchesApproved, false);

    // Re-approval archives the earlier approved text first.
    const r2 = await ws.api('POST', '/api/chapters/ch02/approve', { baseHash: doc.hash, confirm: true });
    assert.equal(r2.status, 200);
    const superseded = path.join(ws.root, r2.data.approval.supersededFile);
    assert.equal(await fs.readFile(superseded, 'utf8'), approvedText);
    assert.match(await fs.readFile(path.join(ws.root, 'approved/ch02.md'), 'utf8'), /experimental new ending/);
    const { data: approvals } = await ws.api('GET', '/api/chapters/ch02/approvals');
    assert.equal(approvals.length, 2);
  });

  test('canon updates need a fresh preview and explicit confirmation', async () => {
    const { data: proposals } = await ws.api('GET', '/api/proposals?chapter=ch02');
    const summary = proposals.find((p: any) => p.kind === 'summary' && p.status === 'pending');
    assert.equal(summary.targetFile, 'canon/chapter-summaries.md');
    assert.match(summary.content, /\[Author to write/);

    await ws.api('PATCH', `/api/proposals/${summary.id}`, { content: '## Chapter 2: The Logbooks\n\nIris finds a gap in the logs.' });
    const target = path.join(ws.root, 'canon/chapter-summaries.md');
    const before = await fs.readFile(target, 'utf8');

    assert.equal((await ws.api('POST', `/api/proposals/${summary.id}/apply`, { expectedTargetHash: sha256(before) })).status, 400);
    assert.equal((await ws.api('POST', `/api/proposals/${summary.id}/apply`, { confirm: true, expectedTargetHash: 'stale' })).status, 409);
    assert.equal(await fs.readFile(target, 'utf8'), before);

    const { data: preview } = await ws.api('GET', `/api/proposals/${summary.id}/preview`);
    const ok = await ws.api('POST', `/api/proposals/${summary.id}/apply`, { confirm: true, expectedTargetHash: preview.currentHash });
    assert.equal(ok.status, 200);
    const after = await fs.readFile(target, 'utf8');
    assert.ok(after.startsWith(before.trimEnd()));
    assert.match(after, /Iris finds a gap in the logs/);
    assert.match((await gitLog())[1], /Canon update \(author-confirmed\)/);

    // Integrity reflects the confirmed update rather than flagging it as tampering.
    const { data: files } = await ws.api('GET', '/api/reference');
    assert.equal(files.find((f: any) => f.path === 'canon/chapter-summaries.md').integrity, 'verified');
  });

  test('proposals cannot target files outside canon/', async () => {
    const { data: proposals } = await ws.api('GET', '/api/proposals?chapter=ch02');
    const pending = proposals.find((p: any) => p.status === 'pending');
    for (const bad of ['manuscript/chapters/ch01/chapter.md', 'canon/../project.json', 'approved/ch02.md']) {
      assert.equal((await ws.api('PATCH', `/api/proposals/${pending.id}`, { targetFile: bad })).status, 400, bad);
    }
  });
});

describe('reference library', () => {
  test('search labels each hit with its layer and covers drafts', async () => {
    const { data } = await ws.api('GET', `/api/search?q=${encodeURIComponent('Tomas')}`);
    const layers = new Set(data.hits.map((h: any) => h.layer));
    for (const l of ['canon', 'draft', 'legacy', 'directive']) assert.ok(layers.has(l), l);
    assert.equal(data.hits[0].inHeading, true);
  });

  test('search reports when nothing is established', async () => {
    const { data } = await ws.api('GET', `/api/search?q=${encodeURIComponent('zeppelin')}`);
    assert.equal(data.hits.length, 0);
    assert.ok(data.filesSearched > 5);
  });

  test('reference reads are confined to the library', async () => {
    assert.equal((await ws.api('GET', '/api/reference/file?path=canon/characters.md')).status, 200);
    assert.equal((await ws.api('GET', '/api/reference/file?path=manuscript/chapters/ch01/chapter.md')).status, 403);
    assert.equal((await ws.api('GET', `/api/reference/file?path=${encodeURIComponent('../../etc/passwd')}`)).status, 400);
  });

  test('there is no API that writes reference files', async () => {
    for (const method of ['PUT', 'POST', 'PATCH', 'DELETE']) {
      assert.equal((await ws.api(method, '/api/reference/file?path=canon/characters.md', { content: 'x' })).status, 404);
    }
  });
});

describe('request guards', () => {
  test('writes without the workspace header are refused', async () => {
    const doc = await chapter();
    const res = await fetch(`${ws.base}/api/chapters/ch01`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x', baseHash: doc.hash }),
    });
    assert.equal(res.status, 403);
  });

  test('foreign Host headers are refused (DNS rebinding)', async () => {
    // fetch() won't let us set Host, so use a raw request.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${ws.base}/api/chapters`, { headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });
});

describe('export', () => {
  test('exports drafts and approved text as Markdown', async () => {
    const { data: draft } = await ws.api('GET', '/api/export?which=draft');
    assert.match(draft, /## Chapter 1: The Return/);
    const { data: approved } = await ws.api('GET', '/api/export?which=approved');
    assert.match(approved, /_Not yet approved._/);
    assert.match(approved, /experimental new ending/);
  });
});

describe('history integrity', () => {
  test('the project working tree is clean after every operation', async () => {
    assert.deepEqual(await ws.project.git.dirtyPaths(['.']), []);
  });
});

describe('repository isolation', () => {
  test('a project inside another Git repository gets its own repository', async () => {
    const { Project } = await import('../server/project.ts');
    const { Git } = await import('../server/git.ts');
    const outer = path.join(ws.root, '..', 'outer-repo');
    await fs.mkdir(outer, { recursive: true });
    const outerGit = new Git(outer);
    await outerGit.init();
    const before = await outerGit.head();
    const nested = await Project.init(path.join(outer, 'nested-project'), 'Nested', 'Author');
    assert.equal(await nested.git.isRepo(), true);
    assert.equal(await outerGit.head(), before, 'the enclosing repository received no commits');
    assert.match((await nested.git.run(['log', '--format=%s'])).trim(), /Create project: Nested/);
  });
});
