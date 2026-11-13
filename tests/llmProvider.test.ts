import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v3';
import { FallbackLlmService } from '../src/services/llmProvider.ts';
import { classifyLlmError, type ILlmService, type LLMStructuredResult, type LlmErrorKind } from '../src/services/llmService.ts';

const Schema = z.object({ ok: z.boolean() });

class FakeProvider implements ILlmService {
  calls = 0;
  readonly name: string;
  private outcomes: Array<LlmErrorKind | 'ok'>;

  constructor(name: string, outcomes: Array<LlmErrorKind | 'ok'>) {
    this.name = name;
    this.outcomes = outcomes;
  }

  async generateStructured<T>(): Promise<LLMStructuredResult<T>> {
    const outcome = this.outcomes[Math.min(this.calls, this.outcomes.length - 1)];
    this.calls++;
    if (outcome === 'ok') return { success: true, data: { ok: true } as T, provider: this.name };
    return { success: false, error: `${outcome} error`, errorKind: outcome, provider: this.name };
  }
}

const call = (svc: ILlmService) => svc.generateStructured('sys', 'user', Schema);

test('FallbackLlmService', async (t) => {
  await t.test('uses the primary when it succeeds', async () => {
    const primary = new FakeProvider('primary', ['ok']);
    const backup = new FakeProvider('backup', ['ok']);
    const result = await call(new FallbackLlmService([primary, backup]));
    assert.equal(result.success, true);
    assert.equal(result.provider, 'primary');
    assert.equal(backup.calls, 0);
  });

  await t.test('falls back when the primary fails', async () => {
    const primary = new FakeProvider('primary', ['server']);
    const backup = new FakeProvider('backup', ['ok']);
    const result = await call(new FallbackLlmService([primary, backup]));
    assert.equal(result.success, true);
    assert.equal(result.provider, 'backup');
  });

  await t.test('skips a rate-limited provider on later calls (circuit breaker)', async () => {
    let now = 0;
    const primary = new FakeProvider('primary', ['rate_limit', 'ok']);
    const backup = new FakeProvider('backup', ['ok']);
    const svc = new FallbackLlmService([primary, backup], { cooldownMs: 1_000, now: () => now });

    await call(svc);
    await call(svc);
    await call(svc);
    assert.equal(primary.calls, 1, 'primary should not be retried while tripped');
    assert.equal(backup.calls, 3);

    now = 1_001; // cooldown expired
    const result = await call(svc);
    assert.equal(primary.calls, 2);
    assert.equal(result.provider, 'primary');
  });

  await t.test('does not trip the breaker on parse errors', async () => {
    const primary = new FakeProvider('primary', ['parse', 'ok']);
    const backup = new FakeProvider('backup', ['ok']);
    const svc = new FallbackLlmService([primary, backup]);
    await call(svc);
    const second = await call(svc);
    assert.equal(primary.calls, 2);
    assert.equal(second.provider, 'primary');
  });

  await t.test('reports every provider error when all fail', async () => {
    const svc = new FallbackLlmService([new FakeProvider('a', ['timeout']), new FakeProvider('b', ['auth'])]);
    const result = await call(svc);
    assert.equal(result.success, false);
    assert.match(result.error!, /a: \[timeout\]/);
    assert.match(result.error!, /b: \[auth\]/);
  });

  await t.test('still tries providers when all of them are tripped', async () => {
    const primary = new FakeProvider('primary', ['rate_limit', 'ok']);
    const svc = new FallbackLlmService([primary], { cooldownMs: 60_000, now: () => 0 });
    await call(svc);
    const result = await call(svc);
    assert.equal(result.success, true);
  });
});

test('classifyLlmError', async (t) => {
  const cases: Array<[unknown, LlmErrorKind]> = [
    [Object.assign(new Error('Too Many Requests'), { status: 429 }), 'rate_limit'],
    [new Error('[GoogleGenerativeAI Error]: [429] RESOURCE_EXHAUSTED: quota exceeded'), 'rate_limit'],
    [Object.assign(new Error('Unauthorized'), { status: 401 }), 'auth'],
    [Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), 'timeout'],
    [Object.assign(new Error('Service Unavailable'), { status: 503 }), 'server'],
    [new Error('Failed to parse. Text: "{bad". Error: Unexpected token'), 'parse'],
    [new TypeError('fetch failed'), 'network'],
  ];
  for (const [error, expected] of cases) {
    await t.test(`${(error as Error).message} → ${expected}`, () => {
      assert.equal(classifyLlmError(error), expected);
    });
  }
});
