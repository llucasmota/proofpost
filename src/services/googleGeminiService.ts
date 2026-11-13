import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { z } from 'zod/v3';
import {
  failure,
  LLM_CALL_TIMEOUT_MS,
  unwrapStructured,
  type ILlmService,
  type LLMStructuredResult,
  type RawStructured,
} from './llmService.ts';

export type GeminiOptions = {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

/** Calls the Gemini API directly (GEMINI_API_KEY), without OpenRouter. */
export class GoogleGeminiService implements ILlmService {
  readonly name: string;
  private readonly model: string;
  private llmClient: ChatGoogleGenerativeAI;

  constructor(options: GeminiOptions = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ GEMINI_API_KEY is not set in environment variables.');
    }

    this.model = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.name = `gemini:${this.model}`;
    this.llmClient = new ChatGoogleGenerativeAI({
      apiKey,
      model: this.model,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
      // LangChain's default is 6 retries with exponential backoff, and it retries 429
      // (including Gemini's RESOURCE_EXHAUSTED quota errors). That made the fallback take
      // minutes. Retry once for blips; the fallback layer handles the rest.
      maxRetries: 1,
    });
  }

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodSchema<T>
  ): Promise<LLMStructuredResult<T>> {
    try {
      const structured = this.llmClient.withStructuredOutput(schema, { includeRaw: true });
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
