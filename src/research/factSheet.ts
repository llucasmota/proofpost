import { z } from 'zod/v3';
import type { SourceDoc } from './sources.ts';

export const FactSchema = z.object({
  claim: z.string().describe('Short, precise technical statement in English, faithful to the quote.'),
  sourceId: z.string().describe('Exactly one of the source ids from the [SOURCE ...] headers.'),
  quote: z.string().describe('Verbatim excerpt from that source (max 300 chars) that supports the claim.'),
  publishedAt: z.string().describe('Source date in ISO format if known, otherwise empty string.'),
  contradictsUserSource: z.boolean().describe('True only for a search-source fact that contradicts a user source.'),
});

export const FactSheetOutputSchema = z.object({
  facts: z.array(FactSchema),
  gaps: z.array(z.string()).describe('What the instruction asks about that the sources do not cover.'),
});

export type Fact = z.infer<typeof FactSchema>;
/** Shorter quotes (e.g. a single word) prove nothing about the claim. */
export const MIN_QUOTE_CHARS = 15;

export type DropReason = 'unknown_source' | 'quote_not_found' | 'contradicts_user_source';

/** Normalizes text for quote matching: case, curly quotes, dashes and whitespace. */
export function normalizeForQuote(s: string): string {
  return s
    // Sources come as markdown (Tavily Extract); models usually quote without the markup.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .toLowerCase()
    .replace(/[“”„″]/g, '"')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic guard against invented citations: a fact survives only if its quote really
 * appears in the cited source, and a search fact never overrides the user's own sources.
 */
export function verifyFacts(facts: Fact[], sources: SourceDoc[]) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const normalizedText = new Map<string, string>();
  const kept: Fact[] = [];
  const dropped: { fact: Fact; reason: DropReason }[] = [];

  for (const fact of facts) {
    const source = byId.get(fact.sourceId);
    if (!source) {
      dropped.push({ fact, reason: 'unknown_source' });
      continue;
    }
    if (source.kind === 'search' && fact.contradictsUserSource) {
      dropped.push({ fact, reason: 'contradicts_user_source' });
      continue;
    }
    if (!normalizedText.has(source.id)) normalizedText.set(source.id, normalizeForQuote(source.text));
    const quote = normalizeForQuote(fact.quote);
    if (quote.length < MIN_QUOTE_CHARS || !normalizedText.get(source.id)!.includes(quote)) {
      dropped.push({ fact, reason: 'quote_not_found' });
      continue;
    }
    kept.push(fact);
  }
  return { kept, dropped };
}
