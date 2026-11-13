import type { ILlmService } from '../../services/llmService.ts';
import type { GraphState } from '../graph.ts';
import { prompts } from '../../config.ts';
import { collectSources, type CollectDeps, type SearchMode } from '../../research/collectSources.ts';
import { FactSheetOutputSchema, verifyFacts } from '../../research/factSheet.ts';
import type { SourceDoc } from '../../research/sources.ts';
import type { PostNiche } from '../../research/officialDomains.ts';

const QUERY_FALLBACK_CHARS = 200;

function renderSources(sources: SourceDoc[]): string {
  return sources
    .map((s) => `[SOURCE ${s.id} · ${s.kind} · ${s.url ?? '-'} · ${s.publishedAt ?? '-'}]\n${s.text}`)
    .join('\n\n---\n\n');
}

/**
 * Runs ONCE per run, before the specialist: gathers the sources and builds a verified
 * FactSheet. Rewrite rounds reuse what this node stored in the state.
 */
export function createResearchNode(llm: ILlmService, deps: CollectDeps & { searchMode: SearchMode }) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    if (!state.niche || state.niche === 'out_of_scope') return {};

    const command = state.optimizedCommand || state.initialCommand;
    const searchQuery = state.searchQuery?.trim() || command.slice(0, QUERY_FALLBACK_CHARS);
    console.log(`[Research] Collecting sources (search: ${deps.searchMode}) for: "${searchQuery}"`);

    const sources = await collectSources({
      userContext: state.userContext ?? [],
      urls: state.sourceUrls ?? [],
      searchQuery,
      niche: state.niche as PostNiche,
      mode: deps.searchMode,
    }, deps);

    if (sources.length === 0) {
      console.warn('[Research] ⚠️ No sources found. The post will be marked as NOT VERIFIED.');
      return { sources, factSheet: [], researchGaps: [], researchStatus: 'no_sources' };
    }
    console.log(`[Research] ${sources.length} source(s): ${sources.map((s) => `${s.id}${s.url ? ` (${s.url})` : ''}`).join(', ')}`);

    const userPrompt = `TOPIC / INSTRUCTION:\n"""\n${command}\n"""\n\nSOURCES:\n\n${renderSources(sources)}`;
    const result = await llm.generateStructured(prompts.researcher, userPrompt, FactSheetOutputSchema);

    if (!result.success || !result.data) {
      console.warn(`[Research] ⚠️ Could not build the FactSheet: ${result.error ?? 'no data'}`);
      return { sources, factSheet: [], researchGaps: [], researchStatus: 'no_sources' };
    }

    const { kept, dropped } = verifyFacts(result.data.facts, sources);
    if (dropped.length) {
      const reasons = dropped.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.reason]: (acc[d.reason] ?? 0) + 1 }), {});
      console.warn(`[Research] Dropped ${dropped.length} fact(s): ${JSON.stringify(reasons)}`);
    }
    console.log(`[Research] FactSheet: ${kept.length} verified fact(s), ${result.data.gaps.length} gap(s).`);

    return {
      sources,
      factSheet: kept,
      researchGaps: result.data.gaps,
      researchStatus: kept.length > 0 ? 'ok' : 'no_sources',
    };
  };
}
