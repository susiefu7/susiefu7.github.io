// The redevelopment set-up: an empty manuscript, a blank working-draft Chapter 1,
// historical and legacy-manuscript layers, file import and reclassification.

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createChapter } from '../server/chapters.ts';
import { convertToMarkdown } from '../server/convert.ts';
import { sha256 } from '../server/fsutil.ts';
import { Git } from '../server/git.ts';
import { importChapters } from '../server/importer.ts';
import { Project } from '../server/project.ts';
import type { ChapterDocument, ChapterSummary, ReferenceFile, VersionEntry } from '../shared/types.ts';
import { makeWorkspace, type TestWorkspace } from './helpers.ts';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => fs.readFile(path.join(FIXTURES, name));

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tlp-redev-'));
}

describe('.docx and text conversion', () => {
  test('Word files from python-docx, pandoc and LibreOffice become clean Markdown', async () => {
    const py = convertToMarkdown('a.docx', await fixture('python-docx.docx'));
    assert.equal(
      py.markdown,
      [
        '# The Crossing',
        'The ferry came in under a *low* sky, and **Iris** stood at the rail.',
        '_**Both at once**_ — then “quoted” & <angled> text, café.',
        '* * *',
        '## At the harbour',
        '- A list item',
        'Line one\nline two\tafter a tab.',
      ].join('\n\n') + '\n',
    );
    assert.deepEqual(py.warnings, []);
    assert.equal(
      convertToMarkdown('b.docx', await fixture('pandoc.docx')).markdown,
      '# A Pandoc Chapter\n\nPandoc wrote *this* paragraph with **bold** text.\n\nSecond paragraph.\n',
    );
    assert.equal(
      convertToMarkdown('c.docx', await fixture('libreoffice.docx')).markdown,
      '# LibreOffice Chapter\n\nWritten by *LibreOffice* Writer, with **bold**.\n\nFinal paragraph.\n',
    );
  });

  test('plain text: line-per-paragraph, CRLF, BOM and Windows-1252 are handled', () => {
    const lines = convertToMarkdown('x.txt', Buffer.from('First paragraph.\r\nSecond paragraph.\r\n'));
    assert.equal(lines.markdown, 'First paragraph.\n\nSecond paragraph.\n');
    assert.match(lines.warnings[0], /paragraph breaks/);
    const blank = convertToMarkdown('x.txt', Buffer.from('One\nstill one.\n\nTwo.'));
    assert.equal(blank.markdown, 'One\nstill one.\n\nTwo.');
    assert.equal(convertToMarkdown('x.md', Buffer.from('﻿# Title\r\n\r\nText')).markdown, '# Title\n\nText');
    const latin1 = convertToMarkdown('x.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Windows-1252
    assert.equal(latin1.markdown, 'café');
    assert.match(latin1.warnings[0], /Windows-1252/);
  });

  test('damaged or unsupported files are refused with a reason', () => {
    assert.throws(() => convertToMarkdown('x.docx', Buffer.from('not a zip')), /not a valid \.docx/i);
    assert.throws(() => convertToMarkdown('x.pdf', Buffer.from('%PDF')), /Only \.md/);
  });
});

describe('setting up for the redevelopment', () => {
  test('an empty project with a blank working-draft Chapter 1 "Background"', async () => {
    const root = await tmp();
    const project = await Project.init(path.join(root, 'tlp'), 'The Long Picture', 'Author', { redevelopment: 'Being redeveloped.' });
    await createChapter(project, { number: 1, title: 'Background', text: '' });

    const text = await fs.readFile(path.join(project.root, 'manuscript/chapters/ch01/chapter.md'), 'utf8');
    assert.equal(text, '', 'no manuscript content is generated');
    const meta = JSON.parse(await fs.readFile(path.join(project.root, 'manuscript/chapters/ch01/chapter.json'), 'utf8'));
    assert.deepEqual([meta.number, meta.title, meta.status], [1, 'Background', 'drafting']);
    assert.deepEqual(await fs.readdir(path.join(project.root, 'manuscript/chapters')), ['.gitkeep', 'ch01']);
    for (const dir of ['canon', 'historical', 'archive/legacy-manuscript', 'approved', 'directives', 'working-ideas']) {
      assert.ok((await fs.stat(path.join(project.root, dir))).isDirectory(), dir);
    }
    assert.deepEqual(await fs.readdir(path.join(project.root, 'approved')), ['.gitkeep'], 'nothing approved');
    assert.equal(project.info(false).redevelopment?.active, true);
    assert.deepEqual(await project.git.dirtyPaths(['.']), []);
    await fs.rm(root, { recursive: true, force: true });
  });

  test('imported chapters (.md, .txt, .docx) are working drafts, never approved', async () => {
    const root = await tmp();
    const project = await Project.init(path.join(root, 'tlp'), 'T', 'A');
    const src = path.join(root, 'drafts');
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, '02 The Crossing.docx'), await fixture('python-docx.docx'));
    await fs.writeFile(path.join(src, '03-harbour.txt'), 'Line one.\nLine two.\n');
    await fs.writeFile(path.join(src, 'notes.pdf'), '%PDF');
    const report = await importChapters(project, src);
    assert.deepEqual(report.copied.sort(), ['manuscript/chapters/ch02/chapter.md', 'manuscript/chapters/ch03/chapter.md']);
    assert.match(report.conflicts.join(), /notes\.pdf/);
    assert.match(await fs.readFile(path.join(project.root, 'manuscript/chapters/ch02/chapter.md'), 'utf8'), /\*low\* sky/);
    const meta = JSON.parse(await fs.readFile(path.join(project.root, 'manuscript/chapters/ch02/chapter.json'), 'utf8'));
    assert.equal(meta.title, 'The Crossing');
    assert.deepEqual(await fs.readdir(path.join(project.root, 'approved')), ['.gitkeep']);
    assert.deepEqual(await fs.readdir(path.join(project.root, 'editorial/approvals')), ['.gitkeep']);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('an empty manuscript', () => {
  let ws: TestWorkspace;
  before(async () => {
    ws = await makeWorkspace({ empty: true, redevelopment: 'Being redeveloped.' });
  });
  after(() => ws.close());

  test('every view works with no chapters', async () => {
    assert.deepEqual((await ws.api('GET', '/api/chapters')).data, []);
    assert.deepEqual((await ws.api('GET', '/api/reference')).data, []);
    assert.deepEqual((await ws.api('GET', '/api/proposals')).data, []);
    const search = await ws.api('GET', '/api/search?q=anything');
    assert.equal(search.status, 200);
    assert.equal(search.data.hits.length, 0);
    const exported = await ws.api('GET', '/api/export?which=draft');
    assert.equal(exported.status, 200);
    assert.match(exported.data, /^# Test Project/);
    const project = await ws.api('GET', '/api/project');
    assert.equal(project.data.redevelopment.active, true);
  });

  test('create, paste, revise, compare and approve a chapter entirely in the app', async () => {
    const created = await ws.api<ChapterDocument>('POST', '/api/chapters', { title: 'Background', number: 1 });
    assert.equal(created.status, 200);
    assert.equal(created.data.text, '');
    assert.equal(created.data.approval, null);

    const pasted = 'The first paragraph, pasted in.\n\nThe second paragraph.';
    const saved = await ws.api<ChapterDocument>('PUT', '/api/chapters/ch01', { text: pasted, baseHash: created.data.hash });
    assert.equal(saved.status, 200);
    await ws.api('POST', '/api/chapters/ch01/versions', { name: 'First draft' });
    const revised = await ws.api<ChapterDocument>('PUT', '/api/chapters/ch01', {
      text: pasted.replace('second', 'revised second'),
      baseHash: saved.data.hash,
    });
    const { data: versions } = await ws.api<VersionEntry[]>('GET', '/api/chapters/ch01/versions');
    const first = versions.find((v) => v.label === 'First draft')!;
    assert.equal((await ws.api('GET', `/api/chapters/ch01/text?ref=${encodeURIComponent(first.ref)}`)).data.text, pasted);

    const approved = await ws.api('POST', '/api/chapters/ch01/approve', { baseHash: revised.data.hash, confirm: true });
    assert.equal(approved.status, 200);
    assert.equal(await fs.readFile(path.join(ws.root, 'approved/ch01.md'), 'utf8'), revised.data.text);
    // No canon file existed, and none is created until the author confirms a proposal.
    assert.deepEqual(await fs.readdir(path.join(ws.root, 'canon')), ['.gitkeep']);
  });

  test('a chapter can be created from imported text', async () => {
    const conv = await ws.api('POST', `/api/convert?name=${encodeURIComponent('Chapter 2.docx')}`, await fixture('pandoc.docx'));
    assert.equal(conv.status, 200);
    assert.equal(conv.data.format, 'docx');
    const before = await ws.project.git.head();
    assert.ok(conv.data.words > 5);
    assert.equal(await ws.project.git.head(), before, 'conversion writes nothing');
    const created = await ws.api<ChapterDocument>('POST', '/api/chapters', { title: 'From Word', number: 2, text: conv.data.markdown, source: 'Chapter 2.docx' });
    assert.equal(created.data.text, conv.data.markdown);
    assert.match((await ws.project.git.run(['log', '-1', '--format=%s'])).trim(), /imported from Chapter 2\.docx/);
    const { data: list } = await ws.api<ChapterSummary[]>('GET', '/api/chapters');
    assert.ok(list.every((c) => c.approval === null || c.id === 'ch01'));
  });
});

describe('reference files added in the app and reclassified', () => {
  let ws: TestWorkspace;
  before(async () => {
    ws = await makeWorkspace({ redevelopment: 'Being redeveloped.' });
  });
  after(() => ws.close());

  test('historical records and legacy drafts are separate, labelled layers', async () => {
    const { data: files } = await ws.api<ReferenceFile[]>('GET', '/api/reference');
    const at = (p: string) => files.find((f) => f.path === p)!;
    assert.equal(at('historical/chapter-summaries.md').layer, 'historical');
    assert.equal(at('archive/legacy-manuscript/chapter-01-draft-2024.md').layer, 'legacy');
    const docx = at('archive/legacy-manuscript/chapter-02-draft-2024.docx');
    assert.equal(docx.converted, true);
    assert.equal(docx.integrity, 'verified');
    const { data: hits } = await ws.api('GET', '/api/search?q=last%20bus');
    assert.deepEqual([...new Set(hits.hits.map((h: any) => h.layer))].sort(), ['historical', 'legacy']);
  });

  test('a .docx in the library is shown and searched without being modified', async () => {
    const rel = 'archive/legacy-manuscript/chapter-02-draft-2024.docx';
    const bytesBefore = await fs.readFile(path.join(ws.root, rel));
    const { data } = await ws.api('GET', `/api/reference/file?path=${encodeURIComponent(rel)}`);
    assert.equal(data.converted, true);
    assert.match(data.content, /# The Crossing/);
    const { data: search } = await ws.api('GET', '/api/search?q=ferry');
    assert.ok(search.hits.some((h: any) => h.file === rel));
    assert.ok((await fs.readFile(path.join(ws.root, rel))).equals(bytesBefore));
    const { data: versions } = await ws.api<VersionEntry[]>('GET', '/api/chapters/ch01/versions');
    const legacyDocx = versions.find((v) => v.ref === `legacy:chapter-02-draft-2024.docx`)!;
    const text = await ws.api('GET', `/api/chapters/ch01/text?ref=${encodeURIComponent(legacyDocx.ref)}`);
    assert.match(text.data.text, /The Crossing/, 'legacy .docx drafts can be compared with new chapters');
  });

  test('uploading a reference file stores it unaltered and never replaces another', async () => {
    const bytes = await fixture('libreoffice.docx');
    const up = await ws.api('POST', '/api/reference/upload?layer=historical&name=old-continuity.docx', bytes);
    assert.equal(up.status, 200);
    assert.deepEqual(up.data.copied, ['historical/old-continuity.docx']);
    assert.ok((await fs.readFile(path.join(ws.root, 'historical/old-continuity.docx'))).equals(bytes));
    const again = await ws.api('POST', '/api/reference/upload?layer=historical&name=old-continuity.docx', bytes);
    assert.deepEqual(again.data.alreadyPresent, ['historical/old-continuity.docx']);
    const clash = await ws.api('POST', '/api/reference/upload?layer=historical&name=old-continuity.docx', await fixture('pandoc.docx'));
    assert.equal(clash.status, 409);
    assert.ok((await fs.readFile(path.join(ws.root, 'historical/old-continuity.docx'))).equals(bytes));
    for (const bad of ['../escape.md', '.hidden', '']) {
      const r = await ws.api('POST', `/api/reference/upload?layer=canon&name=${encodeURIComponent(bad)}`, Buffer.from('x'));
      assert.ok(r.status === 400 || (r.status === 200 && r.data.copied[0] === 'canon/escape.md'), bad);
    }
    assert.equal((await ws.api('POST', '/api/reference/upload?layer=approved&name=x.md', Buffer.from('x'))).status, 400);
  });

  test('reclassifying needs confirmation, keeps history, integrity and note citations', async () => {
    const from = 'canon/relationships.md';
    const bytes = await fs.readFile(path.join(ws.root, from));
    const doc = await ws.api<ChapterDocument>('GET', '/api/chapters/ch01');
    const start = doc.data.text.indexOf('Tomas');
    const comment = await ws.api('POST', '/api/chapters/ch01/comments', {
      start,
      end: start + 5,
      baseHash: doc.data.hash,
      category: 'character',
      body: 'Check against the relationships file.',
      refs: [{ file: from, layer: 'canon', line: 3, excerpt: 'Iris Hale and Tomas Reyes' }],
    });

    assert.equal((await ws.api('POST', '/api/reference/move', { path: from, to: 'historical' })).status, 400);
    const moved = await ws.api('POST', '/api/reference/move', { path: from, to: 'historical', confirm: true });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.path, 'historical/relationships.md');
    assert.ok((await fs.readFile(path.join(ws.root, 'historical/relationships.md'))).equals(bytes));
    await assert.rejects(fs.access(path.join(ws.root, from)));

    const { data: files } = await ws.api<ReferenceFile[]>('GET', '/api/reference');
    assert.equal(files.find((f) => f.path === 'historical/relationships.md')!.integrity, 'verified');
    const { data: comments } = await ws.api('GET', '/api/chapters/ch01/comments');
    const ref = comments.find((c: any) => c.id === comment.data.id).refs[0];
    assert.deepEqual([ref.file, ref.layer], ['historical/relationships.md', 'historical']);
    const log = await ws.project.git.run(['log', '--follow', '--format=%s', '--', 'historical/relationships.md']);
    assert.match(log, /Reclassify \(author decision\)[\s\S]*Import \d+ canon file/);
    assert.deepEqual(await ws.project.git.dirtyPaths(['.']), []);
    assert.equal((await ws.api('POST', '/api/reference/move', { path: 'approved/ch01.md', to: 'canon', confirm: true })).status, 400);
  });
});

describe('upgrading an existing project', () => {
  test('archive/legacy moves to archive/legacy-manuscript with its history', async () => {
    const root = await tmp();
    const dir = path.join(root, 'old');
    await fs.mkdir(path.join(dir, 'archive/legacy'), { recursive: true });
    await fs.mkdir(path.join(dir, 'manuscript/chapters'), { recursive: true });
    await fs.mkdir(path.join(dir, 'editorial'), { recursive: true });
    await fs.writeFile(path.join(dir, 'archive/legacy/old-ch1.md'), 'Old chapter one.');
    await fs.writeFile(
      path.join(dir, 'editorial/canon-manifest.json'),
      JSON.stringify({ files: { 'archive/legacy/old-ch1.md': { sha256: sha256('Old chapter one.'), size: 16, importedAt: '', source: '' } } }),
    );
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ title: 'Old', schemaVersion: 1, authorName: 'A', createdAt: '' }));
    const git = new Git(dir);
    await git.init();
    await git.commit(['.'], 'Version 1 project');

    const project = await Project.open(dir);
    assert.equal(await fs.readFile(path.join(dir, 'archive/legacy-manuscript/old-ch1.md'), 'utf8'), 'Old chapter one.');
    await assert.rejects(fs.access(path.join(dir, 'archive/legacy')));
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'editorial/canon-manifest.json'), 'utf8'));
    assert.ok(manifest.files['archive/legacy-manuscript/old-ch1.md']);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).schemaVersion, 2);
    assert.deepEqual(await project.git.dirtyPaths(['.']), []);
    const log = await project.git.run(['log', '--follow', '--format=%s', '--', 'archive/legacy-manuscript/old-ch1.md']);
    assert.match(log, /Upgrade project layout[\s\S]*Version 1 project/);
    await fs.rm(root, { recursive: true, force: true });
  });
});
