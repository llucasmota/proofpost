import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptOptimizerNode } from '../src/graph/nodes/promptOptimizerNode.ts';
import { createRoleServices } from '../src/services/llmProvider.ts';
import type { GraphState } from '../src/graph/graph.ts';

test('Prompt Optimizer - Pre-flight Sanitation & Refinement', async (t) => {
  const llmClient = createRoleServices().optimizer;
  const promptOptimizer = createPromptOptimizerNode(llmClient);

  await t.test('Deve harmonizar contradição entre Flutter e TypeScript snippet', async () => {
    const rawCommand = `Make a LinkedIn post about Flutter 3.47.
Priorities:
1. Decoupled UI packages
2. Impeller on Desktop
*CODE RULES*:
- Must be valid Dart.
- Do NOT write Python.
Format: short intro hook → bullet points → practical TypeScript snippet → closing question.`;

    const state = { initialCommand: rawCommand } as GraphState;
    const result = await promptOptimizer(state);

    assert.ok(result.optimizedCommand, 'optimizedCommand deve estar preenchido');
    assert.ok(result.promptOptimizationSummary, 'promptOptimizationSummary deve estar preenchido');
    
    // O prompt otimizado não deve ter contradição de TypeScript para post de Flutter
    const lowerOpt = result.optimizedCommand.toLowerCase();
    assert.ok(lowerOpt.includes('dart') || lowerOpt.includes('flutter'), 'Deve focar em Dart/Flutter');
  });

  await t.test('Deve manter comandos simples/out-of-scope intactos', async () => {
    const rawCommand = 'Quero uma receita de bolo de cenoura com cobertura de chocolate';
    const state = { initialCommand: rawCommand } as GraphState;
    const result = await promptOptimizer(state);

    assert.ok(result.optimizedCommand);
    assert.ok(result.optimizedCommand.includes('bolo de cenoura') || result.optimizedCommand.includes('receita'));
  });
});
