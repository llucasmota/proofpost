import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderIdeasMarkdown, writeIdeasFiles, latestIdeasFile, loadIdea, type IdeasFile } from '../src/discovery/ideasFile.ts';
import { isDuplicate, markSuggested, importOutputFolders, loadHistory, type HistoryEntry } from '../src/discovery/history.ts';
import { verifyFacts, normalizeForQuote, type Fact } from '../src/research/factSheet.ts';
import { parseCliArgs } from '../src/cli/parseArgs.ts';
import { extractUrls } from '../src/services/webContentService.ts';
import type { Idea } from '../src/discovery/rankIdeas.ts';

const idea = (t: string): Idea => ({ title: t, niche: 'node_react', postType: 'quick', whatItIs: 'w', whyItMatters: 'y', angle: 'a', studyLinks: [{ url: `https://x.dev/${t}`, note: 'n' }] });
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'cb-fix-'));

test('[I1] ideas markdown prints the command pinned to its own file', () => {
  const md = renderIdeasMarkdown({ date: '2026-11-16', ideas: [idea('a')] }, 'ideas/2026-11-16.json');
  assert.ok(md.includes('npm start -- --idea 1 --ideas-file ideas/2026-11-16.json'));
});

test('[I2] --ideas-file accepts the .md path and reads the sibling .json', async () => {
  const dir = await tmp();
  const { mdPath } = await writeIdeasFiles({ date: '2026-11-16', ideas: [idea('a'), idea('b')] }, dir);
  assert.equal((await loadIdea(2, mdPath, dir)).title, 'b');
});

test('[I3] a second run on the same day does not overwrite the first; latest is the newest', async () => {
  const dir = await tmp();
  const first = await writeIdeasFiles({ date: '2026-11-16', ideas: [idea('first')] }, dir);
  const second = await writeIdeasFiles({ date: '2026-11-16', ideas: [idea('second')] }, dir);
  assert.notEqual(first.jsonPath, second.jsonPath);
  assert.equal(JSON.parse(await fs.readFile(first.jsonPath, 'utf-8')).ideas[0].title, 'first');
  assert.equal(await latestIdeasFile(dir), second.jsonPath);
  const third = await writeIdeasFiles({ date: '2026-11-16', ideas: [idea('third')] }, dir);
  await writeIdeasFiles({ date: '2026-11-15', ideas: [idea('old')] }, dir);
  assert.equal(await latestIdeasFile(dir), third.jsonPath);
});

test('[I4] suggestions record every study URL and a URL match respects timesSuggested', () => {
  const out = markSuggested([], [{ title: 'Node 26', urls: ['https://a.dev', 'https://b.dev'], niche: 'node_react' }], '2026-11-16');
  assert.deepEqual(out[0].urls, ['https://a.dev', 'https://b.dev']);
  assert.ok(!isDuplicate({ url: 'https://b.dev', title: 'Other' }, out), 'suggested once can come back');
  const twice = markSuggested(out, [{ title: 'Node 26', urls: ['https://b.dev'], niche: 'node_react' }], '2026-11-18');
  assert.ok(isDuplicate({ url: 'https://b.dev', title: 'Other' }, twice), 'suggested twice is blocked');
  const posted: HistoryEntry[] = [{ date: 'd', title: 't', kind: 'posted', urls: ['https://p.dev'] }];
  assert.ok(isDuplicate({ url: 'https://p.dev', title: 'x' }, posted));
});

test('[I5] imported titles skip warning/banner lines', async () => {
  const dir = await tmp();
  const out = path.join(dir, 'output');
  await fs.mkdir(path.join(out, 'ts-7'), { recursive: true });
  await fs.writeFile(path.join(out, 'ts-7', 'linkedin_post.txt'),
    '⚠️ WARNING: This post did not pass all Reviewer audits.\nLast reviewer feedback: x\nVerify and correct the technical information before publishing.\n\nLast Draft:\nTypeScript 7 is native now.');
  const file = path.join(dir, 'h.json');
  await importOutputFolders(out, file);
  assert.equal((await loadHistory(file))[0].title, 'TypeScript 7 is native now.');
});

const src = [{ id: 'url-1', kind: 'user_url' as const, text: 'React 19.2 adds the **`useEffectEvent`** hook. See [the docs](https://react.dev/x) for details.' }];
const fact = (quote: string): Fact => ({ claim: 'c', sourceId: 'url-1', quote, publishedAt: '', contradictsUserSource: false });

test('[I6] quotes match markdown sources without the markup; tiny quotes are rejected', () => {
  assert.equal(verifyFacts([fact('adds the useEffectEvent hook. See the docs for details')], src).kept.length, 1);
  assert.equal(normalizeForQuote('**`x`** [t](https://u)'), 'x t');
  assert.deepEqual(verifyFacts([fact('React')], src).dropped.map((d) => d.reason), ['quote_not_found']);
});

test('[I8] a run without an instruction is rejected before any LLM call', () => {
  assert.throws(() => parseCliArgs(['--context', 'notes.md'], {}), /instrução/);
  assert.throws(() => parseCliArgs(['--context'], {}), /--context/);
});

test('[I9] extractUrls drops trailing punctuation', () => {
  assert.deepEqual(extractUrls('veja https://dart.dev/blog. e https://a.dev/x, ok (https://b.dev/y)'), ['https://dart.dev/blog', 'https://a.dev/x', 'https://b.dev/y']);
});
