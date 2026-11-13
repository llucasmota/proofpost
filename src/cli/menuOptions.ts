import { extractUrls } from '../services/webContentService.ts';
import type { IdeasFile } from '../discovery/ideasFile.ts';
import type { Idea } from '../discovery/rankIdeas.ts';
import type { PostRunInput } from '../app/runPost.ts';
import type { PostType } from './parseArgs.ts';
import { MAX_REVIEWS } from '../config.ts';

export type MainAction = 'idea' | 'own' | 'ideas' | 'exit';

export const MAIN_MENU: { value: MainAction; label: string }[] = [
  { value: 'idea', label: 'Escrever post a partir de uma pauta da semana' },
  { value: 'own', label: 'Escrever post sobre um tema meu' },
  { value: 'ideas', label: 'Buscar pautas agora' },
  { value: 'exit', label: 'Sair' },
];

const NICHE_LABEL: Record<Idea['niche'], string> = { flutter_dart: 'Flutter/Dart', node_react: 'Node/React', ai_engineering: 'IA' };
const TYPE_LABEL: Record<PostType, string> = { quick: 'rápido', deep: 'aprofundado' };

export function ideaOptions(file: IdeasFile): { value: number; label: string; hint: string }[] {
  return file.ideas.map((idea, i) => ({
    value: i + 1,
    label: `${i + 1}. ${idea.title}`,
    hint: `${NICHE_LABEL[idea.niche]} · ${TYPE_LABEL[idea.postType]}`,
  }));
}

export function renderStudy(idea: Idea): string {
  return [
    `O que é: ${idea.whatItIs}`,
    '',
    `Por que importa: ${idea.whyItMatters}`,
    '',
    'Para estudar:',
    ...idea.studyLinks.map((l) => `  • ${l.url}\n    ${l.note}`),
    '',
    `Ângulo sugerido: ${idea.angle}`,
  ].join('\n');
}

export function ownTopicToRunInput(a: { instruction: string; urlsText: string; context: string[]; postType: PostType }): PostRunInput {
  const fromField = a.urlsText.split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
  const urls = [...new Set([...extractUrls(a.instruction), ...fromField])];
  return { instruction: a.instruction.trim(), userContext: a.context, urls, postType: a.postType };
}

const SPECIALISTS = new Set(['flutterSpecialist', 'nodeReactSpecialist', 'aiSpecialist']);

/** Spinner text after a graph node finished: describes the step that comes next. */
export function stageLabel(node: string, reviewCount?: number): string {
  if (node === 'promptOptimizer') return 'Classificando o tema…';
  if (node === 'orchestrator') return 'Pesquisando fontes…';
  if (node === 'research') return 'Escrevendo o rascunho…';
  if (SPECIALISTS.has(node)) return `Revisando (${(reviewCount ?? 0) + 1}/${MAX_REVIEWS})…`;
  if (node === 'reviewer') return reviewCount === undefined ? 'Salvando o post…' : `Revisando (${reviewCount + 1}/${MAX_REVIEWS})…`;
  if (node === 'imageExtractor') return 'Concluído';
  return 'Trabalhando…';
}
