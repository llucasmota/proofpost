export type WebSearchOptions = {
  maxResults: number;
  topic?: 'general' | 'news';
  timeRange?: 'day' | 'week' | 'month';
  includeDomains?: string[];
  excludeDomains?: string[];
  includeRawContent?: boolean;
};

export type WebSearchResult = {
  url: string;
  title: string;
  content: string;
  rawContent?: string;
  publishedDate?: string;
};

export interface IWebResearchClient {
  search(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]>;
  extract(urls: string[]): Promise<{ url: string; text: string }[]>;
}

const BASE_URL = 'https://api.tavily.com';
const TIMEOUT_MS = 30_000;

/** Minimal Tavily REST client (https://docs.tavily.com). Search uses "basic" depth = 1 credit. */
export class TavilyClient implements IWebResearchClient {
  private apiKey: string;
  private fetchImpl: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  private async post(path: string, body: unknown): Promise<any> {
    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Tavily ${path} HTTP ${response.status}: ${detail.slice(0, 200)}`);
    }
    return response.json();
  }

  async search(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]> {
    const data = await this.post('/search', {
      query,
      search_depth: 'basic',
      max_results: opts.maxResults,
      ...(opts.topic ? { topic: opts.topic } : {}),
      ...(opts.timeRange ? { time_range: opts.timeRange } : {}),
      ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
      ...(opts.excludeDomains?.length ? { exclude_domains: opts.excludeDomains } : {}),
      ...(opts.includeRawContent ? { include_raw_content: true } : {}),
    });
    return (data.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title ?? '',
      content: r.content ?? '',
      ...(r.raw_content ? { rawContent: r.raw_content } : {}),
      ...(r.published_date ? { publishedDate: r.published_date } : {}),
    }));
  }

  async extract(urls: string[]): Promise<{ url: string; text: string }[]> {
    if (urls.length === 0) return [];
    const data = await this.post('/extract', { urls, extract_depth: 'basic', format: 'markdown' });
    for (const failed of data.failed_results ?? []) {
      console.warn(`[Tavily] Could not extract ${failed.url}: ${failed.error}`);
    }
    return (data.results ?? [])
      .filter((r: any) => typeof r.raw_content === 'string' && r.raw_content.trim())
      .map((r: any) => ({ url: r.url, text: r.raw_content }));
  }
}

export function createWebResearchClient(env: Record<string, string | undefined> = process.env): IWebResearchClient | null {
  const key = env.TAVILY_API_KEY?.trim();
  return key ? new TavilyClient(key) : null;
}
