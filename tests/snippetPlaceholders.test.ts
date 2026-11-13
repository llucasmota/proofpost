import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSnippets, placeholderIndexes } from '../src/graph/snippetPlaceholders.ts';

test('placeholderIndexes', async (t) => {
  await t.test('finds IMAGE_CODE and CODE_SNIPPET placeholders in order, without duplicates', () => {
    assert.deepEqual(placeholderIndexes('a [CODE_SNIPPET_2] b [IMAGE_CODE_1] c [CODE_SNIPPET_2]'), [2, 1]);
  });
});

test('reconcileSnippets', async (t) => {
  await t.test('keeps everything when text and snippets already match', () => {
    const r = reconcileSnippets('intro\n\n[IMAGE_CODE_1]\n\nmid\n\n[IMAGE_CODE_2]', ['a', 'b']);
    assert.equal(r.text, 'intro\n\n[IMAGE_CODE_1]\n\nmid\n\n[IMAGE_CODE_2]');
    assert.deepEqual(r.used, ['a', 'b']);
    assert.deepEqual(r.unused, []);
    assert.deepEqual(r.missing, []);
  });

  await t.test('snippets the post no longer references become unused (the 3-snippets/1-placeholder bug)', () => {
    const r = reconcileSnippets('text\n\n[IMAGE_CODE_1]\n\nend', ['a', 'b', 'c']);
    assert.deepEqual(r.used, ['a']);
    assert.deepEqual(r.unused, ['b', 'c']);
  });

  await t.test('renumbers by order of appearance so [IMAGE_CODE_N] always matches snippet_N', () => {
    const r = reconcileSnippets('x [IMAGE_CODE_3] y [IMAGE_CODE_1]', ['a', 'b', 'c']);
    assert.equal(r.text, 'x [IMAGE_CODE_1] y [IMAGE_CODE_2]');
    assert.deepEqual(r.used, ['c', 'a']);
    assert.deepEqual(r.unused, ['b']);
  });

  await t.test('converts leftover [CODE_SNIPPET_N] (unreviewed draft) to [IMAGE_CODE_N]', () => {
    const r = reconcileSnippets('x\n\n[CODE_SNIPPET_1]', ['a']);
    assert.equal(r.text, 'x\n\n[IMAGE_CODE_1]');
    assert.deepEqual(r.used, ['a']);
  });

  await t.test('removes placeholders that point to a snippet that does not exist', () => {
    const r = reconcileSnippets('intro\n\n[IMAGE_CODE_1]\n\nmid\n\n[IMAGE_CODE_4]\n\nend', ['a']);
    assert.equal(r.text, 'intro\n\n[IMAGE_CODE_1]\n\nmid\n\nend');
    assert.deepEqual(r.missing, [4]);
  });

  await t.test('empty snippets count as missing, not as images', () => {
    const r = reconcileSnippets('x [IMAGE_CODE_1] y', ['   ']);
    assert.equal(r.text, 'x y');
    assert.deepEqual(r.used, []);
    assert.deepEqual(r.missing, [1]);
  });

  await t.test('text-only post keeps its snippets as unused', () => {
    const r = reconcileSnippets('no code here', ['a']);
    assert.equal(r.text, 'no code here');
    assert.deepEqual(r.unused, ['a']);
  });
});
