import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAiReply } from '../shared/aiReply.ts';

test('reads notes in the requested format, including chat-app formatting', () => {
  const reply = `Overall this chapter is strong.

**NOTE 1**
**Type:** Dialogue
**Passage:** "You found the bread," he said.
**Note:** Consider letting the silence do more work.
**Reasoning:** Tomas speaks little (canon/characters.md),
so a shorter line fits him.
**Suggested rewrite:** "Bread," he said.
**END NOTE**

NOTE
- Type: continuity
- Passage: "She had not meant to come back in winter."
- Note: The directives say she arrives by ferry.
- Reasoning: directives/2026-redevelopment.md, item 1.
- Suggested rewrite: None
END NOTE

NOTE
Type: something odd
Note: A note with no passage still comes through.
END NOTE`;
  const notes = parseAiReply(reply);
  assert.equal(notes.length, 3);
  assert.deepEqual(notes[0], {
    category: 'dialogue',
    passage: '"You found the bread," he said.',
    note: 'Consider letting the silence do more work.',
    reasoning: 'Tomas speaks little (canon/characters.md),\nso a shorter line fits him.',
    suggestedRewrite: '"Bread," he said.',
  });
  assert.equal(notes[1].category, 'continuity');
  assert.equal(notes[1].passage, 'She had not meant to come back in winter.', 'wrapping quotes removed');
  assert.equal(notes[1].suggestedRewrite, null);
  assert.equal(notes[2].category, 'developmental');
  assert.equal(notes[2].passage, '');
});

test('a reply without NOTE blocks yields nothing (the UI then offers to keep it whole)', () => {
  assert.deepEqual(parseAiReply('Just some general thoughts about the chapter.'), []);
});
