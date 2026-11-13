import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSourcesMarkdown, buildPostFileText, UNVERIFIED_WARNING } from '../src/graph/nodes/imageExtractorNode.ts';
import type { GraphState } from '../src/graph/graph.ts';

test('renderSourcesMarkdown', async (t) => {
  await t.test('lists sources, facts with quotes, and gaps', () => {
    const md = renderSourcesMarkdown(
      [{ id: 'url-1', kind: 'user_url', url: 'https://x.dev', publishedAt: '2026-11-01', text: 't' }],
      [{ claim: 'sizeOf exists', sourceId: 'url-1', quote: 'MediaQuery.sizeOf', publishedAt: '', contradictsUserSource: false }],
      ['no benchmark'],
    );
    assert.ok(md.includes('url-1'));
    assert.ok(md.includes('user_url'));
    assert.ok(md.includes('https://x.dev'));
    assert.ok(md.includes('2026-11-01'));
    assert.ok(md.includes('sizeOf exists'));
    assert.ok(md.includes('"MediaQuery.sizeOf"'));
    assert.ok(md.includes('Lacunas'));
    assert.ok(md.includes('no benchmark'));
  });

  await t.test('empty research says there were no sources', () => {
    assert.ok(renderSourcesMarkdown([], [], []).includes('Nenhuma fonte'));
  });
});

test('buildPostFileText', async (t) => {
  const base = { initialCommand: 'x', reviewCount: 0, postType: 'deep' } as GraphState;

  await t.test('approved post without sources starts with the NOT VERIFIED warning', () => {
    const r = buildPostFileText({ ...base, researchStatus: 'no_sources', finalPostText: 'Post', hashtags: ['#a'] }, 'Post');
    assert.ok(r.text.startsWith(UNVERIFIED_WARNING));
    assert.ok(r.text.endsWith('Post\n\n#a'));
    assert.equal(r.status, 'approved');
  });

  await t.test('approved post with sources has no warning', () => {
    const r = buildPostFileText({ ...base, researchStatus: 'ok', finalPostText: 'Post' }, 'Post');
    assert.equal(r.text, 'Post');
  });

  await t.test('unreviewed draft is flagged and reports not_reviewed', () => {
    const r = buildPostFileText({ ...base, reviewError: 'boom', technicalDraft: 'd'.repeat(120) }, 'd'.repeat(120));
    assert.equal(r.status, 'not_reviewed');
    assert.ok(r.text.includes('NOT REVIEWED'));
  });

  await t.test('draft after the review limit reports review_limit', () => {
    const r = buildPostFileText({ ...base, reviewFeedback: 'meh', technicalDraft: 'd'.repeat(120) }, 'd'.repeat(120));
    assert.equal(r.status, 'review_limit');
  });

  await t.test('no usable content → failed with no text', () => {
    const r = buildPostFileText({ ...base, technicalDraft: 'short' }, 'short');
    assert.equal(r.status, 'failed');
    assert.equal(r.text, '');
  });
});
