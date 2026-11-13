import { XMLParser } from 'fast-xml-parser';
import type { PostNiche } from '../research/officialDomains.ts';
import { WATCHED } from './sources.ts';

export type FeedItem = {
  title: string;
  url: string;
  publishedAt?: string;
  summary?: string;
  feed: string;
  niche: PostNiche;
};

const FEED_TIMEOUT_MS = 10_000;
const SUMMARY_CHARS = 500;
const MAX_ITEMS_PER_FEED = 5;

/** "3.15.0-146.0.dev", "v19.0.0-rc.1", "v16.1.0-canary.3": pre-release builds are noise for posts. */
export function isPrerelease(title: string): boolean {
  return /\d+(?:\.\d+)*-[0-9a-z.]*?(?:dev|pre|rc|beta|alpha|canary|nightly)/i.test(title);
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
  return String(v).trim();
}

function isoDate(v: unknown): string | undefined {
  const raw = text(v);
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS);
}

function atomLink(link: unknown): string {
  const links = asArray(link as any);
  const alt = links.find((l: any) => !l?.['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
  return typeof alt === 'string' ? alt : alt?.['@_href'] ?? '';
}

/** Parses RSS 2.0 or Atom. Anything unparseable yields []. */
export function parseFeed(xml: string, feed: string, niche: PostNiche): FeedItem[] {
  if (!xml.trimStart().startsWith('<')) return [];
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  const build = (title: string, url: string, date: unknown, summary: string): FeedItem | null => {
    if (!title || !url) return null;
    const publishedAt = isoDate(date);
    return { title, url, ...(publishedAt ? { publishedAt } : {}), ...(summary ? { summary } : {}), feed, niche };
  };

  const rssItems = asArray(doc?.rss?.channel?.item);
  if (rssItems.length) {
    return rssItems
      .map((i: any) => build(text(i.title), text(i.link), i.pubDate ?? i['dc:date'], plain(text(i.description))))
      .filter((x): x is FeedItem => x !== null);
  }

  const entries = asArray(doc?.feed?.entry);
  return entries
    .map((e: any) => build(text(e.title), atomLink(e.link), e.updated ?? e.published, plain(text(e.summary ?? e.content))))
    .filter((x): x is FeedItem => x !== null);
}

/** Reads every watched feed in parallel; failures are logged and skipped. Keeps items since `since`. */
export async function collectFeedItems(since: Date, fetchImpl: typeof fetch = fetch): Promise<FeedItem[]> {
  const jobs = (Object.entries(WATCHED) as [PostNiche, { feeds: string[] }][])
    .flatMap(([niche, w]) => w.feeds.map((feed) => ({ niche, feed })));

  const results = await Promise.all(jobs.map(async ({ niche, feed }) => {
    try {
      const res = await fetchImpl(feed, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { 'User-Agent': 'content-builder/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseFeed(await res.text(), feed, niche)
        .filter((i) => !isPrerelease(i.title) && (!i.publishedAt || new Date(i.publishedAt) >= since))
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .slice(0, MAX_ITEMS_PER_FEED);
    } catch (e) {
      console.warn(`[Feeds] Skipping ${feed}: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }));

  return results.flat();
}
