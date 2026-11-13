import fs from 'fs/promises';
import path from 'path';
import type { Runtime } from '@langchain/langgraph';
import type { GraphState } from '../graph.ts';
import { MAX_REVIEWS } from '../../config.ts';
import { usageTracker } from '../../services/usageTracker.ts';
import { reconcileSnippets } from '../snippetPlaceholders.ts';
import { appendHistory } from '../../discovery/history.ts';
import type { SourceDoc } from '../../research/sources.ts';
import type { Fact } from '../../research/factSheet.ts';

const MIN_USABLE_DRAFT_CHARS = 100;

/**
 * Cleans a snippet produced by the LLM:
 * - strips a leading [CODE_SNIPPET_N]: label the model sometimes prepends;
 * - unescapes \\n / \\t / \\" ONLY when the whole snippet was double-escaped (no real line
 *   breaks). Doing it unconditionally corrupted code containing string literals like "a\\nb".
 */
export function normalizeSnippet(raw: string): string {
  let code = raw.replace(/^\[CODE_SNIPPET_\d+\]:?\s*/i, '');
  const doubleEscaped = !code.includes('\n') && code.includes('\\n');
  if (doubleEscaped) {
    code = code.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  }
  return code;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function getExtension(niche?: string, code?: string): string {
  if (niche === 'flutter_dart') return 'dart';
  if (niche === 'ai_engineering' && code) {
    const isPython = /\b(def|elif|from\s+[\w.]+\s+import|lambda|print\(|None|True|False)\b/.test(code) || /:\s*$/.test(code);
    const isTypeScript = /\b(const|let|var|interface|type|export|import\s+type|console\.\w+)\b/.test(code) || /from\s+['"]@?[\w./-]+['"]/.test(code);

    if (isPython && !isTypeScript) return 'py';
    return 'ts';
  }
  return 'ts';
}

export const UNVERIFIED_WARNING = '⚠️ NÃO VERIFICADO: nenhuma fonte encontrada. Confira as informações técnicas antes de publicar.';

export type PostRunStatus = 'approved' | 'not_reviewed' | 'review_limit' | 'failed' | 'out_of_scope';

/** sources.md: what the post was based on (sources, verified facts with quotes, gaps). */
export function renderSourcesMarkdown(sources: SourceDoc[], facts: Fact[], gaps: string[]): string {
  if (sources.length === 0) return '# Fontes\n\nNenhuma fonte encontrada — o post foi escrito sem verificação.\n';
  const lines = ['# Fontes', ''];
  for (const s of sources) {
    lines.push(`- **${s.id}** (${s.kind})${s.url ? ` ${s.url}` : ''}${s.publishedAt ? ` · ${s.publishedAt}` : ''}${s.title ? ` — ${s.title}` : ''}`);
  }
  lines.push('', '# Fatos verificados', '');
  if (facts.length === 0) lines.push('Nenhum fato verificado.');
  facts.forEach((f, i) => lines.push(`${i + 1}. ${f.claim}`, `   > "${f.quote}" — ${f.sourceId}${f.publishedAt ? ` (${f.publishedAt})` : ''}`));
  if (gaps.length) {
    lines.push('', '# Lacunas (não cobertas pelas fontes)', '', ...gaps.map((g) => `- ${g}`));
  }
  return lines.join('\n') + '\n';
}

/**
 * Text of linkedin_post.txt and the run status. `body` is the post/draft after placeholder
 * reconciliation. An empty text means there was nothing usable to save.
 */
export function buildPostFileText(state: GraphState, body: string): { text: string; status: PostRunStatus } {
  const unverified = state.researchStatus === 'no_sources' ? `${UNVERIFIED_WARNING}\n\n` : '';
  if (state.finalPostText) {
    const hashtags = state.hashtags?.length ? `\n\n${state.hashtags.join(' ')}` : '';
    return { text: `${unverified}${body}${hashtags}`, status: 'approved' };
  }
  const draft = state.technicalDraft?.trim() ?? '';
  if (draft.length < MIN_USABLE_DRAFT_CHARS) return { text: '', status: 'failed' };

  const reason = state.reviewError
    ? `⚠️ WARNING: This post was NOT REVIEWED — the reviewer could not run (${state.reviewError}).\n`
    : `⚠️ WARNING: This post did not pass all Reviewer audits (limit of ${MAX_REVIEWS} reviews reached).\n` +
      (state.reviewFeedback ? `Last reviewer feedback: ${state.reviewFeedback}\n` : '');
  return {
    text: `${unverified}${reason}Verify and correct the technical information before publishing.\n\nLast Draft:\n${body}`,
    status: state.reviewError ? 'not_reviewed' : 'review_limit',
  };
}

export function createImageExtractorNode() {
  return async (state: GraphState, runtime?: Runtime): Promise<Partial<GraphState>> => {
    console.log("\n[Image Extractor] Preparing final package...");
    console.log("[Image Extractor] Snippets in state:", JSON.stringify(state.codeSnippets, null, 2));
    
    let folderName = state.suggestedFolderSlug ? slugify(state.suggestedFolderSlug) : slugify(state.initialCommand || 'generated-post');
    if (folderName.length > 20) {
      folderName = folderName.substring(0, 20).replace(/-+$/, '');
    }
    const outputDir = path.join(process.cwd(), 'output', folderName);
    await fs.mkdir(outputDir, { recursive: true });

    // Token usage + estimated cost of this run, next to the post.
    await fs.writeFile(path.join(outputDir, 'usage.json'), JSON.stringify(usageTracker.summary(), null, 2), 'utf-8');

    if (state.niche === 'out_of_scope') {
      console.warn("[Image Extractor] Command classified as OUT OF SCOPE.");
      const textPath = path.join(outputDir, 'error_report.txt');
      const errorMsg = `The provided command is out of the technical scope supported by this application.
Received command: "${state.initialCommand}"
Classified niche: "out_of_scope"
Valid niche names: "flutter_dart", "node_react", "ai_engineering".`;
      await fs.writeFile(textPath, errorMsg, 'utf-8');
      console.log(`[+] Error report saved to: ${textPath}`);
      console.log("\n✅ Process finished! Check the /output directory.\n");
      return { reviewCount: 0, outputDir, runStatus: 'out_of_scope' };
    }

    await fs.writeFile(
      path.join(outputDir, 'sources.md'),
      renderSourcesMarkdown(state.sources ?? [], state.factSheet ?? [], state.researchGaps ?? []),
      'utf-8',
    );

    const draft = state.technicalDraft?.trim() ?? '';
    // Post body that will be saved (approved post, or the last draft) and the snippets it
    // actually references, renumbered so [IMAGE_CODE_N] ↔ snippet_N always match.
    const body = state.finalPostText || draft;
    const snippets = reconcileSnippets(body, state.codeSnippets ?? []);
    if (snippets.unused.length) {
      console.warn(`[Image Extractor] ${snippets.unused.length} snippet(s) not referenced by the post; saved as unused_snippet_N (no image).`);
    }
    if (snippets.missing.length) {
      console.warn(`[Image Extractor] Removed placeholder(s) without code: ${snippets.missing.map((n) => `#${n}`).join(', ')}.`);
    }

    const postFile = buildPostFileText(state, snippets.text);
    if (postFile.text) {
      const textPath = path.join(outputDir, 'linkedin_post.txt');
      await fs.writeFile(textPath, postFile.text, 'utf-8');
      console.log(`[+] ${postFile.status === 'approved' ? 'Post text' : 'Draft for manual review'} saved: ${textPath}`);
      // History feeds the topic suggestions (avoid suggesting what was already posted).
      await appendHistory({
        date: new Date().toISOString().slice(0, 10),
        title: state.searchQuery || state.initialCommand,
        kind: 'posted',
        slug: folderName,
        niche: state.niche,
        urls: (state.sources ?? []).map((src) => src.url).filter((u): u is string => !!u),
      }).catch((e) => console.warn(`[Image Extractor] Could not update ideas/history.json: ${e}`));
    } else {
      // No usable content at all: write an error report instead of an empty/garbage post.
      console.error('[Image Extractor] ❌ CRITICAL FAILURE: no usable draft was produced.');
      const errorPath = path.join(outputDir, 'error_report.txt');
      const errorMsg = `❌ CRITICAL FAILURE: The AI could not produce a usable draft.\n\n` +
        (state.reviewError ? `Reviewer error: ${state.reviewError}\n` : '') +
        (state.reviewFeedback ? `Last reviewer feedback: ${state.reviewFeedback}\n` : '') +
        `\nThis usually means:\n` +
        `- The topic involves a recent release/announcement outside the model's training cutoff.\n` +
        `- The model hallucinated about the existence or non-existence of features.\n\n` +
        `Original command: "${state.initialCommand}"\n\n` +
        `Action required: Verify the topic against the official source and retry, or provide more context (e.g., paste the article content directly into the command).`;
      await fs.writeFile(errorPath, errorMsg, 'utf-8');
      console.log(`[+] Error report saved: ${errorPath}`);
      console.log('\n✅ Process finished with errors. Check error_report.txt.\n');
      return { reviewCount: 0, outputDir, runStatus: 'failed' };
    }

    for (let i = 0; i < snippets.unused.length; i++) {
      const code = normalizeSnippet(snippets.unused[i]);
      const unusedPath = path.join(outputDir, `unused_snippet_${i + 1}.${getExtension(state.niche, code)}`);
      await fs.writeFile(unusedPath, code, 'utf-8');
    }

    if (snippets.used.length > 0) {
      for (let i = 0; i < snippets.used.length; i++) {
        const codeContent = normalizeSnippet(snippets.used[i]);
        const ext = getExtension(state.niche, codeContent);
        
        // Save the original source code as text
        const codePath = path.join(outputDir, `snippet_${i + 1}.${ext}`);
        await fs.writeFile(codePath, codeContent, 'utf-8');
        console.log(`[+] Source code saved: ${codePath}`);

        if (!codeContent.trim()) {
          console.warn(`[-] Snippet ${i + 1} code content is empty (raw placeholder was passed). Skipping Carbonara image generation.`);
          continue;
        }

        const payload = {
          code: codeContent,
          backgroundColor: "rgba(171, 184, 195, 1)",
          theme: "dracula",
          windowTheme: "mac",
          dropShadow: true,
          paddingVertical: "56px",
          paddingHorizontal: "56px"
        };

        console.log(`[Carbonara API] Sending request for snippet ${i + 1} (${codeContent.length} chars). Preview: "${codeContent.substring(0, 60).replace(/\n/g, ' ')}..."`);

        try {
          const response = await fetch('https://carbonara.solopov.dev/api/cook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const imgPath = path.join(outputDir, `snippet_${i + 1}.png`);
            await fs.writeFile(imgPath, Buffer.from(buffer));
            console.log(`[+] Code image saved: ${imgPath}`);
          } else {
            const responseBody = await response.text().catch(() => 'Unable to read response body');
            console.warn(`[-] HTTP error from Carbonara API for snippet ${i + 1}: ${response.status} ${response.statusText}`);
            console.warn(`[-] Carbonara API Error Response Body:\n${responseBody}`);
            console.warn(`[-] Sent Payload:`, JSON.stringify(payload, null, 2));
          }
        } catch (e) {
          console.error(`[-] Network/Fetch error generating Carbonara image for snippet ${i + 1}:`, e);
        }
      }
    }
    console.log("\n✅ Process finished! Check the /output directory.\n");
    return { reviewCount: 0, outputDir, runStatus: postFile.status };
  };
}
