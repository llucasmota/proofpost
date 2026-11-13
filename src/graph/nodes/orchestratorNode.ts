import type { Runtime } from '@langchain/langgraph';
import type { ILlmService } from '../../services/llmService.ts';
import type { GraphState } from '../graph.ts';
import { OrchestratorOutputSchema } from './schemas.ts';
import { prompts } from '../../config.ts';

export function createOrchestratorNode(llmClient: ILlmService) {
  return async (state: GraphState, runtime?: Runtime): Promise<Partial<GraphState>> => {
    if (state.niche && state.suggestedFolderSlug) {
      // Chosen idea (--idea): niche and slug come with it; reclassifying could mark it out_of_scope.
      console.log(`\n[Orchestrator] Using preset niche "${state.niche}" (slug: ${state.suggestedFolderSlug}).`);
      return {};
    }
    const effectiveCommand = state.optimizedCommand || state.initialCommand;
    console.log(`\n[Orchestrator] Analyzing: "${effectiveCommand}"`);

    const systemPrompt = prompts.orchestrator;
    const userPrompt = `Classify this request:\n\n"${effectiveCommand}"`;

    const result = await llmClient.generateStructured(systemPrompt, userPrompt, OrchestratorOutputSchema);

    if (!result.success || !result.data) {
      // Do not guess a niche: routing a Flutter post to the Node specialist silently produces
      // a wrong post. Every provider in the fallback chain already failed at this point.
      throw new Error(`[Orchestrator] Could not classify the command — ${result.error ?? 'no data'}`);
    }

    console.log(`[Orchestrator] Niche: ${result.data.niche} | Suggested Slug: ${result.data.suggestedFolderSlug} | Reason: ${result.data.reasoning}`);
    return {
      niche: result.data.niche,
      suggestedFolderSlug: result.data.suggestedFolderSlug,
      searchQuery: state.searchQuery || result.data.searchQuery,
    };
  };
}
