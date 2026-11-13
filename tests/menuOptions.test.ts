import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_MENU, ideaOptions, renderStudy, ownTopicToRunInput, stageLabel } from '../src/cli/menuOptions.ts';
import type { Idea } from '../src/discovery/rankIdeas.ts';

const idea = (n: number): Idea => ({
  title: `Idea ${n}`, niche: 'node_react', postType: 'quick', whatItIs: 'What it is', whyItMatters: 'Why',
  angle: 'The angle', studyLinks: [{ url: `https://nodejs.org/${n}`, note: 'notes' }],
});

test('MAIN_MENU has the four actions from the spec', () => {
  assert.deepEqual(MAIN_MENU.map((m) => m.label), [
    'Escrever post a partir de uma pauta da semana', 'Escrever post sobre um tema meu', 'Buscar pautas agora', 'Sair',
  ]);
});

test('ideaOptions numbers from 1 with niche · type hints', () => {
  const opts = ideaOptions({ date: '2026-11-16', ideas: [idea(1), idea(2)] });
  assert.deepEqual(opts.map((o) => o.value), [1, 2]);
  assert.equal(opts[0].label, '1. Idea 1');
  assert.equal(opts[0].hint, 'Node/React · rápido');
});

test('renderStudy shows what it is, the links and the angle', () => {
  const s = renderStudy(idea(1));
  assert.ok(s.includes('O que é'));
  assert.ok(s.includes('What it is'));
  assert.ok(s.includes('https://nodejs.org/1'));
  assert.ok(s.includes('The angle'));
});

test('ownTopicToRunInput merges URLs from the field and the instruction without duplicates', () => {
  const r = ownTopicToRunInput({
    instruction: 'Post about https://a.dev/x',
    urlsText: 'https://b.dev, https://a.dev/x  https://c.dev',
    context: ['notes'],
    postType: 'deep',
  });
  assert.deepEqual(r.urls, ['https://a.dev/x', 'https://b.dev', 'https://c.dev']);
  assert.deepEqual(r.userContext, ['notes']);
  assert.equal(r.instruction, 'Post about https://a.dev/x');
  assert.equal(r.postType, 'deep');
});

test('stageLabel describes what comes after each finished node', () => {
  assert.equal(stageLabel('orchestrator'), 'Pesquisando fontes…');
  assert.equal(stageLabel('research'), 'Escrevendo o rascunho…');
  assert.equal(stageLabel('flutterSpecialist', 0), 'Revisando (1/3)…');
  assert.equal(stageLabel('reviewer', 1), 'Revisando (2/3)…');
  assert.equal(stageLabel('reviewer'), 'Salvando o post…');
});
