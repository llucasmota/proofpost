import type { Runtime } from '@langchain/langgraph';
import type { ILlmService } from '../../services/llmService.ts';
import type { GraphState } from '../graph.ts';
import { ReviewerOutputSchema } from './schemas.ts';
import { MAX_REVIEWS, prompts } from '../../config.ts';
import { POST_TYPE_RULES, renderFactSheet } from './specialistNode.ts';

export const REVIEWER_FACT_RULE =
  'Reject any specific technical claim that is not supported by [FACT_SHEET] (versions, dates, API names, flags, numbers). ' +
  'A claim supported by [FACT_SHEET] is VALID even if it postdates or contradicts your training data.';

export function buildReviewerUserPrompt(state: GraphState, today = new Date().toISOString().split('T')[0]): string {
  const effectiveCommand = state.optimizedCommand || state.initialCommand;
  let userPrompt = `CONTEXT FOR THIS REVIEW:
Today's date is ${today}. The specialist may have written about topics that are more recent than your training data cutoff. This is expected and valid.

---
USER COMMAND & CONSTRAINTS:
"""
${effectiveCommand}
"""

${POST_TYPE_RULES[state.postType ?? 'deep']}

---
DRAFT TO REVIEW:
${state.technicalDraft}`;

  if (state.codeSnippets && state.codeSnippets.length > 0) {
    userPrompt += `\n\n---
CODE SNIPPETS PRODUCED BY SPECIALIST (check syntax & user language compliance):
${state.codeSnippets.map((s, i) => `[Snippet ${i + 1}]:\n${s}`).join('\n\n')}

PLACEHOLDER RULE: the draft has ${state.codeSnippets.length} code snippet(s). In postText, write [IMAGE_CODE_N] where Snippet N belongs (N = the snippet number above), once per snippet that adds value. The sentence before each placeholder must describe what THAT snippet shows. Do not drop a placeholder silently: if a snippet is redundant or wrong, reject the draft and say so in corrections.`;
  }

  const facts = renderFactSheet(state);
  if (state.researchStatus === 'ok' && facts) {
    // Same FactSheet the writer used: the reviewer checks the draft against it, not against memory.
    userPrompt += `\n\n---
[FACT_SHEET] (verified facts with verbatim quotes from real sources — the ground truth for fact-checking):
${facts}

RULE: ${REVIEWER_FACT_RULE}`;
  } else {
    userPrompt += `\n\n---
NO-FACTS MODE: no verified source was found for this topic. Do NOT reject claims for lacking a source. Review only style, format and evident technical errors (things you are sure are wrong). The post will be published flagged as NOT VERIFIED.`;
  }
  return userPrompt;
}

export function createReviewerNode(llmClient: ILlmService) {
  return async (state: GraphState, runtime?: Runtime): Promise<Partial<GraphState>> => {
    console.log(`[Reviewer] Auditing draft (Attempt ${state.reviewCount + 1}/${MAX_REVIEWS})...`);

    const systemPrompt = prompts.reviewer;
    const userPrompt = buildReviewerUserPrompt(state);
    const result = await llmClient.generateStructured(systemPrompt, userPrompt, ReviewerOutputSchema);

    if (!result.success || !result.data) {
      // A technical failure is NOT a rejection: do not send the draft back for a rewrite.
      console.warn(`[Reviewer] Could not review the draft: ${result.error || 'no data'}`);
      return { reviewError: result.error || 'Reviewer returned no data' };
    }

    if (!result.data.isApproved) {
      console.log(`[Reviewer] Rejected. Reason: ${result.data.feedback} | Surgical corrections: ${result.data.corrections?.length ?? 0} | Approved content preserved: ${result.data.approvedContent ? 'yes' : 'no'} | Suggested RAG Query: ${result.data.reviewerSearchQuery}`);
      return {
        reviewError: '',
        // A rejection with an empty feedback would otherwise be routed as an approval.
        reviewFeedback: result.data.feedback?.trim() || 'Rejected by the reviewer without a summary; see corrections.',
        reviewerSearchQuery: result.data.reviewerSearchQuery,
        // Always overwrite (never leave undefined) so corrections from a previous round
        // cannot leak into the next one.
        approvedContent: result.data.approvedContent ?? '',
        corrections: result.data.corrections ?? [],
        reviewCount: state.reviewCount + 1,
      };
    }

    console.log("[Reviewer] Draft Approved!");
    return {
      reviewError: '',
      reviewFeedback: "",
      reviewerSearchQuery: "",
      approvedContent: '',
      corrections: [],
      finalPostText: result.data.postText,
      hashtags: result.data.hashtags,
    };
  };
}
