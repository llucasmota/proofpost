import fs from 'node:fs/promises';
import { extractUrls } from '../services/webContentService.ts';
import { UserFacingError } from './errors.ts';

export type PostType = 'quick' | 'deep';

export type CliArgs =
  | { mode: 'interactive' }
  | { mode: 'post'; instruction: string; userContext: string[]; contextFiles: string[]; urls: string[]; postType: PostType }
  | { mode: 'idea'; ideaNumber: number; ideasFile?: string; postType?: PostType };

/** A line containing only "CONTEXTO:" / "CONTEXT:" separates the instruction from pasted context. */
const CONTEXT_SEPARATOR = /^\s*(CONTEXTO|CONTEXT)\s*:\s*$/im;

function parseIdeaNumber(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) {
    throw new UserFacingError(`--idea precisa de um número de pauta (ex.: --idea 3). Recebido: "${raw ?? ''}"`);
  }
  return n;
}

export function parseCliArgs(argv: string[], env: Record<string, string | undefined> = process.env): CliArgs {
  const positional: string[] = [];
  const contextFiles: string[] = [];
  let idea: number | undefined;
  let ideasFile: string | undefined;
  let quick = env.npm_config_quick === 'true';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--context') {
      const file = argv[++i];
      if (!file) throw new UserFacingError('--context precisa do caminho de um arquivo (ex.: --context notas.md).');
      contextFiles.push(file);
    }
    else if (arg === '--idea') idea = parseIdeaNumber(argv[++i]);
    else if (arg === '--ideas-file') ideasFile = argv[++i];
    else if (arg === '--quick') quick = true;
    else positional.push(arg);
  }

  // `npm start --idea 3` (without "--"): npm eats the flag, sets npm_config_idea=true and
  // passes "3" as a positional argument.
  if (idea === undefined && env.npm_config_idea) {
    const fromEnv = env.npm_config_idea === 'true' ? positional.shift() : env.npm_config_idea;
    idea = parseIdeaNumber(fromEnv);
  }

  if (idea !== undefined) {
    return {
      mode: 'idea',
      ideaNumber: idea,
      ...(ideasFile ? { ideasFile } : {}),
      ...(quick ? { postType: 'quick' as const } : {}),
    };
  }

  if (positional.length === 0 && contextFiles.length === 0) return { mode: 'interactive' };

  const raw = positional.join(' ');
  const match = CONTEXT_SEPARATOR.exec(raw);
  const instruction = (match ? raw.slice(0, match.index) : raw).trim();
  const inlineContext = match ? raw.slice(match.index + match[0].length).trim() : '';

  if (!instruction) {
    throw new UserFacingError('Falta a instrução do post (ex.: npm start -- "Explique X" --context notas.md).');
  }

  return {
    mode: 'post',
    instruction,
    userContext: inlineContext ? [inlineContext] : [],
    contextFiles,
    urls: extractUrls(instruction),
    postType: quick ? 'quick' : 'deep',
  };
}

export async function loadContextFiles(paths: string[]): Promise<string[]> {
  const texts: string[] = [];
  for (const p of paths) {
    try {
      const text = (await fs.readFile(p, 'utf-8')).trim();
      if (text) texts.push(text);
    } catch {
      throw new UserFacingError(`Arquivo de contexto não encontrado: ${p}`);
    }
  }
  return texts;
}
