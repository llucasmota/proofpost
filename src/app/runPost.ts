import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostGraph, type GraphState } from '../graph/graph.ts';
import { createRoleServices } from '../services/llmProvider.ts';
import { usageTracker } from '../services/usageTracker.ts';
import type { PostType } from '../cli/parseArgs.ts';
import type { PostNiche } from '../research/officialDomains.ts';
import type { PostRunStatus } from '../graph/nodes/imageExtractorNode.ts';
import { captureConsole } from './captureConsole.ts';
import { importOutputFolders } from '../discovery/history.ts';

export type { PostRunStatus };

export type PostRunInput = {
  instruction: string;
  userContext: string[];
  urls: string[];
  postType: PostType;
  niche?: PostNiche;
  slug?: string;
  searchQuery?: string;
};

export type PostRunResult = { outputDir: string; status: PostRunStatus; unverified: boolean; costUsd: number };

export type RunPostOptions = {
  /** Called after each graph node finishes, with that node's state update. */
  onStage?: (node: string, update: Partial<GraphState>) => void;
  /** Send logs to <outputDir>/run.log instead of the terminal (interactive menu). */
  quiet?: boolean;
};

export function initialState(input: PostRunInput): Partial<GraphState> {
  return {
    initialCommand: input.instruction,
    userContext: input.userContext,
    sourceUrls: input.urls,
    postType: input.postType,
    reviewCount: 0,
    ...(input.niche ? { niche: input.niche } : {}),
    ...(input.niche && input.slug ? { suggestedFolderSlug: input.slug } : {}),
    ...(input.searchQuery ? { searchQuery: input.searchQuery } : {}),
  };
}

/** One post, end to end. Shared by the CLI and the interactive menu. */
export async function runPost(input: PostRunInput, opts: RunPostOptions = {}): Promise<PostRunResult> {
  usageTracker.reset();
  // First run ever: seed ideas/history.json with the posts already in output/ before adding this one.
  await importOutputFolders('output').catch(() => 0);
  const tmpLog = path.join(process.cwd(), 'output', '.runs', `${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const restore = opts.quiet ? captureConsole(tmpLog, { echo: false }) : undefined;

  let last: Partial<GraphState> = {};
  try {
    const graph = buildPostGraph(createRoleServices());
    console.log(`🚀 Starting post: "${input.instruction}" (${input.postType})`);
    const stream = await graph.stream(initialState(input) as GraphState, { streamMode: ['updates', 'values'] });
    for await (const [mode, chunk] of stream as AsyncIterable<[string, any]>) {
      if (mode === 'updates') {
        for (const [node, update] of Object.entries(chunk ?? {})) opts.onStage?.(node, (update ?? {}) as Partial<GraphState>);
      } else {
        last = chunk as Partial<GraphState>;
      }
    }
    usageTracker.printSummary();
  } finally {
    restore?.();
  }

  const outputDir = last.outputDir ?? '';
  if (opts.quiet && outputDir) {
    await fs.copyFile(tmpLog, path.join(outputDir, 'run.log')).catch(() => {});
  }
  return {
    outputDir,
    status: last.runStatus ?? 'failed',
    unverified: last.researchStatus === 'no_sources',
    costUsd: usageTracker.summary().estimatedCostUsd,
  };
}
