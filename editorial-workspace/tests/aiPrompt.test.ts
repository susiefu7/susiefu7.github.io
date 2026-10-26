import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChapterDocument } from '../shared/types.ts';
import { buildAiRequest } from '../src/aiPrompt.ts';

const doc = {
  meta: { id: 'ch01', number: 1, title: 'Background', status: 'drafting', createdAt: '', updatedAt: '' },
  text: 'She waited by the harbour.\n\nIt was a relief.',
  hash: 'x',
  scenes: [],
  wordCount: 8,
  approval: null,
  draftMatchesApproved: null,
  recovery: null,
} as ChapterDocument;

test('a request carries rules, task, format, chapter, passage and canon — not historical files', () => {
  const { text, omitted } = buildAiRequest({
    projectTitle: 'The Long Picture',
    redevelopment: { active: true, since: null, note: 'Older records are historical.' },
    doc,
    task: 'review',
    instruction: 'Is the relief earned?',
    passage: 'It was a relief.',
    references: [
      { path: 'directives/now.md', layer: 'directive', content: 'Arrives by ferry.' },
      { path: 'canon/characters.md', layer: 'canon', content: '## Iris Hale' },
      { path: 'historical/old-summaries.md', layer: 'historical', content: 'OLD SUMMARY' },
      { path: 'archive/legacy-manuscript/old.md', layer: 'legacy', content: 'OLD DRAFT' },
    ],
  });
  assert.deepEqual(omitted, []);
  for (const expected of [
    '“The Long Picture”',
    'Never invent canon',
    'The novel is being redeveloped: Older records are historical.',
    'Author’s instruction: Is the relief earned?',
    'END NOTE',
    '=== CHAPTER 1: Background (WORKING DRAFT — not approved canon) ===',
    '=== FOCUS PASSAGE (from the chapter above) ===\nIt was a relief.',
    '=== REFERENCE: AUTHOR DIRECTIVES (highest authority) ===\n--- directives/now.md ---\nArrives by ferry.',
    '--- canon/characters.md ---',
  ]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(!text.includes('OLD SUMMARY') && !text.includes('OLD DRAFT'));
  assert.ok(text.indexOf('AUTHOR DIRECTIVES') < text.indexOf('LOCKED CANON'), 'directives come first');
  assert.ok(!/\n\n\n/.test(text));
});

test('with no canon yet, the request says nothing is established', () => {
  const { text } = buildAiRequest({ projectTitle: 'T', redevelopment: null, doc, task: 'chapter', instruction: '', passage: null, references: [] });
  assert.match(text, /No canon or directives are in the reference library yet/);
  assert.ok(!text.includes('FOCUS PASSAGE'));
  assert.ok(!text.includes('redeveloped'));
});
