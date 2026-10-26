import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countWords, parseBlocks, parseInline, parseScenes, segmentRuns } from '../shared/text.ts';

const chapter = `# The Return

The ferry came in under a *low* sky, and **Iris** stood at the rail.

She had not meant to come back.

* * *

The key was under the third stone.

## At the harbour

Tomas was at the harbour office.
> "You found the bread," he said.
> "I did."`;

test('counts words, ignoring markup', () => {
  assert.equal(countWords('The *ferry* came — in, didn’t it?'), 6);
  assert.equal(countWords(''), 0);
});

test('detects scenes from breaks and headings', () => {
  const scenes = parseScenes(chapter);
  assert.equal(scenes.length, 3);
  assert.match(scenes[0].title, /^The ferry came in/);
  assert.match(scenes[1].title, /^The key was under/);
  assert.equal(scenes[2].title, 'At the harbour');
  assert.ok(chapter.slice(scenes[1].start, scenes[1].end).startsWith('The key'));
});

test('every inline run is an exact slice of the source', () => {
  for (const block of parseBlocks(chapter)) {
    for (const run of block.runs) {
      assert.equal(chapter.slice(run.start, run.start + run.text.length), run.text);
    }
  }
});

test('parses emphasis without the markers', () => {
  const src = 'a *b* **c** d';
  const runs = parseInline(src, 0, src.length);
  assert.deepEqual(
    runs.map((r) => [r.text, r.italic, r.bold]),
    [['a ', false, false], ['b', true, false], [' ', false, false], ['c', false, true], [' d', false, false]],
  );
});

test('block kinds', () => {
  const kinds = parseBlocks(chapter).map((b) => b.kind);
  assert.deepEqual(kinds, ['chapter-heading', 'paragraph', 'paragraph', 'scene-break', 'paragraph', 'heading', 'paragraph']);
});

test('segments runs at highlight boundaries', () => {
  const src = 'one two three';
  const segs = segmentRuns(parseInline(src, 0, src.length), [{ id: 'x', start: 4, end: 7 }]);
  assert.deepEqual(segs.map((s) => [s.text, s.ids]), [['one ', []], ['two', ['x']], [' three', []]]);
});
