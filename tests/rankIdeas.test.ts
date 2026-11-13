import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeIdeas, type Idea, type Candidate } from '../src/discovery/rankIdeas.ts';

const candidates: Candidate[] = [
  { title: 'Node 26', url: 'https://nodejs.org/26', niche: 'node_react', origin: 'feed' },
  { title: 'LangGraph 1.5', url: 'https://github.com/langchain-ai/langgraphjs/releases/tag/1.5', niche: 'ai_engineering', origin: 'feed' },
];

const idea = (over: Partial<Idea> = {}): Idea => ({
  title: 'Node 26 is out', niche: 'node_react', postType: 'quick', whatItIs: 'w', whyItMatters: 'y', angle: 'a',
  studyLinks: [{ url: 'https://nodejs.org/26', note: 'release notes' }], ...over,
});

test('sanitizeIdeas', async (t) => {
  await t.test('removes invented links and keeps real ones', () => {
    const [out] = sanitizeIdeas([idea({ studyLinks: [{ url: 'https://nodejs.org/26', note: 'ok' }, { url: 'https://invented.dev', note: 'fake' }] })], candidates);
    assert.deepEqual(out.studyLinks.map((l) => l.url), ['https://nodejs.org/26']);
  });

  await t.test('drops an idea left without any link', () => {
    assert.equal(sanitizeIdeas([idea({ studyLinks: [{ url: 'https://invented.dev', note: 'x' }] })], candidates).length, 0);
  });

  await t.test('keeps at most 7 ideas', () => {
    assert.equal(sanitizeIdeas(Array.from({ length: 9 }, () => idea()), candidates).length, 7);
  });
});
