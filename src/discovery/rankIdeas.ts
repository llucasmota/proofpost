import { z } from 'zod/v3';
import type { ILlmService } from '../services/llmService.ts';
import { prompts } from '../config.ts';
import type { PostNiche } from '../research/officialDomains.ts';

export type Candidate = {
  title: string;
  url: string;
  summary?: string;
  publishedAt?: string;
  niche: PostNiche;
  origin: 'feed' | 'search';
};

export const IdeaSchema = z.object({
  title: z.string(),
  topicEn: z.string().describe('The topic in English, 4 to 12 words, used to research and write the post (e.g. "Node.js November 2026 security releases").'),
  niche: z.enum(['flutter_dart', 'node_react', 'ai_engineering']),
  postType: z.enum(['quick', 'deep']),
  whatItIs: z.string(),
  whyItMatters: z.string(),
  studyLinks: z.array(z.object({ url: z.string(), note: z.string() })),
  angle: z.string(),
});

export const IdeasOutputSchema = z.object({ ideas: z.array(IdeaSchema) });

/** topicEn is optional for ideas files written before it existed. */
export type Idea = Omit<z.infer<typeof IdeaSchema>, 'topicEn'> & { topicEn?: string };

const MAX_IDEAS = 7;
const MAX_CANDIDATES_FOR_LLM = 40;
const SUMMARY_CHARS_FOR_LLM = 300;

/** Removes links that did not come from the collected candidates; drops ideas left without links. */
export function sanitizeIdeas(ideas: Idea[], candidates: Candidate[]): Idea[] {
  const known = new Set(candidates.map((c) => c.url));
  return ideas
    .map((i) => ({ ...i, studyLinks: i.studyLinks.filter((l) => known.has(l.url)) }))
    .filter((i) => i.studyLinks.length > 0)
    .slice(0, MAX_IDEAS);
}

export async function rankIdeas(llm: ILlmService, candidates: Candidate[], historyTitles: string[]): Promise<Idea[]> {
  const list = candidates.slice(0, MAX_CANDIDATES_FOR_LLM).map((c, i) =>
    `${i + 1}. [${c.niche} · ${c.origin}${c.publishedAt ? ` · ${c.publishedAt.slice(0, 10)}` : ''}] ${c.title}\n   URL: ${c.url}` +
    (c.summary ? `\n   ${c.summary.slice(0, SUMMARY_CHARS_FOR_LLM)}` : ''),
  ).join('\n');
  const user = `CANDIDATES:\n${list}\n\nALREADY POSTED OR SUGGESTED:\n${historyTitles.map((t) => `- ${t}`).join('\n') || '(none)'}`;

  const result = await llm.generateStructured(prompts.ideasRanker, user, IdeasOutputSchema);
  if (!result.success || !result.data) {
    console.warn(`[Ideas] Ranking failed: ${result.error ?? 'no data'}`);
    return [];
  }
  return sanitizeIdeas(result.data.ideas, candidates);
}
