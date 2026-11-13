import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewerUserPrompt } from '../src/graph/nodes/reviewerNode.ts';
import { POST_TYPE_RULES } from '../src/graph/nodes/specialistNode.ts';
import type { GraphState } from '../src/graph/graph.ts';

const base = (over: Partial<GraphState> = {}): GraphState => ({
  initialCommand: 'Explain sizeOf',
  reviewCount: 0,
  postType: 'deep',
  technicalDraft: 'Draft text [CODE_SNIPPET_1]',
  codeSnippets: ['final s = MediaQuery.sizeOf(context);'],
  researchStatus: 'ok',
  sources: [{ id: 'url-1', kind: 'user_url', url: 'https://x.dev', text: 'source' }],
  factSheet: [{ claim: 'sizeOf exists', sourceId: 'url-1', quote: 'source', publishedAt: '', contradictsUserSource: false }],
  ...over,
} as GraphState);

test('buildReviewerUserPrompt', async (t) => {
  await t.test('with a FactSheet: includes it and the rejection rule, no [WEB_DATA]', () => {
    const p = buildReviewerUserPrompt(base(), '2026-11-13');
    assert.ok(p.includes('[FACT_SHEET]'));
    assert.ok(p.includes('F1 [url-1 · https://x.dev'));
    assert.ok(p.includes('Reject any specific technical claim that is not supported by [FACT_SHEET]'));
    assert.ok(!p.includes('[WEB_DATA]'));
  });

  await t.test('no_sources → NO-FACTS MODE without the FactSheet rejection rule', () => {
    const p = buildReviewerUserPrompt(base({ researchStatus: 'no_sources', factSheet: [] }), '2026-11-13');
    assert.ok(p.includes('NO-FACTS MODE'));
    assert.ok(p.includes('style, format and evident technical errors'));
    assert.ok(!p.includes('Reject any specific technical claim that is not supported by [FACT_SHEET]'));
  });

  await t.test('quick post type rule is passed to the reviewer', () => {
    assert.ok(buildReviewerUserPrompt(base({ postType: 'quick' }), '2026-11-13').includes(POST_TYPE_RULES.quick));
  });

  await t.test('placeholder rule is kept when there are snippets', () => {
    assert.ok(buildReviewerUserPrompt(base(), '2026-11-13').includes('PLACEHOLDER RULE'));
  });
});
