import test from 'node:test';
import assert from 'node:assert/strict';
import { routeToSpecialist, routeAfterReview, routeAfterOrchestrator } from '../src/graph/nodes/edgeConditions.ts';
import type { GraphState } from '../src/graph/graph.ts';

test('Edge Conditions - Orquestrador: routeToSpecialist', async (t) => {
  await t.test('Deve rotear para flutterSpecialist', () => {
    const state = { niche: 'flutter_dart' } as GraphState;
    assert.strictEqual(routeToSpecialist(state), 'flutterSpecialist');
  });

  await t.test('Deve rotear para aiSpecialist', () => {
    const state = { niche: 'ai_engineering' } as GraphState;
    assert.strictEqual(routeToSpecialist(state), 'aiSpecialist');
  });
});

test('Edge Conditions - Guardrail do Revisor: routeAfterReview', async (t) => {
  await t.test('Deve avançar se aprovado', () => {
    const state = { reviewFeedback: '', reviewCount: 1, niche: 'node_react' } as GraphState;
    assert.strictEqual(routeAfterReview(state), 'imageExtractor');
  });

  await t.test('Deve forçar saída no limite de revisões', () => {
    const state = { reviewFeedback: 'Still bad', reviewCount: 3, niche: 'flutter_dart' } as GraphState;
    assert.strictEqual(routeAfterReview(state), 'imageExtractor');
  });
});

test('Edge Conditions - Reviewer failure is not a rejection', async (t) => {
  await t.test('Deve ir para imageExtractor quando o revisor falhou tecnicamente', () => {
    const state = { reviewError: 'All LLM providers failed', reviewFeedback: '', reviewCount: 0, niche: 'flutter_dart' } as GraphState;
    assert.strictEqual(routeAfterReview(state), 'imageExtractor');
  });

  await t.test('Deve voltar ao especialista quando reprovado abaixo do limite', () => {
    const state = { reviewError: '', reviewFeedback: 'Wrong version', reviewCount: 1, niche: 'flutter_dart' } as GraphState;
    assert.strictEqual(routeAfterReview(state), 'flutterSpecialist');
  });

  await t.test('Não deve rotear silenciosamente quando não há nicho', () => {
    assert.throws(() => routeToSpecialist({} as GraphState));
  });
});


test('Edge Conditions - routeAfterOrchestrator', async (t) => {
  await t.test('out_of_scope skips research', () => {
    assert.strictEqual(routeAfterOrchestrator({ niche: 'out_of_scope' } as GraphState), 'imageExtractor');
  });
  await t.test('a valid niche goes to research', () => {
    assert.strictEqual(routeAfterOrchestrator({ niche: 'flutter_dart' } as GraphState), 'research');
  });
});
