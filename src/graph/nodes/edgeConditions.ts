import type { GraphState } from '../graph.ts';
import { MAX_REVIEWS } from '../../config.ts';

export const routeToSpecialist = (state: GraphState): string => {
  if (!state.niche) throw new Error('[Router] No niche set by the orchestrator.');

  const routes: Record<string, string> = {
    flutter_dart: 'flutterSpecialist',
    node_react: 'nodeReactSpecialist',
    ai_engineering: 'aiSpecialist',
    out_of_scope: 'imageExtractor',
  };

  const route = routes[state.niche];
  if (!route) throw new Error(`[Router] Unknown niche "${state.niche}".`);
  return route;
};

/** After classification: research everything in scope, skip straight to the report otherwise. */
export const routeAfterOrchestrator = (state: GraphState): 'research' | 'imageExtractor' =>
  state.niche === 'out_of_scope' ? 'imageExtractor' : 'research';

export const routeAfterReview = (state: GraphState): string => {
  if (state.reviewError) {
    // The reviewer could not run. Re-running the specialist would rewrite a draft nobody
    // judged; stop and save the draft flagged as "not reviewed" instead.
    console.warn(`⚠️ Reviewer unavailable (${state.reviewError}). Saving the draft as NOT REVIEWED.`);
    return 'imageExtractor';
  }
  if (!state.reviewFeedback || state.reviewFeedback.trim() === "") {
    return 'imageExtractor';
  }
  if (state.reviewCount >= MAX_REVIEWS) {
    console.warn("⚠️ Review limit reached. Proceeding to extraction.");
    return 'imageExtractor';
  }
  return routeToSpecialist(state);
};
