import test from 'node:test';
import assert from 'node:assert/strict';
import { TavilyClient, createWebResearchClient } from '../src/services/tavilyService.ts';

type Captured = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, captured: Captured[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

test('TavilyClient.search', async (t) => {
  await t.test('POSTs to /search with bearer auth and maps fields', async () => {
    const captured: Captured[] = [];
    const client = new TavilyClient('tvly-test', fakeFetch(200, {
      results: [{ url: 'https://a.dev', title: 'A', content: 'snippet', raw_content: 'full text', published_date: '2026-11-01' }],
    }, captured));

    const results = await client.search('flutter mediaquery', {
      maxResults: 3, topic: 'news', timeRange: 'week', includeDomains: ['flutter.dev'], includeRawContent: true,
      excludeDomains: ['linkedin.com'],
    });

    assert.equal(captured[0].url, 'https://api.tavily.com/search');
    assert.equal((captured[0].init.headers as Record<string, string>).Authorization, 'Bearer tvly-test');
    const body = JSON.parse(String(captured[0].init.body));
    assert.equal(body.query, 'flutter mediaquery');
    assert.equal(body.max_results, 3);
    assert.equal(body.topic, 'news');
    assert.equal(body.time_range, 'week');
    assert.deepEqual(body.include_domains, ['flutter.dev']);
    assert.deepEqual(body.exclude_domains, ['linkedin.com']);
    assert.equal(body.include_raw_content, true);
    assert.equal(body.search_depth, 'basic', 'basic = 1 credit');
    assert.deepEqual(results, [{ url: 'https://a.dev', title: 'A', content: 'snippet', rawContent: 'full text', publishedDate: '2026-11-01' }]);
  });

  await t.test('rejects with the HTTP status on 401', async () => {
    const client = new TavilyClient('bad', fakeFetch(401, { detail: 'Unauthorized' }, []));
    await assert.rejects(client.search('x', { maxResults: 1 }), /401/);
  });
});

test('TavilyClient.extract returns only successful extractions', async () => {
  const captured: Captured[] = [];
  const client = new TavilyClient('tvly-test', fakeFetch(200, {
    results: [{ url: 'https://a.dev', raw_content: 'article' }],
    failed_results: [{ url: 'https://b.dev', error: 'timeout' }],
  }, captured));
  const out = await client.extract(['https://a.dev', 'https://b.dev']);
  assert.equal(captured[0].url, 'https://api.tavily.com/extract');
  assert.deepEqual(JSON.parse(String(captured[0].init.body)).urls, ['https://a.dev', 'https://b.dev']);
  assert.deepEqual(out, [{ url: 'https://a.dev', text: 'article' }]);
});

test('createWebResearchClient returns null without TAVILY_API_KEY', () => {
  assert.equal(createWebResearchClient({}), null);
  assert.ok(createWebResearchClient({ TAVILY_API_KEY: 'tvly-x' }) instanceof TavilyClient);
});
