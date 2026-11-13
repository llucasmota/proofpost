import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnippet } from '../src/graph/nodes/imageExtractorNode.ts';

test('normalizeSnippet', async (t) => {
  await t.test('preserves "\\n" inside string literals of multi-line code', () => {
    const code = 'const a = 1;\nconsole.log("line1\\nline2");';
    assert.equal(normalizeSnippet(code), code);
  });

  await t.test('unescapes a fully double-escaped snippet', () => {
    assert.equal(normalizeSnippet('const a = 1;\\nconst b = \\"x\\";'), 'const a = 1;\nconst b = "x";');
  });

  await t.test('strips a leading [CODE_SNIPPET_N] label', () => {
    assert.equal(normalizeSnippet('[CODE_SNIPPET_2]: void main() {}'), 'void main() {}');
  });
});
