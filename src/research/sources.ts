import { z } from 'zod/v3';

export type SourceKind = 'user_context' | 'user_url' | 'search';

export const SourceDocSchema = z.object({
  id: z.string(),
  kind: z.enum(['user_context', 'user_url', 'search']),
  url: z.string().optional(),
  title: z.string().optional(),
  publishedAt: z.string().optional(),
  text: z.string(),
});

export type SourceDoc = z.infer<typeof SourceDocSchema>;

/** Per-source cap of text kept in the state. */
export const MAX_SOURCE_CHARS = 20_000;

/**
 * Shrinks a long source without blindly cutting at the start: keeps the paragraphs that mention
 * the most query terms (ties → earlier first), then restores the original order.
 */
export function selectRelevantText(text: string, terms: string[], maxChars = MAX_SOURCE_CHARS): string {
  if (text.length <= maxChars) return text;

  const lowered = terms.map((t) => t.toLowerCase()).filter(Boolean);
  const paragraphs = text.split(/\n\s*\n/).map((p, index) => {
    const lower = p.toLowerCase();
    const score = lowered.reduce((s, t) => s + (lower.includes(t) ? 1 : 0), 0);
    return { p: p.trim(), index, score };
  }).filter((x) => x.p);

  const ranked = [...paragraphs].sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen: typeof paragraphs = [];
  let size = 0;
  for (const item of ranked) {
    const cost = item.p.length + 2;
    if (size + cost > maxChars) continue;
    chosen.push(item);
    size += cost;
  }
  if (chosen.length === 0) return text.slice(0, maxChars);
  return chosen.sort((a, b) => a.index - b.index).map((x) => x.p).join('\n\n');
}
