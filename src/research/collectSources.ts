import type { IWebResearchClient, WebSearchOptions } from '../services/tavilyService.ts';
import { OFFICIAL_DOMAINS, SOCIAL_DOMAINS, type PostNiche } from './officialDomains.ts';
import { selectRelevantText, type SourceDoc } from './sources.ts';

export type SearchMode = 'auto' | 'always' | 'never';

export type CollectInput = {
  userContext: string[];
  urls: string[];
  searchQuery: string;
  niche: PostNiche;
  mode: SearchMode;
};

export type CollectDeps = {
  web: IWebResearchClient | null;
  fetchUrl: (url: string) => Promise<string | null>;
};

const MAIN_SEARCH_RESULTS = 5;
const COMPLEMENTARY_SEARCH_RESULTS = 3;

function queryTerms(query: string): string[] {
  return query.split(/[^\p{L}\p{N}._-]+/u).filter((w) => w.length >= 4);
}

async function readUserUrls(urls: string[], deps: CollectDeps): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  if (deps.web && urls.length) {
    try {
      for (const r of await deps.web.extract(urls)) texts.set(r.url, r.text);
    } catch (e) {
      console.warn(`[Research] Tavily extract failed (${e instanceof Error ? e.message : e}); using local fetch.`);
    }
  }
  for (const url of urls) {
    if (texts.has(url)) continue;
    const text = await deps.fetchUrl(url).catch(() => null);
    if (text) texts.set(url, text);
    else console.warn(`[Research] ❌ Could not read ${url}`);
  }
  return texts;
}

/**
 * Gathers every source for one run: the user's pasted context, the user's URLs (Tavily Extract,
 * falling back to the local fetcher) and, depending on `mode`, a Tavily search.
 * Never throws because of a network/API failure: missing pieces are logged and skipped.
 */
export async function collectSources(input: CollectInput, deps: CollectDeps): Promise<SourceDoc[]> {
  const terms = queryTerms(input.searchQuery);
  const sources: SourceDoc[] = input.userContext
    .filter((c) => c.trim())
    .map((text, i) => ({ id: `ctx-${i + 1}`, kind: 'user_context' as const, text }));

  const urlTexts = await readUserUrls(input.urls, deps);
  let n = 0;
  for (const url of input.urls) {
    const text = urlTexts.get(url);
    if (text) sources.push({ id: `url-${++n}`, kind: 'user_url', url, text: selectRelevantText(text, terms) });
  }

  const hasUserSource = sources.length > 0;
  if (input.mode === 'never' || !deps.web || !input.searchQuery.trim()) return sources;

  const main = input.mode === 'always' || !hasUserSource;
  const opts: WebSearchOptions = main
    ? { maxResults: MAIN_SEARCH_RESULTS, includeRawContent: true, excludeDomains: SOCIAL_DOMAINS }
    : { maxResults: COMPLEMENTARY_SEARCH_RESULTS, includeRawContent: true, includeDomains: OFFICIAL_DOMAINS[input.niche] };

  try {
    const results = await deps.web.search(input.searchQuery, opts);
    let w = 0;
    for (const r of results) {
      if (input.urls.includes(r.url) || sources.some((s) => s.url === r.url)) continue;
      const text = r.rawContent || r.content;
      if (!text?.trim()) continue;
      sources.push({
        id: `web-${++w}`,
        kind: 'search',
        url: r.url,
        ...(r.title ? { title: r.title } : {}),
        ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}),
        text: selectRelevantText(text, terms),
      });
    }
  } catch (e) {
    console.warn(`[Research] Tavily search failed (${e instanceof Error ? e.message : e}); continuing without it.`);
  }
  return sources;
}
