import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChain, resolveRoles, LLM_ROLES } from '../src/config.ts';
import { UsageTracker } from '../src/services/usageTracker.ts';

test('parseChain', async (t) => {
  await t.test('parses provider:model entries in order', () => {
    assert.deepEqual(parseChain('gemini:gemini-3.8-flash, openrouter:google/gemini-3.8-flash'), [
      { provider: 'gemini', model: 'gemini-3.8-flash' },
      { provider: 'openrouter', model: 'google/gemini-3.8-flash' },
    ]);
  });

  await t.test('returns undefined for empty values', () => {
    assert.equal(parseChain(''), undefined);
    assert.equal(parseChain(undefined), undefined);
  });

  await t.test('rejects unknown providers', () => {
    assert.throws(() => parseChain('anthropic:claude-sonnet-5-5'));
  });
});

test('resolveRoles', async (t) => {
  await t.test('defaults: Google direct first, OpenRouter Google, then DeepSeek; Sonnet reviews', () => {
    const roles = resolveRoles({});
    assert.deepEqual(roles.writer.chain.map((r) => `${r.provider}:${r.model}`), [
      'gemini:gemini-3.8-flash',
      'openrouter:google/gemini-3.8-flash',
      'openrouter:deepseek/deepseek-v4.1-flash',
    ]);
    assert.equal(roles.reviewer.chain[0].model, 'anthropic/claude-sonnet-5.5');
    assert.equal(roles.reviewer.temperature, undefined, 'Sonnet 5.5 rejects non-default temperature');
    for (const role of ['optimizer', 'orchestrator'] as const) {
      assert.equal(roles[role].chain[0].provider, 'gemini');
      assert.equal(roles[role].chain.at(-1)?.model, 'deepseek/deepseek-v4.1-flash', 'non-Google last resort');
      assert.equal(roles[role].temperature, 0);
    }
  });

  await t.test('researcher role: cheap chain ending in DeepSeek, temperature 0', () => {
    const roles = resolveRoles({});
    assert.ok(LLM_ROLES.includes('researcher'));
    assert.equal(roles.researcher.chain.at(-1)?.model, 'deepseek/deepseek-v4.1-flash');
    assert.equal(roles.researcher.temperature, 0);
  });

  await t.test('env override replaces only that role chain', () => {
    const roles = resolveRoles({ LLM_CHAIN_REVIEWER: 'openrouter:deepseek/deepseek-v4.1-flash' });
    assert.deepEqual(roles.reviewer.chain, [{ provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' }]);
    assert.equal(roles.writer.chain[0].model, 'gemini-3.8-flash');
  });
});

test('UsageTracker', async (t) => {
  await t.test('sums tokens and estimates cost from the price table', () => {
    const tracker = new UsageTracker();
    tracker.record({ role: 'reviewer', provider: 'openrouter:anthropic/claude-sonnet-5.5', model: 'anthropic/claude-sonnet-5.5', success: true, inputTokens: 1_000_000, outputTokens: 100_000 });
    tracker.record({ role: 'writer', provider: 'gemini:gemini-3.8-flash', model: 'gemini-3.8-flash', success: false, inputTokens: 0, outputTokens: 0 });
    tracker.record({ role: 'writer', provider: 'openrouter:x/unknown', model: 'x/unknown', success: true, inputTokens: 10, outputTokens: 10 });
    const s = tracker.summary();
    assert.equal(s.calls, 3);
    assert.equal(s.failedCalls, 1);
    assert.equal(s.estimatedCostUsd, 3); // 1M in × $2 + 100k out × $10
    assert.deepEqual(s.unpricedModels, ['x/unknown']);
  });
});
