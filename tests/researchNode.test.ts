import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchNode } from '../src/graph/nodes/researchNode.ts';
import type { ILlmService, LLMStructuredResult } from '../src/services/llmService.ts';
import type { GraphState } from '../src/graph/graph.ts';
import type { CollectDeps } from '../src/research/collectSources.ts';

class FakeLlm implements ILlmService {
  name = 'fake';
  calls: { system: string; user: string }[] = [];
  result: LLMStructuredResult<any>;
  constructor(result: LLMStructuredResult<any>) { this.result = result; }
  async generateStructured<T>(system: string, user: string): Promise<LLMStructuredResult<T>> {
    this.calls.push({ system, user });
    return this.result as LLMStructuredResult<T>;
  }
}

const state = (over: Partial<GraphState> = {}): GraphState => ({
  initialCommand: 'Explain MediaQuery.sizeOf', reviewCount: 0, postType: 'deep', niche: 'flutter_dart',
  userContext: ['Flutter 3.10 added MediaQuery.sizeOf to avoid rebuilds.'], sourceUrls: [], searchQuery: 'MediaQuery sizeOf', ...over,
} as GraphState);

const deps = (overrides: Partial<CollectDeps> = {}) => ({
  web: null, fetchUrl: async () => null, searchMode: 'auto' as const, ...overrides,
});

const goodFact = { claim: 'sizeOf exists', sourceId: 'ctx-1', quote: 'Flutter 3.10 added MediaQuery.sizeOf', publishedAt: '', contradictsUserSource: false };

test('research node', async (t) => {
  await t.test('valid facts → status ok with only the verified facts', async () => {
    const llm = new FakeLlm({ success: true, data: { facts: [goodFact, { ...goodFact, quote: 'invented quote' }], gaps: ['no benchmarks'] } });
    const out = await createResearchNode(llm, deps())(state());
    assert.equal(out.researchStatus, 'ok');
    assert.equal(out.factSheet?.length, 1);
    assert.deepEqual(out.researchGaps, ['no benchmarks']);
    assert.equal(out.sources?.[0].id, 'ctx-1');
    assert.match(llm.calls[0].user, /\[SOURCE ctx-1 · user_context/);
  });

  await t.test('all facts rejected → no_sources, sources kept', async () => {
    const llm = new FakeLlm({ success: true, data: { facts: [{ ...goodFact, quote: 'nope' }], gaps: [] } });
    const out = await createResearchNode(llm, deps())(state());
    assert.equal(out.researchStatus, 'no_sources');
    assert.equal(out.sources?.length, 1);
  });

  await t.test('LLM failure → no_sources, sources kept', async () => {
    const llm = new FakeLlm({ success: false, error: 'all failed' });
    const out = await createResearchNode(llm, deps())(state());
    assert.equal(out.researchStatus, 'no_sources');
    assert.equal(out.sources?.length, 1);
  });

  await t.test('no sources at all → no_sources without calling the LLM', async () => {
    const llm = new FakeLlm({ success: true, data: { facts: [], gaps: [] } });
    const out = await createResearchNode(llm, deps())(state({ userContext: [] }));
    assert.equal(out.researchStatus, 'no_sources');
    assert.equal(llm.calls.length, 0);
  });

  await t.test('empty searchQuery falls back to the command, cut to 200 chars', async () => {
    const queries: string[] = [];
    const web = { search: async (q: string) => { queries.push(q); return []; }, extract: async () => [] };
    const llm = new FakeLlm({ success: true, data: { facts: [], gaps: [] } });
    await createResearchNode(llm, deps({ web }))(state({ userContext: [], searchQuery: '', optimizedCommand: 'x'.repeat(300) }));
    assert.equal(queries[0], 'x'.repeat(200));
  });

  await t.test('out_of_scope → no-op', async () => {
    const llm = new FakeLlm({ success: true, data: { facts: [], gaps: [] } });
    assert.deepEqual(await createResearchNode(llm, deps())(state({ niche: 'out_of_scope' })), {});
  });
});
