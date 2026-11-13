import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestratorNode } from '../src/graph/nodes/orchestratorNode.ts';
import { createRoleServices } from '../src/services/llmProvider.ts';
import type { GraphState } from '../src/graph/graph.ts';

test('Orchestrator - Classificação de Nicho via LLM', async (t) => {
  const llmClient = createRoleServices().orchestrator;
  const orchestrator = createOrchestratorNode(llmClient);

  await t.test('Deve classificar comandos de Flutter/Dart corretamente', async () => {
    const state = { initialCommand: 'Explain dependency injection in Flutter using Widgetbook' } as GraphState;
    const result = await orchestrator(state);
    assert.strictEqual(result.niche, 'flutter_dart');
    assert.ok(result.suggestedFolderSlug);
  });

  await t.test('Deve classificar comandos de Node/React corretamente', async () => {
    const state = { initialCommand: 'Explain Node.js event loop with code examples and how it handles concurrency' } as GraphState;
    const result = await orchestrator(state);
    assert.strictEqual(result.niche, 'node_react');
    assert.ok(result.suggestedFolderSlug);
  });

  await t.test('Deve classificar comandos de AI/LangGraph corretamente', async () => {
    const state = { initialCommand: 'Show how to build a multi-agent system using LangGraph and Gemini' } as GraphState;
    const result = await orchestrator(state);
    assert.strictEqual(result.niche, 'ai_engineering');
    assert.ok(result.suggestedFolderSlug);
  });

  await t.test('Deve classificar comandos fora de contexto como out_of_scope', async () => {
    const state = { initialCommand: 'Quero uma receita de bolo de cenoura com calda de chocolate' } as GraphState;
    const result = await orchestrator(state);
    assert.strictEqual(result.niche, 'out_of_scope');
    assert.ok(result.suggestedFolderSlug);
  });
});
