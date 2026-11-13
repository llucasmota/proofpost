/**
 * Code placeholders in a post: the writer uses [CODE_SNIPPET_N], the reviewer turns them into
 * [IMAGE_CODE_N]. Both point to codeSnippets[N - 1].
 */
const PLACEHOLDER = /\[(?:IMAGE_CODE|CODE_SNIPPET)_(\d+)\]/g;

/** 1-based snippet indexes referenced by the text, in order of first appearance. */
export function placeholderIndexes(text: string): number[] {
  const seen: number[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

export type ReconciledSnippets = {
  /** Post text whose placeholders are exactly [IMAGE_CODE_1..used.length], in order. */
  text: string;
  /** Snippets referenced by the post; used[i] is the image for [IMAGE_CODE_{i+1}]. */
  used: string[];
  /** Snippets the writer produced but the final post does not reference. */
  unused: string[];
  /** Original indexes referenced by the text that have no (non-empty) snippet; removed from the text. */
  missing: number[];
};

/**
 * Makes the post text and the snippet list agree. The reviewer may rewrite the post and drop or
 * reorder placeholders; without this, files snippet_N.png no longer match [IMAGE_CODE_N].
 */
export function reconcileSnippets(text: string, snippets: string[]): ReconciledSnippets {
  const exists = (n: number) => (snippets[n - 1] ?? '').trim().length > 0;
  const referenced = placeholderIndexes(text);
  const usedIdx = referenced.filter(exists);
  const missing = referenced.filter((n) => !exists(n));

  const newNumber = new Map(usedIdx.map((n, i) => [n, i + 1]));
  const replaced = text.replace(PLACEHOLDER, (_m, d: string) => {
    const k = newNumber.get(Number(d));
    return k ? `[IMAGE_CODE_${k}]` : '';
  });

  // Tidy the gaps left by removed placeholders.
  const tidy = missing.length
    ? replaced.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim()
    : replaced;

  return {
    text: tidy,
    used: usedIdx.map((n) => snippets[n - 1]),
    unused: snippets.filter((s, i) => !usedIdx.includes(i + 1) && s.trim().length > 0),
    missing,
  };
}
