import fs from 'node:fs/promises';
import path from 'node:path';
import type { ILlmService } from '../services/llmService.ts';
import type { IWebResearchClient } from '../services/tavilyService.ts';
import { usageTracker } from '../services/usageTracker.ts';
import { SOCIAL_DOMAINS, type PostNiche } from '../research/officialDomains.ts';
import type { FeedItem } from './feeds.ts';
import { WATCHED } from './sources.ts';
import { isDuplicate, loadHistory, markSuggested, saveHistory } from './history.ts';
import { rankIdeas, type Candidate } from './rankIdeas.ts';
import { writeIdeasFiles } from './ideasFile.ts';

export type IdeasDeps = {
  llm: ILlmService;
  web: IWebResearchClient | null;
  collectFeeds: (since: Date) => Promise<FeedItem[]>;
  notify: (msg: string) => Promise<void>;
  now: () => Date;
  dir: string;
  lookbackDays?: number;
};

const NEWS_RESULTS_PER_NICHE = 5;

async function searchNews(web: IWebResearchClient | null): Promise<Candidate[]> {
  if (!web) return [];
  const out: Candidate[] = [];
  for (const [niche, w] of Object.entries(WATCHED) as [PostNiche, { techs: string[] }][]) {
    try {
      const results = await web.search(w.techs.join(' OR '), { maxResults: NEWS_RESULTS_PER_NICHE, topic: 'news', timeRange: 'week', excludeDomains: SOCIAL_DOMAINS });
      for (const r of results) {
        out.push({ title: r.title, url: r.url, summary: r.content, niche, origin: 'search', ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}) });
      }
    } catch (e) {
      console.warn(`[Ideas] News search failed for ${niche}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

export async function runIdeas(deps: IdeasDeps): Promise<{ mdPath: string; count: number } | { mdPath: null; count: 0 }> {
  const now = deps.now();
  const date = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - (deps.lookbackDays ?? 7) * 86_400_000);
  const historyPath = path.join(deps.dir, 'history.json');
  const history = await loadHistory(historyPath);

  const feedCandidates: Candidate[] = (await deps.collectFeeds(since)).map((i) => ({
    title: i.title, url: i.url, niche: i.niche, origin: 'feed',
    ...(i.summary ? { summary: i.summary } : {}), ...(i.publishedAt ? { publishedAt: i.publishedAt } : {}),
  }));
  const all = [...feedCandidates, ...(await searchNews(deps.web))];

  const seen = new Set<string>();
  const candidates = all.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return !isDuplicate({ url: c.url, title: c.title }, history);
  });
  console.log(`[Ideas] ${all.length} candidate(s), ${candidates.length} after dedupe.`);

  const ideas = candidates.length ? await rankIdeas(deps.llm, candidates, history.map((h) => h.title)) : [];
  if (ideas.length === 0) {
    await deps.notify('Nenhuma pauta nova');
    return { mdPath: null, count: 0 };
  }

  await saveHistory(markSuggested(history, ideas.map((i) => ({ title: i.title, urls: i.studyLinks.map((l) => l.url), niche: i.niche })), date), historyPath);
  const { mdPath, jsonPath } = await writeIdeasFiles({ date, ideas }, deps.dir);
  await fs.writeFile(jsonPath.replace(/\.json$/, '.usage.json'), JSON.stringify(usageTracker.summary(), null, 2), 'utf-8');
  await deps.notify(`${ideas.length} pautas novas`);
  return { mdPath, count: ideas.length };
}

export const FAILURE_MESSAGE = 'Falha ao buscar pautas — veja ideas/logs/ideas.log';

/** Like runIdeas, but a failure also reaches the user as a notification (scheduled runs are unattended). */
export async function runIdeasSafely(deps: IdeasDeps): ReturnType<typeof runIdeas> {
  try {
    return await runIdeas(deps);
  } catch (e) {
    await deps.notify(FAILURE_MESSAGE).catch(() => {});
    throw e;
  }
}
