import * as p from '@clack/prompts';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPost, type PostRunInput, type PostRunStatus } from '../app/runPost.ts';
import { ideaToRunInput } from '../app/ideaToRunInput.ts';
import { captureConsole } from '../app/captureConsole.ts';
import { latestIdeasFile, readIdeasFile } from '../discovery/ideasFile.ts';
import { runIdeasCli } from '../discovery/cli.ts';
import { UserFacingError } from './errors.ts';
import { loadContextFiles, type PostType } from './parseArgs.ts';
import { MAIN_MENU, ideaOptions, ownTopicToRunInput, renderStudy, stageLabel, type MainAction } from './menuOptions.ts';

const STATUS_LABEL: Record<PostRunStatus, string> = {
  approved: 'aprovado pelo revisor',
  not_reviewed: 'NÃO revisado (revisor indisponível)',
  review_limit: 'limite de revisões atingido — revise antes de publicar',
  failed: 'falhou — veja error_report.txt',
  out_of_scope: 'fora do escopo',
};

class Cancelled extends Error {}

/** Unwraps a clack answer; Esc/Ctrl+C goes back to the main menu. */
function answer<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) throw new Cancelled();
  return value as Exclude<T, symbol>;
}

async function choosePostType(initial: PostType): Promise<PostType> {
  return answer(await p.select<PostType>({
    message: 'Tipo do post',
    initialValue: initial,
    options: [
      { value: 'quick', label: 'Rápido', hint: '80–150 palavras, uma ideia central' },
      { value: 'deep', label: 'Aprofundado', hint: 'post técnico completo' },
    ],
  }));
}

function openEditorForContext(): string {
  const file = path.join(os.tmpdir(), `content-builder-context-${Date.now()}.md`);
  writeFileSync(file, '');
  const [cmd, ...args] = (process.env.EDITOR || 'nano').split(/\s+/);
  spawnSync(cmd, [...args, file], { stdio: 'inherit' });
  return file;
}

async function askContext(): Promise<string[]> {
  const how = answer(await p.select({
    message: 'Quer acrescentar um contexto seu (notas, trechos de artigo)?',
    options: [
      { value: 'none', label: 'Não' },
      { value: 'editor', label: 'Colar no editor', hint: process.env.EDITOR || 'nano' },
      { value: 'file', label: 'Ler de um arquivo' },
    ],
  }));
  if (how === 'none') return [];
  if (how === 'file') {
    const file = answer(await p.text({ message: 'Caminho do arquivo', placeholder: 'notas.md' }));
    return loadContextFiles([file.trim()]);
  }
  const file = openEditorForContext();
  const text = (await fs.readFile(file, 'utf-8').catch(() => '')).trim();
  await fs.rm(file, { force: true });
  if (!text) p.log.warn('Contexto vazio — seguindo sem contexto.');
  return text ? [text] : [];
}

async function generate(input: PostRunInput) {
  // Ctrl+C during a run must stop it (and its spending), not just the spinner.
  const s = p.spinner({ onCancel: () => process.exit(130) });
  s.start('Otimizando o comando…');
  let reviewCount = 0;
  try {
    const result = await runPost(input, {
      quiet: true,
      onStage: (node, update) => {
        if (typeof update.reviewCount === 'number') reviewCount = update.reviewCount;
        s.message(stageLabel(node, node === 'reviewer' ? update.reviewCount : reviewCount));
      },
    });
    s.stop(result.status === 'approved' ? 'Post pronto' : 'Run concluído');
    p.note(
      [
        `Pasta: ${result.outputDir || '(nenhuma)'}`,
        `Status: ${STATUS_LABEL[result.status]}${result.unverified ? ' · NÃO VERIFICADO (sem fontes)' : ''}`,
        `Custo estimado: ~US$ ${result.costUsd.toFixed(4)}`,
        result.outputDir ? `Log: ${path.join(result.outputDir, 'run.log')}` : '',
      ].filter(Boolean).join('\n'),
      'Resultado',
    );
    if (result.outputDir && answer(await p.confirm({ message: 'Abrir a pasta?', initialValue: true }))) {
      execFile('open', [result.outputDir]);
    }
  } catch (e) {
    s.error('Falhou — o log completo fica em output/.runs/');
    throw e;
  }
}

async function fromIdeas() {
  const file = await latestIdeasFile();
  if (!file) {
    p.log.warn('Nenhuma pauta ainda. Escolha "Buscar pautas agora".');
    return;
  }
  const ideas = await readIdeasFile(file);
  for (;;) {
    const n = answer(await p.select({
      message: `Pautas de ${ideas.date}`,
      options: [...ideaOptions(ideas), { value: 0, label: '← Voltar' }],
    }));
    if (n === 0) return;
    const idea = ideas.ideas[n - 1];
    p.note(renderStudy(idea), idea.title);
    if (!answer(await p.confirm({ message: 'Escrever o post agora?', initialValue: false }))) continue;
    await generate(ideaToRunInput(idea, await choosePostType(idea.postType)));
    return;
  }
}

async function ownTopic() {
  const instruction = answer(await p.text({
    message: 'Sobre o que é o post?',
    placeholder: 'Ex.: Explique as novas APIs de MediaQuery no Flutter',
    validate: (v) => (v && v.trim() ? undefined : 'Escreva a instrução do post.'),
  }));
  const urlsText = answer(await p.text({ message: 'URLs de referência (opcional, separadas por espaço)', placeholder: 'https://…' })) ?? '';
  const context = await askContext();
  const postType = await choosePostType('deep');
  await generate(ownTopicToRunInput({ instruction, urlsText, context, postType }));
}

async function fetchIdeas() {
  const s = p.spinner();
  s.start('Buscando pautas (feeds + busca + ranking)…');
  const restore = captureConsole(path.join('ideas', 'logs', 'menu.log'), { echo: false });
  let mdPath: string | null;
  try {
    mdPath = await runIdeasCli();
  } catch (e) {
    restore();
    s.error('Falhou ao buscar pautas (log: ideas/logs/menu.log)');
    throw e;
  }
  restore();
  s.stop(mdPath ? `Pautas salvas em ${mdPath}` : 'Nenhuma pauta nova desta vez');
}

export async function runMenu(): Promise<void> {
  p.intro('content-builder');
  for (;;) {
    let action: MainAction;
    try {
      action = answer(await p.select<MainAction>({ message: 'O que você quer fazer?', options: MAIN_MENU }));
    } catch {
      break;
    }
    if (action === 'exit') break;
    try {
      if (action === 'idea') await fromIdeas();
      else if (action === 'own') await ownTopic();
      else {
        await fetchIdeas();
        await fromIdeas();
      }
    } catch (e) {
      if (e instanceof Cancelled) continue;
      p.log.error(e instanceof UserFacingError ? e.message : e instanceof Error ? e.message : String(e));
    }
  }
  p.outro('Até a próxima!');
}
