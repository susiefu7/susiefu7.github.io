import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTexts } from '../shared/diff.ts';

test('identical texts', () => {
  assert.equal(compareTexts('a\n\nb', 'a\n\nb').identical, true);
});

test('a revised paragraph is a word-level change, not delete + insert', () => {
  const r = compareTexts(
    'The ferry came in under a low sky.\n\nShe waited.',
    'The ferry came in under a heavy, low sky.\n\nShe waited.',
  );
  assert.equal(r.rows[0].kind, 'changed');
  assert.ok(r.rows[0].right!.some((s) => s.type === 'ins' && s.text.includes('heavy')));
  assert.equal(r.rows[1].kind, 'same');
  assert.equal(r.stats.paragraphsChanged, 1);
  assert.equal(r.stats.wordsAdded, 1);
});

test('added and removed paragraphs', () => {
  const r = compareTexts('One.\n\nTwo is here.\n\nThree.', 'One.\n\nThree.\n\nA wholly new closing paragraph.');
  assert.deepEqual(r.rows.map((x) => x.kind), ['same', 'removed', 'same', 'added']);
  assert.equal(r.stats.paragraphsRemoved, 1);
  assert.equal(r.stats.paragraphsAdded, 1);
});
