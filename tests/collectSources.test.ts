import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSources, type CollectInput } from '../src/research/collectSources.ts';
import { selectRelevantText } from '../src/research/sources.ts';
import { OFFICIAL_DOMAINS, SOCIAL_DOMAINS } from '../src/research/officialDomains.ts';
import type { IWebResearchClient, WebSearchOptions, WebSearchResult } from '../src/services/tavilyService.ts';

class FakeWeb implements IWebResearchClient {
  searches: { query: string; opts: WebSearchOptions }[] = [];
  extracted: string[][] = [];
  results: WebSearchResult[];
  extractMap: Record<string, string>;
  searchError?: Error;
  constructor(
    results: WebSearchResult[] = [{ url: 'https://s.dev/1', title: 'S1', content: 'short', rawContent: 'raw one' }],
    extractMap: Record<string, string> = {},
    searchError?: Error,
  ) {
    this.results = results;
    this.extractMap = extractMap;
    this.searchError = searchError;
  }
  async search(query: string, opts: WebSearchOptions) {
    this.searches.push({ query, opts });
    if (this.searchError) throw this.searchError;
    return this.results.slice(0, opts.maxResults);
  }
  async extract(urls: string[]) {
    this.extracted.push(urls);
    return urls.filter((u) => this.extractMap[u]).map((u) => ({ url: u, text: this.extractMap[u] }));
  }
}

const base: CollectInput = { userContext: [], urls: [], searchQuery: 'flutter mediaquery', niche: 'flutter_dart', mode: 'auto' };
const noFetch = async () => { throw new Error('fetchUrl should not be called'); };

test('collectSources', async (t) => {
  await t.test('context only (auto): user_context source + short complementary search on official domains', async () => {
    const web = new FakeWeb();
    const out = await collectSources({ ...base, userContext: ['my notes'] }, { web, fetchUrl: noFetch });
    assert.deepEqual(out[0], { id: 'ctx-1', kind: 'user_context', text: 'my notes' });
    assert.equal(web.searches.length, 1);
    assert.equal(web.searches[0].opts.maxResults, 3);
    assert.deepEqual(web.searches[0].opts.includeDomains, OFFICIAL_DOMAINS.flutter_dart);
  });

  await t.test('no context, no URL (auto): main search with 5 results, raw content, no domain filter', async () => {
    const web = new FakeWeb([
      { url: 'https://s.dev/1', title: 'S1', content: 'short1', rawContent: 'raw1', publishedDate: '2026-11-01' },
      { url: 'https://s.dev/2', title: 'S2', content: 'short2' },
    ]);
    const out = await collectSources(base, { web, fetchUrl: noFetch });
    assert.equal(web.searches[0].opts.maxResults, 5);
    assert.equal(web.searches[0].opts.includeDomains, undefined);
    assert.equal(web.searches[0].opts.includeRawContent, true);
    assert.deepEqual(web.searches[0].opts.excludeDomains, SOCIAL_DOMAINS, 'social posts are not sources');
    assert.ok(SOCIAL_DOMAINS.includes('linkedin.com') && SOCIAL_DOMAINS.includes('instagram.com'));
    assert.deepEqual(out.map((s) => [s.id, s.kind, s.text]), [['web-1', 'search', 'raw1'], ['web-2', 'search', 'short2']]);
    assert.equal(out[0].publishedAt, '2026-11-01');
  });

  await t.test('URL extracted by Tavily becomes user_url and local fetch is not used', async () => {
    const web = new FakeWeb([], { 'https://u.dev': 'article text' });
    const out = await collectSources({ ...base, urls: ['https://u.dev'] }, { web, fetchUrl: noFetch });
    assert.deepEqual(out[0], { id: 'url-1', kind: 'user_url', url: 'https://u.dev', text: 'article text' });
  });

  await t.test('URL missing from extract falls back to local fetch', async () => {
    const web = new FakeWeb([]);
    const calls: string[] = [];
    const out = await collectSources({ ...base, urls: ['https://u.dev'] }, {
      web, fetchUrl: async (u) => { calls.push(u); return 'fetched'; },
    });
    assert.deepEqual(calls, ['https://u.dev']);
    assert.equal(out[0].text, 'fetched');
  });

  await t.test('unreadable URL in auto mode escalates to the main search (5)', async () => {
    const web = new FakeWeb();
    await collectSources({ ...base, urls: ['https://u.dev'] }, { web, fetchUrl: async () => null });
    assert.equal(web.searches[0].opts.maxResults, 5);
  });

  await t.test('without a Tavily client: no search, user sources kept', async () => {
    const out = await collectSources({ ...base, userContext: ['notes'], urls: ['https://u.dev'] }, {
      web: null, fetchUrl: async () => 'page',
    });
    assert.deepEqual(out.map((s) => s.kind), ['user_context', 'user_url']);
  });

  await t.test('a failing search does not throw and keeps user sources', async () => {
    const web = new FakeWeb([], {}, new Error('432 quota'));
    const out = await collectSources({ ...base, userContext: ['notes'] }, { web, fetchUrl: noFetch });
    assert.deepEqual(out.map((s) => s.kind), ['user_context']);
  });

  await t.test('a failing extract falls back to local fetch', async () => {
    const web = new FakeWeb([]);
    web.extract = async () => { throw new Error('500'); };
    const out = await collectSources({ ...base, urls: ['https://u.dev'], mode: 'never' }, { web, fetchUrl: async () => 'page' });
    assert.equal(out[0].text, 'page');
  });

  await t.test('never mode does not search; always mode does a main search even with context', async () => {
    const web1 = new FakeWeb();
    await collectSources({ ...base, mode: 'never' }, { web: web1, fetchUrl: noFetch });
    assert.equal(web1.searches.length, 0);
    const web2 = new FakeWeb();
    await collectSources({ ...base, userContext: ['n'], mode: 'always' }, { web: web2, fetchUrl: noFetch });
    assert.equal(web2.searches[0].opts.maxResults, 5);
  });

  await t.test('search results duplicating a user URL are dropped', async () => {
    const web = new FakeWeb([{ url: 'https://u.dev', title: 'dup', content: 'x' }], { 'https://u.dev': 'article' });
    const out = await collectSources({ ...base, urls: ['https://u.dev'] }, { web, fetchUrl: noFetch });
    assert.equal(out.filter((s) => s.url === 'https://u.dev').length, 1);
  });
});

test('selectRelevantText', async (t) => {
  await t.test('short text is returned unchanged', () => {
    assert.equal(selectRelevantText('abc', ['x'], 100), 'abc');
  });

  await t.test('long text keeps the relevant paragraph, original order, within the limit', () => {
    const filler = (n: number) => `filler paragraph ${n} `.repeat(20).trim();
    const text = [filler(1), 'MediaQuery.sizeOf avoids rebuilds', filler(2), filler(3), 'closing note about sizeOf'].join('\n\n');
    const out = selectRelevantText(text, ['sizeof'], 600);
    assert.ok(out.length <= 600, `length ${out.length}`);
    assert.ok(out.includes('MediaQuery.sizeOf avoids rebuilds'));
    assert.ok(out.indexOf('MediaQuery.sizeOf') < out.indexOf('closing note'));
  });
});
