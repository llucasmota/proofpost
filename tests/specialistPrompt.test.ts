import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecialistUserPrompt, POST_TYPE_RULES } from '../src/graph/nodes/specialistNode.ts';
import type { GraphState } from '../src/graph/graph.ts';

const base = (over: Partial<GraphState> = {}): GraphState => ({
  initialCommand: 'Explain MediaQuery.sizeOf',
  optimizedCommand: 'Explain MediaQuery.sizeOf in Flutter',
  reviewCount: 0,
  postType: 'deep',
  niche: 'flutter_dart',
  researchStatus: 'ok',
  userContext: ['MY PRIVATE NOTES'],
  sources: [
    { id: 'ctx-1', kind: 'user_context', text: 'MY PRIVATE NOTES' },
    { id: 'url-1', kind: 'user_url', url: 'https://x.dev', publishedAt: '2026-11-01', text: 'A'.repeat(9_000) },
  ],
  factSheet: [{ claim: 'sizeOf rebuilds only on size', sourceId: 'url-1', quote: 'rebuilds only when size changes', publishedAt: '2026-11-01', contradictsUserSource: false }],
  researchGaps: [],
  ...over,
} as GraphState);

test('buildSpecialistUserPrompt', async (t) => {
  await t.test('includes the numbered FactSheet with source and date, plus the grounding rule', () => {
    const p = buildSpecialistUserPrompt(base());
    assert.match(p, /\[FACT_SHEET\]/);
    assert.ok(p.includes('F1 [url-1 · https://x.dev · 2026-11-01]'));
    assert.ok(p.includes('sizeOf rebuilds only on size'));
    assert.ok(p.includes('"rebuilds only when size changes"'));
    assert.ok(p.includes('Specific technical claims (versions, flags, API names, numbers) are allowed ONLY if they appear in [FACT_SHEET]'));
  });

  await t.test('includes [SOURCES] with each source cut to 8000 chars', () => {
    const p = buildSpecialistUserPrompt(base());
    assert.match(p, /\[SOURCES\]/);
    assert.ok(p.includes('A'.repeat(8_000)));
    assert.ok(!p.includes('A'.repeat(8_001)));
  });

  await t.test('includes [GAPS] only when there are gaps', () => {
    assert.ok(!buildSpecialistUserPrompt(base()).includes('[GAPS]'));
    assert.ok(buildSpecialistUserPrompt(base({ researchGaps: ['no version info'] })).includes('[GAPS]'));
  });

  await t.test('no_sources → [NO_SOURCES] and no [FACT_SHEET]', () => {
    const p = buildSpecialistUserPrompt(base({ researchStatus: 'no_sources', factSheet: [], sources: [] }));
    assert.ok(p.includes('[NO_SOURCES]'));
    assert.ok(!p.includes('[FACT_SHEET]'));
  });

  await t.test('quick post type adds the quick rule', () => {
    assert.ok(buildSpecialistUserPrompt(base({ postType: 'quick' })).includes(POST_TYPE_RULES.quick));
    assert.ok(buildSpecialistUserPrompt(base()).includes(POST_TYPE_RULES.deep));
  });

  await t.test('user context appears only as a source, not repeated in the Topic', () => {
    const p = buildSpecialistUserPrompt(base());
    assert.equal(p.split('MY PRIVATE NOTES').length - 1, 1);
  });

  await t.test('surgical correction mode is preserved', () => {
    const p = buildSpecialistUserPrompt(base({
      reviewCount: 1, reviewFeedback: 'fix it', approvedContent: 'good part',
      corrections: [{ originalText: 'wrong', issue: 'bad', suggestedReplacement: 'right' }],
    }));
    assert.ok(p.includes('[SURGICAL CORRECTION MODE'));
    assert.ok(p.includes('[APPROVED CONTENT'));
  });

  await t.test('no legacy [WEB_DATA] or [RAG Data] blocks', () => {
    const p = buildSpecialistUserPrompt(base());
    assert.ok(!p.includes('[WEB_DATA]'));
    assert.ok(!p.includes('[RAG Data]'));
  });
});
