import { readFileSync } from "node:fs";
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const prompts = {
  aiEngineer: readFileSync(join(__dirname, 'prompts/v1/aiEngineer.txt'), 'utf-8'),
  nodeJsReact: readFileSync(join(__dirname, 'prompts/v1/nodeJsReact.txt'), 'utf-8'),
  orchestrator: readFileSync(join(__dirname, 'prompts/v1/orchestrator.txt'), 'utf-8'),
  promptOptimizer: readFileSync(join(__dirname, 'prompts/v1/promptOptimizer.txt'), 'utf-8'),
  reviewer: readFileSync(join(__dirname, 'prompts/v1/reviewer.txt'), 'utf-8'),
  flutterNode: readFileSync(join(__dirname, 'prompts/v1/flutterNode.txt'), 'utf-8'),
  researcher: readFileSync(join(__dirname, 'prompts/v1/researcher.txt'), 'utf-8'),
  ideasRanker: readFileSync(join(__dirname, 'prompts/v1/ideasRanker.txt'), 'utf-8'),
};

/** Max number of reviewer rounds before the graph stops iterating. */
export const MAX_REVIEWS = 3;

// ---------------------------------------------------------------------------
// Models per role
// ---------------------------------------------------------------------------

export type LlmRole = 'optimizer' | 'orchestrator' | 'researcher' | 'writer' | 'reviewer';
export const LLM_ROLES: LlmRole[] = ['optimizer', 'orchestrator', 'researcher', 'writer', 'reviewer'];

export type ProviderKind = 'gemini' | 'openrouter';

export type ModelRef = {
  provider: ProviderKind;
  model: string;
};

export type RoleSettings = {
  /** Tried in order; the next one is used only when the previous fails (quota, error, timeout). */
  chain: ModelRef[];
  /** Omit to use the model's default. Claude Sonnet 5.5 rejects non-default values. */
  temperature?: number;
  /** Hard cap on output tokens (includes reasoning/thinking tokens on thinking models). */
  maxOutputTokens: number;
  /** OpenRouter reasoning effort for thinking models (controls cost of hidden reasoning). */
  reasoningEffort?: 'low' | 'medium' | 'high';
};

/**
 * Default setup ("option B" + Sonnet as reviewer):
 * - Google models go DIRECT to the Gemini API first (cheapest: free tier / own billing).
 *   The same model through OpenRouter is used only if Google fails or the quota runs out.
 * - DeepSeek (another vendor) is the last link, for when Google itself is down/overloaded
 *   and both Gemini routes fail.
 * - The reviewer is a different model family (Claude) than the writer (Gemini), so it does
 *   not approve the writer's own blind spots. DeepSeek is its cheap fallback.
 *
 * Override any chain in .env, e.g.:
 *   LLM_CHAIN_WRITER=gemini:gemini-3.8-flash,openrouter:google/gemini-3.8-flash
 */
const DEFAULT_ROLES: Record<LlmRole, RoleSettings> = {
  optimizer: {
    chain: [
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
      { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' },
    ],
    temperature: 0,
    maxOutputTokens: 8_192,
  },
  orchestrator: {
    chain: [
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
      { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' },
    ],
    temperature: 0,
    maxOutputTokens: 4_096,
  },
  // Builds the FactSheet and ranks topic ideas: extraction work, cheap model, deterministic.
  researcher: {
    chain: [
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
      { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' },
    ],
    temperature: 0,
    maxOutputTokens: 8_192,
  },
  writer: {
    chain: [
      { provider: 'gemini', model: 'gemini-3.8-flash' },
      { provider: 'openrouter', model: 'google/gemini-3.8-flash' },
      { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' },
    ],
    // Gemini 3.x is tuned for its default temperature; leave it unset.
    maxOutputTokens: 32_768,
  },
  reviewer: {
    chain: [
      { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' },
      { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' },
    ],
    maxOutputTokens: 16_000,
    reasoningEffort: 'medium',
  },
};

export function parseChain(raw: string | undefined): ModelRef[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  return raw.split(',').map((entry) => {
    const trimmed = entry.trim();
    const sep = trimmed.indexOf(':');
    const provider = trimmed.slice(0, sep);
    const model = trimmed.slice(sep + 1);
    if (sep <= 0 || !model || (provider !== 'gemini' && provider !== 'openrouter')) {
      throw new Error(`Invalid model chain entry "${trimmed}". Use "gemini:<model>" or "openrouter:<vendor/model>".`);
    }
    return { provider, model };
  });
}

export function resolveRoles(env: NodeJS.ProcessEnv = process.env): Record<LlmRole, RoleSettings> {
  const roles = {} as Record<LlmRole, RoleSettings>;
  for (const role of LLM_ROLES) {
    const override = parseChain(env[`LLM_CHAIN_${role.toUpperCase()}`]);
    roles[role] = { ...DEFAULT_ROLES[role], chain: override ?? DEFAULT_ROLES[role].chain };
  }
  return roles;
}

// ---------------------------------------------------------------------------
// OpenRouter connection
// ---------------------------------------------------------------------------

export type OpenRouterConfig = {
  apiKey: string;
  httpReferer: string;
  xTitle: string;
  provider: {
    sort: 'price' | 'throughput' | 'latency';
    /** Only route to providers that support every request parameter (e.g. response_format). */
    require_parameters: boolean;
    allow_fallbacks: boolean;
  };
};

export const openRouterConfig: OpenRouterConfig = {
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? '',
  xTitle: process.env.OPENROUTER_X_TITLE || 'IA Devs - Prompt Chaining Article Generator',
  provider: {
    sort: 'throughput',
    require_parameters: true,
    allow_fallbacks: true,
  },
};

// ---------------------------------------------------------------------------
// Prices (USD per 1M tokens) — used only to ESTIMATE the cost of a run.
// OpenRouter prices checked on 2026-11-13. Gemini direct is listed at the same rate as an
// upper bound: on Google's free tier it costs nothing.
// ---------------------------------------------------------------------------

export const MODEL_PRICES_USD_PER_M: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-3.8-flash': { input: 0.825, output: 4.125 },
  'google/gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'google/gemini-3.8-flash': { input: 0.825, output: 4.125 },
  'anthropic/claude-sonnet-5.5': { input: 2.00, output: 10.00 },
  'deepseek/deepseek-v4.1-flash': { input: 0.30, output: 1.20 },
};

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

/** RESEARCH_SEARCH=auto|always|never (anything else → auto). */
export function researchSearchMode(env: Record<string, string | undefined> = process.env): 'auto' | 'always' | 'never' {
  const v = env.RESEARCH_SEARCH?.trim().toLowerCase();
  return v === 'always' || v === 'never' ? v : 'auto';
}
