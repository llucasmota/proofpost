import type { z } from 'zod/v3';

/**
 * Categories used by the fallback layer to decide what to do after a failure:
 * - rate_limit / timeout / server / network → transient: try the next provider and
 *   temporarily disable the failing one (circuit breaker).
 * - parse → the model answered but the output did not match the schema.
 * - auth → configuration problem (bad/missing key). Still falls back, but is logged loudly.
 */
export type LlmErrorKind = 'rate_limit' | 'timeout' | 'server' | 'network' | 'auth' | 'parse' | 'unknown';

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LLMStructuredResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
  errorKind?: LlmErrorKind;
  /** Which provider/model produced (or failed to produce) this result, e.g. "gemini:gemini-2.5-flash". */
  provider?: string;
  /** Model id used for pricing, e.g. "gemini-2.5-flash" or "anthropic/claude-sonnet-5.5". */
  model?: string;
  usage?: LlmUsage;
};

export interface ILlmService {
  readonly name?: string;
  generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodSchema<T>
  ): Promise<LLMStructuredResult<T>>;
}

/** Hard ceiling for a single LLM call. Long posts on slow models can take a while. */
export const LLM_CALL_TIMEOUT_MS = Number(process.env.LLM_CALL_TIMEOUT_MS) || 120_000;

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, any>;
  const status = e.status ?? e.statusCode ?? e.response?.status ?? e.cause?.status;
  return typeof status === 'number' ? status : undefined;
}

export function classifyLlmError(error: unknown): LlmErrorKind {
  const status = readStatus(error);
  const name = error instanceof Error ? error.name : '';
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (status === 429 || /\b429\b|rate.?limit|resource_exhausted|quota|too many requests|insufficient credits|\b402\b/.test(message)) return 'rate_limit';
  if (status === 401 || status === 403 || /\b(401|403)\b|api key|unauthori[sz]ed|permission_denied|forbidden/.test(message)) return 'auth';
  if (name === 'AbortError' || name === 'TimeoutError' || /timed? ?out|timeout|aborted/.test(message)) return 'timeout';
  if ((status !== undefined && status >= 500) || /\b(500|502|503|504)\b|unavailable|overloaded|internal error|high demand/.test(message)) return 'server';
  if (name === 'ZodError' || name === 'OutputParserException' || /parse|zod|json|schema|structured output|invalid_type/.test(message)) return 'parse';
  if (/fetch failed|econnreset|enotfound|econnrefused|socket|network/.test(message)) return 'network';
  return 'unknown';
}

export function failure<T>(error: unknown, provider: string, model?: string): LLMStructuredResult<T> {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    errorKind: classifyLlmError(error),
    provider,
    model,
  };
}

/** Reads token usage from a LangChain AIMessage (`usage_metadata`). */
export function usageFromMessage(raw: unknown): LlmUsage | undefined {
  const meta = (raw as { usage_metadata?: { input_tokens?: number; output_tokens?: number } } | undefined)?.usage_metadata;
  if (!meta) return undefined;
  return { inputTokens: meta.input_tokens ?? 0, outputTokens: meta.output_tokens ?? 0 };
}

/** Shape returned by `withStructuredOutput(schema, { includeRaw: true })`. */
export type RawStructured = { raw: unknown; parsed: unknown; parsingError?: unknown };

export function unwrapStructured<T>(
  result: RawStructured,
  provider: string,
  model: string,
): LLMStructuredResult<T> {
  const usage = usageFromMessage(result.raw);
  if (result.parsed === null || result.parsed === undefined) {
    const cause = result.parsingError instanceof Error ? result.parsingError.message : 'empty output';
    return { ...failure<T>(new Error(`Structured output parse failed: ${cause}`), provider, model), errorKind: 'parse', usage };
  }
  return { success: true, data: result.parsed as T, provider, model, usage };
}
