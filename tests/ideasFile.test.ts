import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderIdeasMarkdown, writeIdeasFiles, loadIdea, latestIdeasFile, type IdeasFile } from '../src/discovery/ideasFile.ts';
import type { Idea } from '../src/discovery/rankIdeas.ts';

const idea = (n: number): Idea => ({
  title: `Idea ${n}`, niche: 'flutter_dart', postType: n % 2 ? 'quick' : 'deep', whatItIs: `what ${n}`, whyItMatters: `why ${n}`,
  angle: `angle ${n}`, studyLinks: [{ url: `https://flutter.dev/${n}`, note: `note ${n}` }],
});
const file = (count: number, date = '2026-11-16'): IdeasFile => ({ date, ideas: Array.from({ length: count }, (_, i) => idea(i + 1)) });

test('renderIdeasMarkdown has numbered ideas, study links and the ready command', () => {
  const md = renderIdeasMarkdown(file(2));
  assert.ok(md.includes('## 1. Idea 1'));
  assert.ok(md.includes('npm start -- --idea 1'));
  assert.ok(md.includes('Para estudar'));
  assert.ok(md.includes('https://flutter.dev/2'));
  assert.ok(md.includes('O que é'));
  assert.ok(md.includes('Ângulo sugerido'));
});

test('loadIdea / latestIdeasFile', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-ideas-'));
  await writeIdeasFiles(file(3, '2026-11-09'), dir);
  const { jsonPath, mdPath } = await writeIdeasFiles(file(5, '2026-11-16'), dir);
  await fs.writeFile(path.join(dir, 'history.json'), '[]');

  await t.test('writes md and json named by date', () => {
    assert.ok(mdPath.endsWith('2026-11-16.md'));
    assert.ok(jsonPath.endsWith('2026-11-16.json'));
  });

  await t.test('latest file is the newest dated json (not history.json)', async () => {
    assert.equal(await latestIdeasFile(dir), path.join(dir, '2026-11-16.json'));
  });

  await t.test('loadIdea(2) reads the second idea of the latest file', async () => {
    assert.equal((await loadIdea(2, undefined, dir)).title, 'Idea 2');
  });

  await t.test('explicit file is honored', async () => {
    assert.equal((await loadIdea(3, path.join(dir, '2026-11-09.json'), dir)).title, 'Idea 3');
  });

  await t.test('out of range names the valid range', async () => {
    await assert.rejects(loadIdea(9, undefined, dir), /1 e 5/);
  });

  await t.test('no ideas file tells the user to run npm run ideas', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-ideas-empty-'));
    await assert.rejects(loadIdea(1, undefined, empty), /Nenhum arquivo de ideias encontrado — rode npm run ideas/);
  });
});
