import { StateGraph, START, END } from "@langchain/langgraph";
import { z } from "zod/v3";
import type { LlmRoles } from '../services/llmProvider.ts';

import { createPromptOptimizerNode } from './nodes/promptOptimizerNode.ts';
import { createOrchestratorNode } from './nodes/orchestratorNode.ts';
import { createFlutterNode } from './nodes/flutterNode.ts';
import { createReviewerNode } from './nodes/reviewerNode.ts';
import { createImageExtractorNode } from './nodes/imageExtractorNode.ts';
import { routeToSpecialist, routeAfterReview, routeAfterOrchestrator } from './nodes/edgeConditions.ts';
import { createResearchNode } from './nodes/researchNode.ts';
import type { CollectDeps, SearchMode } from '../research/collectSources.ts';
import { createWebResearchClient } from '../services/tavilyService.ts';
import { fetchUrlContent } from '../services/webContentService.ts';
import { researchSearchMode } from '../config.ts';
import { createNodeReactNode } from "./nodes/nodeJsReactNode.ts";
import { createAiNode } from "./nodes/aiNode.ts";
import { SourceDocSchema } from '../research/sources.ts';
import { FactSchema } from '../research/factSheet.ts';

export const PostStateAnnotation = z.object({
  initialCommand: z.string(),
  // Pasted context (inline block or --context files), kept out of the prompt optimizer.
  userContext: z.array(z.string()).optional(),
  sourceUrls: z.array(z.string()).optional(),
  postType: z.enum(['quick', 'deep']).default('deep'),
  // Short web-search query (from the orchestrator or the chosen idea).
  searchQuery: z.string().optional(),
  // Research (once per run): sources, verified facts, and what the sources do not cover.
  sources: z.array(SourceDocSchema).optional(),
  factSheet: z.array(FactSchema).optional(),
  researchGaps: z.array(z.string()).optional(),
  researchStatus: z.enum(['ok', 'no_sources']).optional(),
  optimizedCommand: z.string().optional(),
  promptOptimizationSummary: z.string().optional(),
  niche: z.enum(["flutter_dart", "node_react", "ai_engineering", "out_of_scope"]).optional(),
  suggestedFolderSlug: z.string().optional(),
  reviewerSearchQuery: z.string().optional(),
  mcpContext: z.string().optional(),
  technicalDraft: z.string().optional(),
  codeSnippets: z.array(z.string()).optional(),
  reviewFeedback: z.string().optional(),
  // Set when the reviewer could not run (all LLM providers failed). Not a rejection.
  reviewError: z.string().optional(),
  // Surgical correction fields — populated by the Reviewer on rejection
  approvedContent: z.string().optional(),     // Verbatim correct sections to preserve
  corrections: z.array(z.object({             // Structured list of wrong claims + fixes
    originalText: z.string(),
    issue: z.string(),
    suggestedReplacement: z.string(),
  })).optional(),
  finalPostText: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  reviewCount: z.number().default(0),
  // Set by the image extractor: where the post was saved and how the run ended.
  outputDir: z.string().optional(),
  runStatus: z.enum(['approved', 'not_reviewed', 'review_limit', 'failed', 'out_of_scope']).optional(),
});

export type GraphState = z.infer<typeof PostStateAnnotation>;

export type ResearchDeps = CollectDeps & { searchMode: SearchMode };

export function defaultResearchDeps(): ResearchDeps {
  return { web: createWebResearchClient(), fetchUrl: fetchUrlContent, searchMode: researchSearchMode() };
}

export function buildPostGraph(llm: LlmRoles, research: ResearchDeps = defaultResearchDeps()) {
  const graph = new StateGraph(PostStateAnnotation)
    .addNode('promptOptimizer', createPromptOptimizerNode(llm.optimizer))
    .addNode('orchestrator', createOrchestratorNode(llm.orchestrator))
    .addNode('research', createResearchNode(llm.researcher, research))
    .addNode('flutterSpecialist', createFlutterNode(llm.writer))
    .addNode('nodeReactSpecialist', createNodeReactNode(llm.writer))
    .addNode('aiSpecialist', createAiNode(llm.writer))
    .addNode('reviewer', createReviewerNode(llm.reviewer))
    .addNode('imageExtractor', createImageExtractorNode())

    .addEdge(START, 'promptOptimizer')
    .addEdge('promptOptimizer', 'orchestrator')
    .addConditionalEdges('orchestrator', routeAfterOrchestrator, {
      research: 'research',
      imageExtractor: 'imageExtractor',
    })
    .addConditionalEdges('research', routeToSpecialist, {
      flutterSpecialist: 'flutterSpecialist',
      nodeReactSpecialist: 'nodeReactSpecialist',
      aiSpecialist: 'aiSpecialist',
      imageExtractor: 'imageExtractor',
    })

    .addEdge('flutterSpecialist', 'reviewer')
    .addEdge('nodeReactSpecialist', 'reviewer')
    .addEdge('aiSpecialist', 'reviewer')

    .addConditionalEdges('reviewer', routeAfterReview, {
      imageExtractor: 'imageExtractor',
      flutterSpecialist: 'flutterSpecialist',
      nodeReactSpecialist: 'nodeReactSpecialist',
      aiSpecialist: 'aiSpecialist',
    })
    .addEdge('imageExtractor', END);

  return graph.compile();
}
