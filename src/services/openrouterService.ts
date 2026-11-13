import { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod/v3';
import { openRouterConfig, type OpenRouterConfig } from '../config.ts';
import {
  failure,
  LLM_CALL_TIMEOUT_MS,
  unwrapStructured,
  type ILlmService,
  type LLMStructuredResult,
  type RawStructured,
} from './llmService.ts';

export type OpenRouterOptions = {
  /** OpenRouter model id, e.g. "anthropic/claude-sonnet-5.5". */
  model: string;
  /** Omit to use the model's default (required for Claude Sonnet 5.5). */
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  connection?: OpenRouterConfig;
};

export class OpenRouterService implements ILlmService {
  readonly name: string;
  private readonly model: string;
  private llmClient: ChatOpenAI;

  constructor(options: OpenRouterOptions) {
    const cfg = options.connection ?? openRouterConfig;
    if (!cfg.apiKey) {
      console.warn('⚠️ OPENROUTER_API_KEY is not set in environment variables.');
    }
    this.model = options.model;
    this.name = `openrouter:${options.model}`;

    this.llmClient = new ChatOpenAI({
      apiKey: cfg.apiKey,
      model: options.model,
      // Leaving temperature undefined means it is not sent at all.
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens ? { maxTokens: options.maxOutputTokens } : {}),
      maxRetries: 1,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': cfg.httpReferer,
          'X-Title': cfg.xTitle,
        },
      },
      modelKwargs: {
        provider: cfg.provider,
        ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
      },
    });
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodSchema<T>,
  ): Promise<LLMStructuredResult<T>> {
    try {
      // Sends `response_format: json_schema`. With `provider.require_parameters` OpenRouter
      // only routes to providers that honor it.
      const structured = this.llmClient.withStructuredOutput(schema, { method: 'jsonSchema', includeRaw: true });
      const result = await structured.invoke(
        [
          ['system', systemPrompt],
          ['user', userPrompt],
        ],
        { timeout: LLM_CALL_TIMEOUT_MS },
      );
      return unwrapStructured<T>(result as RawStructured, this.name, this.model);
    } catch (error) {
      const result = failure<T>(error, this.name, this.model);
      console.error(`🔴 [${this.name}] ${result.errorKind}: ${result.error}`);
      return result;
    }
  }
}
