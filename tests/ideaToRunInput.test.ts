import test from 'node:test';
import assert from 'node:assert/strict';
import { ideaToRunInput } from '../src/app/ideaToRunInput.ts';
import type { Idea } from '../src/discovery/rankIdeas.ts';

const idea: Idea = {
  title: 'LangGraph JS 1.5: checkpointers novos no Postgres', niche: 'ai_engineering', postType: 'deep',
  whatItIs: 'w', whyItMatters: 'y', angle: 'compare with MemorySaver',
  studyLinks: [{ url: 'https://github.com/langchain-ai/langgraphjs/releases/tag/1.5', note: 'n' }, { url: 'https://docs.langchain.com/x', note: 'n' }],
};

test('ideaToRunInput maps an idea to a post run', () => {
  const r = ideaToRunInput(idea);
  assert.equal(r.instruction, 'Write an in-depth LinkedIn post about: LangGraph JS 1.5: checkpointers novos no Postgres. Angle: compare with MemorySaver. Write the post in US English.');
  assert.deepEqual(r.urls, ['https://github.com/langchain-ai/langgraphjs/releases/tag/1.5', 'https://docs.langchain.com/x']);
  assert.equal(r.niche, 'ai_engineering');
  assert.equal(r.searchQuery, idea.title);
  assert.deepEqual(r.userContext, []);
  assert.equal(r.postType, 'deep');
});

test('postTypeOverride wins over the idea type', () => {
  const r = ideaToRunInput(idea, 'quick');
  assert.equal(r.postType, 'quick');
  assert.ok(r.instruction.startsWith('Write a short LinkedIn post about:'));
});

test('slug is at most 20 chars, lowercase, without a trailing hyphen', () => {
  const { slug } = ideaToRunInput(idea);
  assert.ok(slug && slug.length <= 20, slug);
  assert.match(slug!, /^[a-z0-9-]+$/);
  assert.ok(!slug!.endsWith('-'));
  assert.equal(slug, 'langgraph-js-15-chec');
});

test('topicEn (English) drives the instruction and the search; the post is requested in US English', () => {
  const r = ideaToRunInput({ ...idea, title: 'Node.js: atualizações de segurança', topicEn: 'Node.js November 2026 security releases' });
  assert.equal(r.searchQuery, 'Node.js November 2026 security releases');
  assert.ok(r.instruction.includes('about: Node.js November 2026 security releases.'));
  assert.ok(r.instruction.includes('Write the post in US English.'));
});
