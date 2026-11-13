import fs from 'node:fs/promises';
import path from 'node:path';
import { UserFacingError } from '../cli/errors.ts';
import type { Idea } from './rankIdeas.ts';

export type IdeasFile = { date: string; ideas: Idea[] };

export const IDEAS_DIR = 'ideas';
/** 2026-11-16.json, or 2026-11-16-2.json for a second run on the same day. */
const DATED_JSON = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.json$/;

function datedKey(name: string): [string, number] | null {
  const m = DATED_JSON.exec(name);
  return m ? [m[1], m[2] ? Number(m[2]) : 1] : null;
}
const NICHE_LABEL: Record<Idea['niche'], string> = { flutter_dart: 'Flutter/Dart', node_react: 'Node/React', ai_engineering: 'IA' };
const TYPE_LABEL: Record<Idea['postType'], string> = { quick: 'rápido', deep: 'aprofundado' };

export function renderIdeasMarkdown(file: IdeasFile, jsonPath?: string): string {
  const parts = [`# Pautas — ${file.date}`, ''];
  file.ideas.forEach((idea, i) => {
    const n = i + 1;
    parts.push(
      `## ${n}. ${idea.title}`,
      `*${NICHE_LABEL[idea.niche]} · ${TYPE_LABEL[idea.postType]}*`,
      '',
      `**O que é:** ${idea.whatItIs}`,
      '',
      `**Por que importa:** ${idea.whyItMatters}`,
      '',
      '**Para estudar:**',
      ...idea.studyLinks.map((l) => `- ${l.url} — ${l.note}`),
      '',
      `**Ângulo sugerido:** ${idea.angle}`,
      '',
      '```bash',
      `npm start -- --idea ${n}${jsonPath ? ` --ideas-file ${jsonPath}` : ''}`,
      '```',
      '',
    );
  });
  return parts.join('\n');
}

export async function writeIdeasFiles(file: IdeasFile, dir = IDEAS_DIR): Promise<{ mdPath: string; jsonPath: string }> {
  await fs.mkdir(dir, { recursive: true });
  // Never overwrite an earlier run of the same day: its ideas are already in the history.
  let base = file.date;
  for (let n = 2; await fs.access(path.join(dir, `${base}.json`)).then(() => true, () => false); n++) base = `${file.date}-${n}`;
  const mdPath = path.join(dir, `${base}.md`);
  const jsonPath = path.join(dir, `${base}.json`);
  await fs.writeFile(mdPath, renderIdeasMarkdown(file, jsonPath), 'utf-8');
  await fs.writeFile(jsonPath, JSON.stringify(file, null, 2), 'utf-8');
  return { mdPath, jsonPath };
}

export async function latestIdeasFile(dir = IDEAS_DIR): Promise<string | null> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const dated = names.map((n) => ({ n, key: datedKey(n) })).filter((x): x is { n: string; key: [string, number] } => x.key !== null);
  dated.sort((a, b) => a.key[0].localeCompare(b.key[0]) || a.key[1] - b.key[1]);
  const latest = dated.at(-1)?.n;
  return latest ? path.join(dir, latest) : null;
}

export async function readIdeasFile(file: string): Promise<IdeasFile> {
  // The user reads the .md; the data lives in the sibling .json.
  const target = file.endsWith('.md') ? file.replace(/\.md$/, '.json') : file;
  let raw: string;
  try {
    raw = await fs.readFile(target, 'utf-8');
  } catch {
    throw new UserFacingError(`Arquivo de ideias não encontrado: ${target}`);
  }
  try {
    return JSON.parse(raw) as IdeasFile;
  } catch {
    throw new UserFacingError(`Arquivo de ideias inválido (não é JSON): ${target}`);
  }
}

/** n is 1-based, as printed in the ideas file. */
export async function loadIdea(n: number, file?: string, dir = IDEAS_DIR): Promise<Idea> {
  const target = file ?? (await latestIdeasFile(dir));
  if (!target) throw new UserFacingError('Nenhum arquivo de ideias encontrado — rode npm run ideas');
  const { ideas } = await readIdeasFile(target);
  if (!ideas?.length) throw new UserFacingError(`O arquivo ${target} não tem pautas.`);
  if (n < 1 || n > ideas.length) {
    throw new UserFacingError(`Pauta ${n} não existe em ${target}: escolha um número entre 1 e ${ideas.length}.`);
  }
  return ideas[n - 1];
}
