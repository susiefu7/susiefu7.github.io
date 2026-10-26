import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findQuote } from '../shared/quote.ts';

const text = `The ferry came in under a *low* sky.\n\n“You found the bread,” he said.\n\nShe waited — and waited.\n\nHe said nothing. He said nothing.`;
const slice = (m: ReturnType<typeof findQuote>) => (m.ok ? text.slice(m.start, m.end) : m.reason);

test('exact quotes map to exact source offsets', () => {
  assert.equal(slice(findQuote(text, 'came in under')), 'came in under');
});

test('emphasis markers, curly quotes, dashes and spacing are ignored', () => {
  assert.equal(slice(findQuote(text, 'under a low sky')), 'under a *low* sky');
  assert.equal(slice(findQuote(text, '"You found the bread," he said.')), '“You found the bread,” he said.');
  // Quotation marks wrapped around the whole quote by the editor are tolerated.
  assert.equal(slice(findQuote(text, '"came in under"')), 'came in under');
  assert.equal(slice(findQuote(text, 'She waited - and   waited')), 'She waited — and waited');
});

test('case differences are tolerated only as a fallback', () => {
  assert.equal(slice(findQuote(text, 'THE FERRY CAME')), 'The ferry came');
});

test('a long passage can be quoted as opening ... closing', () => {
  assert.equal(slice(findQuote(text, 'The ferry came in ... “You found the bread”')), 'The ferry came in under a *low* sky.\n\n“You found the bread');
});

test('missing, ambiguous and empty quotes are refused', () => {
  assert.equal(slice(findQuote(text, 'not in the chapter at all')), 'not-found');
  assert.equal(slice(findQuote(text, 'He said nothing.')), 'ambiguous');
  assert.equal(slice(findQuote(text, '  ""  ')), 'empty');
});
