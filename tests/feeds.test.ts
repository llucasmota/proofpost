import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, collectFeedItems } from '../src/discovery/feeds.ts';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
<item><title>Node.js 26 released</title><link>https://nodejs.org/en/blog/26</link><pubDate>Tue, 10 Nov 2026 12:00:00 GMT</pubDate><description>Big release</description></item>
<item><title><![CDATA[Old & stale]]></title><link>https://nodejs.org/en/blog/old</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title>
<entry><title>v3.40.0</title><link rel="alternate" href="https://github.com/flutter/flutter/releases/tag/3.40.0"/><updated>2026-11-12T10:00:00Z</updated><content type="html">notes</content></entry>
</feed>`;

test('parseFeed', async (t) => {
  await t.test('RSS 2.0: title, link and ISO date', () => {
    const items = parseFeed(RSS, 'node-blog', 'node_react');
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], {
      title: 'Node.js 26 released', url: 'https://nodejs.org/en/blog/26', publishedAt: '2026-11-10T12:00:00.000Z',
      summary: 'Big release', feed: 'node-blog', niche: 'node_react',
    });
    assert.equal(items[1].title, 'Old & stale');
  });

  await t.test('Atom: title, link@href and updated', () => {
    const [item] = parseFeed(ATOM, 'flutter-releases', 'flutter_dart');
    assert.equal(item.title, 'v3.40.0');
    assert.equal(item.url, 'https://github.com/flutter/flutter/releases/tag/3.40.0');
    assert.equal(item.publishedAt, '2026-11-12T10:00:00.000Z');
  });

  await t.test('invalid XML → []', () => {
    assert.deepEqual(parseFeed('<<not xml', 'x', 'node_react'), []);
    assert.deepEqual(parseFeed('{"json": true}', 'x', 'node_react'), []);
  });
});

test('collectFeedItems drops old items and ignores failing feeds', async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('nodejs.org')) return new Response(RSS, { status: 200 });
    if (u.includes('flutter/flutter')) return new Response(ATOM, { status: 200 });
    return new Response('boom', { status: 500 });
  }) as typeof fetch;

  const items = await collectFeedItems(new Date('2026-11-06T00:00:00Z'), fetchImpl);
  const urls = items.map((i) => i.url);
  assert.ok(urls.includes('https://nodejs.org/en/blog/26'));
  assert.ok(urls.includes('https://github.com/flutter/flutter/releases/tag/3.40.0'));
  assert.ok(!urls.includes('https://nodejs.org/en/blog/old'));
});

test('isPrerelease flags dev/pre/beta/rc/canary builds only', async () => {
  const { isPrerelease } = await import('../src/discovery/feeds.ts');
  for (const t of ['3.15.0-146.0.dev', '3.51.0-0.1.pre', 'v19.0.0-rc.1', 'next v16.1.0-canary.3', '2.0.0-beta.2', 'v1.0.0-alpha']) {
    assert.ok(isPrerelease(t), t);
  }
  for (const t of ['3.50.0', 'v3.40.0', 'Node.js 26 released', 'React Compiler beta is over: what changed']) {
    assert.ok(!isPrerelease(t), t);
  }
});

test('collectFeedItems keeps at most 5 items per feed and drops pre-releases', async () => {
  const entries = Array.from({ length: 8 }, (_, i) =>
    `<entry><title>v1.${i}.0</title><link href="https://github.com/x/y/releases/tag/v1.${i}.0"/><updated>2026-11-1${i % 3}T00:00:00Z</updated></entry>`).join('')
    + '<entry><title>v2.0.0-rc.1</title><link href="https://github.com/x/y/releases/tag/rc"/><updated>2026-11-12T00:00:00Z</updated></entry>';
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
  const fetchImpl = (async (url: string | URL | Request) =>
    String(url).includes('flutter/flutter') ? new Response(atom) : new Response('x', { status: 500 })) as typeof fetch;
  const items = await collectFeedItems(new Date('2026-11-01T00:00:00Z'), fetchImpl);
  assert.equal(items.length, 5);
  assert.ok(!items.some((i) => i.title.includes('rc')));
});
