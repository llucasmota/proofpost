import { parseCliArgs, loadContextFiles, type CliArgs } from './cli/parseArgs.ts';
import { UserFacingError } from './cli/errors.ts';
import { runPost, type PostRunResult } from './app/runPost.ts';
import { loadIdea } from './discovery/ideasFile.ts';
import { ideaToRunInput } from './app/ideaToRunInput.ts';
import { runMenu } from './cli/menu.ts';

function printResult(r: PostRunResult) {
  console.log(`\n📁 ${r.outputDir || '(nenhuma pasta)'} · status: ${r.status}${r.unverified ? ' · NÃO VERIFICADO' : ''} · ~US$ ${r.costUsd.toFixed(4)}`);
}

async function run(args: CliArgs) {
  switch (args.mode) {
    case 'post': {
      const userContext = [...args.userContext, ...(await loadContextFiles(args.contextFiles))];
      printResult(await runPost({ instruction: args.instruction, userContext, urls: args.urls, postType: args.postType }));
      return;
    }
    case 'idea': {
      const idea = await loadIdea(args.ideaNumber, args.ideasFile);
      console.log(`💡 Pauta ${args.ideaNumber}: ${idea.title}`);
      printResult(await runPost(ideaToRunInput(idea, args.postType)));
      return;
    }
    case 'interactive':
      await runMenu();
      return;
  }
}

async function main() {
  await run(parseCliArgs(process.argv.slice(2)));
}

main().catch((error) => {
  if (error instanceof UserFacingError) console.error(`❌ ${error.message}`);
  else console.error(error);
  process.exitCode = 1;
});
