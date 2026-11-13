import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIdeas, type IdeasDeps } from '../src/discovery/runIdeas.ts';
import type { ILlmService, LLMStructuredResult } from '../src/services/llmService.ts';
import type { FeedItem } from '../src/discovery/feeds.ts';

const feedItems: FeedItem[] = [
  { title: 'Node.js 26 released', url: 'https://nodejs.org/26', feed: 'f', niche: 'node_react', publishedAt: '2026-11-12T00:00:00.000Z' },
  { title: 'New MediaQuery APIs in Flutter sizeOf', url: 'https://flutter.dev/mq', feed: 'f', niche: 'flutter_dart' },
];

class RankerLlm implements ILlmService {
  name = 'ranker';
  prompts: string[] = [];
  result: LLMStructuredResult<any>;
  constructor(result: LLMStructuredResult<any>) { this.result = result; }
  async generateStructured<T>(_s: string, user: string): Promise<LLMStructuredResult<T>> {
    this.prompts.push(user);
    return this.result as LLMStructuredResult<T>;
  }
}

const okIdeas = {
  success: true,
  data: { ideas: [{ title: 'Node 26', niche: 'node_react', postType: 'quick', whatItIs: 'w', whyItMatters: 'y', angle: 'a', studyLinks: [{ url: 'https://nodejs.org/26', note: 'n' }] }] },
};

async function setup(over: Partial<IdeasDeps> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-run-ideas-'));
  await fs.writeFile(path.join(dir, 'history.json'), JSON.stringify([
    { date: '2026-11-01', title: 'New MediaQuery APIs in Flutter: sizeOf', kind: 'posted', urls: [] },
  ]));
  const notes: string[] = [];
  const llm = new RankerLlm(okIdeas);
  const deps: IdeasDeps = {
    llm, web: null, collectFeeds: async () => feedItems, notify: async (m) => { notes.push(m); },
    now: () => new Date('2026-11-16T08:00:00Z'), dir, ...over,
  };
  return { dir, deps, notes, llm };
}

test('runIdeas', async (t) => {
  await t.test('writes the ideas file, updates history and notifies', async () => {
    const { dir, deps, notes } = await setup();
    const r = await runIdeas(deps);
    assert.equal(r.count, 1);
    assert.equal(r.mdPath, path.join(dir, '2026-11-16.md'));
    const history = JSON.parse(await fs.readFile(path.join(dir, 'history.json'), 'utf-8'));
    assert.ok(history.some((e: any) => e.kind === 'suggested' && e.title === 'Node 26'));
    assert.deepEqual(notes, ['1 pautas novas']);
  });

  await t.test('candidates already posted never reach the LLM', async () => {
    const { deps, llm } = await setup();
    await runIdeas(deps);
    assert.ok(llm.prompts[0].includes('https://nodejs.org/26'));
    assert.ok(!llm.prompts[0].includes('https://flutter.dev/mq'));
  });

  await t.test('the weekly news search excludes social networks', async () => {
    const calls: any[] = [];
    const web = { search: async (_q: string, opts: any) => { calls.push(opts); return []; }, extract: async () => [] };
    const { deps } = await setup({ web });
    await runIdeas(deps);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((o) => o.excludeDomains?.includes('linkedin.com')));
  });

  await t.test('a failing web search falls back to feeds only', async () => {
    const web = { search: async () => { throw new Error('401'); }, extract: async () => [] };
    const { deps } = await setup({ web });
    assert.equal((await runIdeas(deps)).count, 1);
  });

  await t.test('no candidates → no file, notifies, count 0', async () => {
    const { deps, notes, dir } = await setup({ collectFeeds: async () => [] });
    assert.deepEqual(await runIdeas(deps), { mdPath: null, count: 0 });
    assert.deepEqual(notes, ['Nenhuma pauta nova']);
    assert.ok(!(await fs.readdir(dir)).some((f) => f.endsWith('.md')));
  });

  await t.test('LLM failure → no file, notifies, count 0', async () => {
    const { deps, notes } = await setup({ llm: new RankerLlm({ success: false, error: 'down' }) });
    assert.deepEqual(await runIdeas(deps), { mdPath: null, count: 0 });
    assert.deepEqual(notes, ['Nenhuma pauta nova']);
  });
});

test('runIdeasSafely notifies on failure and still rejects', async () => {
  const { runIdeasSafely, FAILURE_MESSAGE } = await import('../src/discovery/runIdeas.ts');
  const { deps, notes } = await setup({ collectFeeds: async () => { throw new Error('offline'); } });
  await assert.rejects(runIdeasSafely(deps), /offline/);
  assert.deepEqual(notes, [FAILURE_MESSAGE]);
  assert.match(FAILURE_MESSAGE, /ideas\/logs\/ideas\.log/);
});

test('runIdeasSafely passes a successful run through', async () => {
  const { runIdeasSafely } = await import('../src/discovery/runIdeas.ts');
  const { deps, notes } = await setup();
  assert.equal((await runIdeasSafely(deps)).count, 1);
  assert.deepEqual(notes, ['1 pautas novas']);
});

test('notifications are titled Proofpost', async () => {
  const { NOTIFY_TITLE } = await import('../src/discovery/notify.ts');
  assert.equal(NOTIFY_TITLE, 'Proofpost');
});
