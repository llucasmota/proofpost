import type { ILlmService } from '../../services/llmService.ts';
import type { GraphState } from '../graph.ts';
import type { PostType } from '../../cli/parseArgs.ts';
import { SpecialistOutputSchema } from './schemas.ts';

export const POST_TYPE_RULES: Record<PostType, string> = {
  quick: 'POST TYPE: QUICK — 80 to 150 words, one central idea, code optional (at most one short snippet).',
  deep: 'POST TYPE: DEEP — full technical post as usual.',
};

const SOURCE_CHARS_FOR_WRITER = 8_000;

export const FACT_SHEET_RULE =
  'Specific technical claims (versions, flags, API names, numbers) are allowed ONLY if they appear in [FACT_SHEET]. ' +
  'Everything else must read as opinion or experience, not as a fact about the technology.';

export function renderFactSheet(state: GraphState): string {
  const byId = new Map((state.sources ?? []).map((s) => [s.id, s]));
  return (state.factSheet ?? [])
    .map((f, i) => {
      const url = byId.get(f.sourceId)?.url ?? '-';
      return `F${i + 1} [${f.sourceId} · ${url} · ${f.publishedAt || '-'}] ${f.claim} — "${f.quote}"`;
    })
    .join('\n');
}

function renderSurgicalBlock(state: GraphState): string {
  if (!(state.reviewCount > 0 && state.reviewFeedback)) return '';
  const hasSurgical = state.approvedContent || (state.corrections && state.corrections.length > 0);
  if (!hasSurgical) return `[REVIEW FEEDBACK — FULL REWRITE NEEDED]:\n"${state.reviewFeedback}"\n\n`;

  const corrections = state.corrections && state.corrections.length > 0
    ? state.corrections.map((c, i) =>
      `Fix #${i + 1}:\n  - ORIGINAL (wrong): "${c.originalText}"\n  - ISSUE: ${c.issue}\n  - REPLACE WITH: ${c.suggestedReplacement || '(delete this claim entirely)'}`,
    ).join('\n\n')
    : '(no specific corrections listed — use the general feedback below)';

  return `[SURGICAL CORRECTION MODE — Attempt ${state.reviewCount + 1}]:
The reviewer has identified SPECIFIC errors in the previous draft. Your task is to:
1. Preserve ALL of the [APPROVED CONTENT] below VERBATIM — do not alter a single word, punctuation mark, or line break.
2. Apply ONLY the corrections listed in [CORRECTIONS NEEDED] — nothing more.
3. Reassemble the final complete draft by integrating the corrections into the approved content.
4. Do NOT introduce any new claims, examples, or code snippets beyond what is in the approved content + corrections.

[APPROVED CONTENT — COPY VERBATIM, NO CHANGES]:
${state.approvedContent || '(none — the reviewer did not identify any fully correct sections)'}

[CORRECTIONS NEEDED — APPLY THESE SURGICAL FIXES]:
${corrections}

[GENERAL FEEDBACK FOR CONTEXT]:
"${state.reviewFeedback}"

`;
}

/** One prompt builder for every specialist: topic, post type, FactSheet, sources and corrections. */
export function buildSpecialistUserPrompt(state: GraphState): string {
  const topic = state.optimizedCommand || state.initialCommand;
  let prompt = `Topic:\n"${topic}"\n\n${POST_TYPE_RULES[state.postType ?? 'deep']}\n\n`;

  const facts = renderFactSheet(state);
  if (state.researchStatus === 'ok' && facts) {
    prompt += `[FACT_SHEET] (verified facts with verbatim quotes — the ground truth for this post):\n${facts}\n\nRULE: ${FACT_SHEET_RULE}\n\n`;
  } else {
    prompt += `[NO_SOURCES]: No verified source is available for this topic. Avoid specific versions, flags, numbers and dates you cannot confirm; prefer concepts and experience. The post will be flagged as NOT VERIFIED.\n\n`;
  }

  if (state.researchGaps && state.researchGaps.length > 0) {
    prompt += `[GAPS] (the sources do NOT cover these — do not make claims about them):\n${state.researchGaps.map((g) => `- ${g}`).join('\n')}\n\n`;
  }

  if (state.sources && state.sources.length > 0) {
    const rendered = state.sources
      .map((s) => `[${s.id} · ${s.kind}${s.url ? ` · ${s.url}` : ''}]\n${s.text.slice(0, SOURCE_CHARS_FOR_WRITER)}`)
      .join('\n\n---\n\n');
    prompt += `[SOURCES] (context for tone and detail; [FACT_SHEET] wins on facts):\n${rendered}\n\n`;
  }

  if (state.mcpContext) prompt += `[MCP Data]:\n${state.mcpContext}\n\n`;

  return prompt + renderSurgicalBlock(state);
}

export function createSpecialistNode(llm: ILlmService, systemPrompt: string, label: string) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log(`[${label}] Generating draft (${state.postType ?? 'deep'}, research: ${state.researchStatus ?? 'none'})...`);
    const result = await llm.generateStructured(systemPrompt, buildSpecialistUserPrompt(state), SpecialistOutputSchema);
    if (!result.success || !result.data) throw new Error(`[${label}] Failed to generate the draft — ${result.error ?? 'no data'}`);
    return { technicalDraft: result.data.technicalDraft, codeSnippets: result.data.codeSnippets };
  };
}
