import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadHistory, saveHistory, appendHistory, importOutputFolders, isDuplicate, markSuggested, titleSimilarity,
  type HistoryEntry,
} from '../src/discovery/history.ts';

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cb-history-'));
}

test('history file', async (t) => {
  await t.test('missing file loads as []', async () => {
    assert.deepEqual(await loadHistory(path.join(await tmp(), 'h.json')), []);
  });

  await t.test('save/append round-trip', async () => {
    const file = path.join(await tmp(), 'nested', 'h.json');
    await saveHistory([], file);
    await appendHistory({ date: '2026-11-13', title: 'A', kind: 'posted', urls: [] }, file);
    assert.equal((await loadHistory(file)).length, 1);
  });

  await t.test('importOutputFolders uses the first non-empty post line, or the folder name', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'output');
    await fs.mkdir(path.join(out, 'flutter-mediaquery'), { recursive: true });
    await fs.writeFile(path.join(out, 'flutter-mediaquery', 'linkedin_post.txt'), '\n\nNew MediaQuery APIs in Flutter\nmore');
    await fs.mkdir(path.join(out, 'node-di'), { recursive: true });
    await fs.writeFile(path.join(out, 'stray.png'), 'x');
    const file = path.join(dir, 'h.json');

    assert.equal(await importOutputFolders(out, file), 2);
    const titles = (await loadHistory(file)).map((e) => [e.kind, e.slug, e.title]);
    assert.deepEqual(titles.sort(), [
      ['posted', 'flutter-mediaquery', 'New MediaQuery APIs in Flutter'],
      ['posted', 'node-di', 'node di'],
    ]);
    assert.equal(await importOutputFolders(out, file), 0, 'does not import twice');
  });
});

test('dedupe', async (t) => {
  const history: HistoryEntry[] = [
    { date: '2026-11-01', title: 'New MediaQuery APIs in Flutter: sizeOf', kind: 'posted', urls: ['https://flutter.dev/mq'] },
    { date: '2026-11-02', title: 'React Compiler stable release', kind: 'suggested', urls: [], timesSuggested: 2 },
    { date: '2026-11-02', title: 'Vite 8 rolldown default', kind: 'suggested', urls: [], timesSuggested: 1 },
  ];

  await t.test('same URL is a duplicate', () => {
    assert.ok(isDuplicate({ url: 'https://flutter.dev/mq', title: 'anything' }, history));
  });

  await t.test('similar title to a posted entry is a duplicate', () => {
    assert.ok(titleSimilarity('Flutter MediaQuery sizeOf APIs', 'New MediaQuery APIs in Flutter: sizeOf') >= 0.6);
    assert.ok(isDuplicate({ title: 'Flutter MediaQuery sizeOf APIs' }, history));
  });

  await t.test('unrelated title is not a duplicate', () => {
    assert.ok(!isDuplicate({ title: 'LangGraph JS checkpointers in Postgres' }, history));
  });

  await t.test('suggested twice is a duplicate; suggested once is not', () => {
    assert.ok(isDuplicate({ title: 'React Compiler stable release' }, history));
    assert.ok(!isDuplicate({ title: 'Vite 8 rolldown default' }, history));
  });

  await t.test('markSuggested bumps a similar entry and adds a new one', () => {
    const out = markSuggested(history, [
      { title: 'Vite 8 rolldown default', niche: 'node_react', urls: [] },
      { title: 'Dart macros cancelled', niche: 'flutter_dart', urls: ['https://dart.dev/x'] },
    ], '2026-11-13');
    assert.equal(out.find((e) => e.title === 'Vite 8 rolldown default')?.timesSuggested, 2);
    const added = out.find((e) => e.title === 'Dart macros cancelled');
    assert.deepEqual(added, { date: '2026-11-13', title: 'Dart macros cancelled', kind: 'suggested', niche: 'flutter_dart', urls: ['https://dart.dev/x'], timesSuggested: 1 });
    assert.equal(history[2].timesSuggested, 1, 'input is not mutated');
  });
});
