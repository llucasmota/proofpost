import type { z } from 'zod/v3';
import { LLM_ROLES, resolveRoles, type LlmRole, type ModelRef, type RoleSettings } from '../config.ts';
import type { ILlmService, LlmErrorKind, LLMStructuredResult } from './llmService.ts';
import { GoogleGeminiService } from './googleGeminiService.ts';
import { OpenRouterService } from './openrouterService.ts';
import { usageTracker, type UsageTracker } from './usageTracker.ts';

/** Errors after which a provider is skipped for a while instead of being retried on every node. */
const TRIPPING_ERRORS: LlmErrorKind[] = ['rate_limit', 'auth', 'timeout', 'server', 'network'];

type FallbackOptions = {
  /** How long a failing provider is skipped (circuit breaker). */
  cooldownMs?: number;
  now?: () => number;
  /** Label used in logs and usage records (e.g. "writer"). */
  role?: string;
  tracker?: UsageTracker;
};

/**
 * Tries each provider in order. A provider that fails with a transient/config error is
 * "tripped" and skipped by subsequent calls until the cooldown expires, so one exhausted
 * Gemini quota does not cost a slow failed call on every node of the graph.
 */
export class FallbackLlmService implements ILlmService {
  readonly name: string;
  private providers: ILlmService[];
  private trippedUntil = new Map<ILlmService, number>();
  private cooldownMs: number;
  private now: () => number;
  private role: string;
  private tracker?: UsageTracker;

  constructor(providers: ILlmService[], options: FallbackOptions = {}) {
    if (providers.length === 0) throw new Error('FallbackLlmService needs at least one provider.');
    this.providers = providers;
    this.cooldownMs = options.cooldownMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
    this.role = options.role ?? 'llm';
    this.tracker = options.tracker;
    this.name = `${this.role}(${this.providers.map(labelOf).join(' → ')})`;
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodSchema<T>
  ): Promise<LLMStructuredResult<T>> {
    const available = this.providers.filter((p) => (this.trippedUntil.get(p) ?? 0) <= this.now());
    // If everything is tripped, try them all anyway rather than failing without a call.
    const candidates = available.length > 0 ? available : this.providers;

    const errors: string[] = [];
    let last: LLMStructuredResult<T> | undefined;

    for (const provider of candidates) {
      const label = labelOf(provider);
      console.log(`[LLM ${this.role}] → ${label}`);
      const result = await provider.generateStructured(systemPrompt, userPrompt, schema);
      this.track(result, label);

      if (result.success && result.data) {
        this.trippedUntil.delete(provider);
        return { ...result, provider: result.provider ?? label };
      }

      last = result;
      errors.push(`${label}: [${result.errorKind ?? 'unknown'}] ${result.error ?? 'no data'}`);

      if (result.errorKind && TRIPPING_ERRORS.includes(result.errorKind)) {
        this.trippedUntil.set(provider, this.now() + this.cooldownMs);
        console.warn(`[LLM ${this.role}] ⚠️ ${label} failed with ${result.errorKind}; skipping it for ${Math.round(this.cooldownMs / 1000)}s.`);
      } else {
        console.warn(`[LLM ${this.role}] ⚠️ ${label} failed (${result.errorKind ?? 'unknown'}); trying next provider.`);
      }
    }

    return {
      success: false,
      error: `All LLM providers failed → ${errors.join(' | ')}`,
      errorKind: last?.errorKind ?? 'unknown',
    };
  }

  private track(result: LLMStructuredResult<unknown>, label: string) {
    if (!this.tracker) return;
    this.tracker.record({
      role: this.role,
      provider: result.provider ?? label,
      model: result.model ?? label,
      success: result.success,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    });
  }
}

function labelOf(provider: ILlmService): string {
  return provider.name ?? provider.constructor.name;
}

export function createModelService(ref: ModelRef, settings: RoleSettings): ILlmService {
  if (ref.provider === 'gemini') {
    return new GoogleGeminiService({
      model: ref.model,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
    });
  }
  return new OpenRouterService({
    model: ref.model,
    temperature: settings.temperature,
    maxOutputTokens: settings.maxOutputTokens,
    reasoningEffort: settings.reasoningEffort,
  });
}

export type LlmRoles = Record<LlmRole, ILlmService>;

/** One fallback chain per role (optimizer, orchestrator, writer, reviewer), from config/.env. */
export function createRoleServices(tracker: UsageTracker = usageTracker): LlmRoles {
  const roles = resolveRoles();
  const services = {} as LlmRoles;
  for (const role of LLM_ROLES) {
    const settings = roles[role];
    services[role] = new FallbackLlmService(
      settings.chain.map((ref) => createModelService(ref, settings)),
      { role, tracker },
    );
    console.log(`[LLM ${role}] ${settings.chain.map((r) => `${r.provider}:${r.model}`).join(' → ')}`);
  }
  return services;
}
