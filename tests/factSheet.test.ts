import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFacts, normalizeForQuote, type Fact } from '../src/research/factSheet.ts';
import type { SourceDoc } from '../src/research/sources.ts';

const sources: SourceDoc[] = [
  { id: 'url-1', kind: 'user_url', url: 'https://u.dev', text: 'Flutter 3.10 added "MediaQuery.sizeOf(context)",\nwhich rebuilds   only on size changes.' },
  { id: 'web-1', kind: 'search', url: 'https://s.dev', text: 'MediaQuery.sizeOf was added in Flutter 3.7.' },
];

const fact = (over: Partial<Fact>): Fact => ({
  claim: 'c', sourceId: 'url-1', quote: 'Flutter 3.10 added', publishedAt: '', contradictsUserSource: false, ...over,
});

test('verifyFacts', async (t) => {
  await t.test('keeps an identical quote', () => {
    const r = verifyFacts([fact({})], sources);
    assert.equal(r.kept.length, 1);
  });

  await t.test('keeps a quote that differs only in curly quotes, case and whitespace', () => {
    const r = verifyFacts([fact({ quote: 'added “mediaquery.sizeOf(context)”, which rebuilds only' })], sources);
    assert.equal(r.kept.length, 1, JSON.stringify(r.dropped));
  });

  await t.test('drops a quote that is not in the source', () => {
    const r = verifyFacts([fact({ quote: 'Flutter 4.0 removed MediaQuery' })], sources);
    assert.deepEqual(r.dropped.map((d) => d.reason), ['quote_not_found']);
  });

  await t.test('drops an unknown sourceId', () => {
    const r = verifyFacts([fact({ sourceId: 'web-9' })], sources);
    assert.deepEqual(r.dropped.map((d) => d.reason), ['unknown_source']);
  });

  await t.test('drops a search fact that contradicts a user source', () => {
    const r = verifyFacts([fact({ sourceId: 'web-1', quote: 'added in Flutter 3.7', contradictsUserSource: true })], sources);
    assert.deepEqual(r.dropped.map((d) => d.reason), ['contradicts_user_source']);
  });

  await t.test('keeps a user-source fact even if flagged as contradicting', () => {
    const r = verifyFacts([fact({ contradictsUserSource: true })], sources);
    assert.equal(r.kept.length, 1);
  });
});

test('normalizeForQuote collapses whitespace, quotes and case', () => {
  assert.equal(normalizeForQuote('  “Hello”\n  ‘World’ — x '), '"hello" \'world\' - x');
});
