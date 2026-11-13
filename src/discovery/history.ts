import fs from 'node:fs/promises';
import path from 'node:path';

export type HistoryEntry = {
  date: string;
  title: string;
  kind: 'suggested' | 'posted';
  slug?: string;
  niche?: string;
  urls: string[];
  timesSuggested?: number;
};

export const HISTORY_PATH = 'ideas/history.json';

/** Warning/banner lines written above drafts: not the post's topic. */
const SKIP_LINE = /^(⚠️|Last reviewer feedback:|Verify and correct|Last Draft:)/;

const SIMILARITY_THRESHOLD = 0.6;
const MAX_TIMES_SUGGESTED = 2;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'how', 'what', 'why', 'is', 'are', 'new', 'your', 'you',
  'o', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'para', 'com', 'por', 'e', 'como', 'que', 'novo', 'nova',
]);

export async function loadHistory(file = HISTORY_PATH): Promise<HistoryEntry[]> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as HistoryEntry[];
  } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    throw e;
  }
}

export async function saveHistory(entries: HistoryEntry[], file = HISTORY_PATH): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(entries, null, 2), 'utf-8');
}

export async function appendHistory(entry: HistoryEntry, file = HISTORY_PATH): Promise<void> {
  const entries = await loadHistory(file);
  entries.push(entry);
  await saveHistory(entries, file);
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

/** First run only: turns the existing output/<slug> folders into "posted" history entries. */
export async function importOutputFolders(outputDir: string, file = HISTORY_PATH): Promise<number> {
  if (await exists(file)) return 0;
  const entries: HistoryEntry[] = [];
  const dirents = await fs.readdir(outputDir, { withFileTypes: true }).catch(() => []);
  for (const d of dirents) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const dir = path.join(outputDir, d.name);
    const post = await fs.readFile(path.join(dir, 'linkedin_post.txt'), 'utf-8').catch(() => '');
    const firstLine = post.split('\n').map((l) => l.trim()).find((l) => l && !SKIP_LINE.test(l));
    const stat = await fs.stat(dir);
    entries.push({
      date: stat.mtime.toISOString().slice(0, 10),
      title: firstLine || d.name.replace(/-/g, ' '),
      kind: 'posted',
      slug: d.name,
      urls: [],
    });
  }
  await saveHistory(entries, file);
  return entries.length;
}

function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9.]+/).map((w) => w.replace(/^\.+|\.+$/g, ''))
      .filter((w) => w && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity of the meaningful words of two titles (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export function isDuplicate(candidate: { url?: string; title: string }, history: HistoryEntry[]): boolean {
  return history.some((e) => {
    const sameUrl = !!candidate.url && e.urls.includes(candidate.url);
    if (!sameUrl && titleSimilarity(candidate.title, e.title) < SIMILARITY_THRESHOLD) return false;
    // Posted: never again. Suggested and not chosen: may come back until suggested twice.
    return e.kind === 'posted' || (e.timesSuggested ?? 1) >= MAX_TIMES_SUGGESTED;
  });
}

/** Records the ideas just suggested (bumping similar earlier suggestions). Returns a new array. */
export function markSuggested(
  history: HistoryEntry[],
  items: { title: string; urls: string[]; niche: string }[],
  date: string,
): HistoryEntry[] {
  const out = history.map((e) => ({ ...e, urls: [...e.urls] }));
  for (const item of items) {
    const prev = out.find((e) => e.kind === 'suggested'
      && (titleSimilarity(e.title, item.title) >= SIMILARITY_THRESHOLD || item.urls.some((u) => e.urls.includes(u))));
    if (prev) {
      prev.timesSuggested = (prev.timesSuggested ?? 1) + 1;
      for (const u of item.urls) if (!prev.urls.includes(u)) prev.urls.push(u);
    } else {
      out.push({ date, title: item.title, kind: 'suggested', niche: item.niche, urls: [...item.urls], timesSuggested: 1 });
    }
  }
  return out;
}
