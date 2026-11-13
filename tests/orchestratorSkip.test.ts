import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestratorNode } from '../src/graph/nodes/orchestratorNode.ts';
import type { ILlmService } from '../src/services/llmService.ts';
import type { GraphState } from '../src/graph/graph.ts';

const throwingLlm: ILlmService = {
  name: 'throwing',
  generateStructured: async () => { throw new Error('LLM must not be called'); },
};

test('orchestrator skips the LLM when niche and slug are already set (--idea)', async () => {
  const out = await createOrchestratorNode(throwingLlm)({
    initialCommand: 'x', reviewCount: 0, postType: 'deep', niche: 'ai_engineering', suggestedFolderSlug: 'mcp-auth',
  } as GraphState);
  assert.deepEqual(out, {});
});

test('orchestrator returns the searchQuery from the LLM', async () => {
  const llm: ILlmService = {
    name: 'fake',
    generateStructured: async () => ({ success: true, data: { reasoning: 'r', niche: 'flutter_dart', suggestedFolderSlug: 'mq', searchQuery: 'flutter mediaquery sizeOf' } as any }),
  };
  const out = await createOrchestratorNode(llm)({ initialCommand: 'x', reviewCount: 0, postType: 'deep' } as GraphState);
  assert.equal(out.searchQuery, 'flutter mediaquery sizeOf');
});
