import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnchor, reanchor, stickierState } from '../shared/anchor.ts';

const text = 'The ferry came in under a low sky, and Iris stood at the rail long after the other passengers had gone below.';
const start = text.indexOf('Iris stood at the rail');
const anchor = createAnchor(text, start, start + 'Iris stood at the rail'.length);

test('unchanged text stays anchored', () => {
  assert.equal(reanchor(anchor, text).state, 'anchored');
});

test('text inserted before the passage relocates it', () => {
  const revised = `A new opening sentence. ${text}`;
  const r = reanchor(anchor, revised);
  assert.equal(r.state, 'relocated');
  assert.equal(revised.slice(r.anchor.start, r.anchor.end), 'Iris stood at the rail');
});

test('an edit inside the passage makes it uncertain', () => {
  const revised = text.replace('Iris stood at the rail', 'Iris stood alone and silent at the rail');
  const r = reanchor(anchor, revised);
  assert.equal(r.state, 'uncertain');
  assert.match(revised.slice(r.anchor.start, r.anchor.end), /Iris stood.*rail/);
});

test('a deleted passage is detached and keeps its quote', () => {
  const r = reanchor(anchor, 'Something else entirely, nothing in common with the original line of prose.');
  assert.equal(r.state, 'detached');
  assert.equal(r.anchor.exact, 'Iris stood at the rail');
});

test('repeated text with no distinguishing context is uncertain', () => {
  const a = createAnchor('x the rail y', 2, 10);
  // Stored offsets no longer hold the quote, and it occurs twice with no context to choose between them.
  assert.equal(reanchor({ ...a, start: 40, end: 48, prefix: '', suffix: '' }, 'p the rail q the rail r').state, 'uncertain');
});

test('flags are sticky until the author clears them', () => {
  assert.equal(stickierState('uncertain', 'anchored'), 'uncertain');
  assert.equal(stickierState('detached', 'relocated'), 'uncertain');
  assert.equal(stickierState('anchored', 'detached'), 'detached');
});
