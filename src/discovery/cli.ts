import { pathToFileURL } from 'node:url';
import { createRoleServices } from '../services/llmProvider.ts';
import { createWebResearchClient } from '../services/tavilyService.ts';
import { usageTracker } from '../services/usageTracker.ts';
import { collectFeedItems } from './feeds.ts';
import { importOutputFolders } from './history.ts';
import { IDEAS_DIR } from './ideasFile.ts';
import { macNotify } from './notify.ts';
import { runIdeas } from './runIdeas.ts';

/** `npm run ideas`: collects news, ranks 5–7 topic ideas and writes ideas/AAAA-MM-DD.md. */
export async function runIdeasCli(): Promise<string | null> {
  usageTracker.reset();
  const imported = await importOutputFolders('output', `${IDEAS_DIR}/history.json`);
  if (imported) console.log(`[Ideas] Imported ${imported} existing post(s) from output/ into the history.`);

  const lookback = Number(process.env.IDEAS_LOOKBACK_DAYS);
  const result = await runIdeas({
    llm: createRoleServices().researcher,
    web: createWebResearchClient(),
    collectFeeds: (since) => collectFeedItems(since),
    notify: macNotify,
    now: () => new Date(),
    dir: IDEAS_DIR,
    ...(Number.isFinite(lookback) && lookback > 0 ? { lookbackDays: lookback } : {}),
  });
  usageTracker.printSummary();
  console.log(result.mdPath ? `\n💡 ${result.count} pautas: ${result.mdPath}` : '\n💡 Nenhuma pauta nova desta vez.');
  return result.mdPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIdeasCli().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
