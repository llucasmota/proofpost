# Pesquisa com fontes, Sugestão de pautas e Terminal interativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pesquisar fontes uma vez por run (URL, contexto do usuário e/ou Tavily) e escrever/revisar com uma FactSheet verificada; gerar pautas semanais com mini-estudo, agendadas no Mac; e oferecer um menu interativo no terminal.

**Architecture:** Novo nó `research` entre orquestrador e especialistas, alimentado por um parser de CLI que separa instrução, contexto e URLs. Os três especialistas passam a usar um construtor de prompt único. As pautas são um script separado (`src/discovery/`) que reusa os serviços de LLM/Tavily, agendado via launchd. O menu (`@clack/prompts`) e a CLI chamam a mesma função `runPost`.

**Tech Stack:** Node ≥24.10 (ESM, imports com `.ts`), TypeScript via `tsx`, LangGraph JS, zod/v3, Tavily REST API, `fast-xml-parser` (feeds), `@clack/prompts` (menu), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-13-pesquisa-e-pautas-design.md`

## Global Constraints

- O diretório **não é um repositório git**: os passos de "commit" são substituídos por **Checkpoint** = `npm test` e `npx tsc --noEmit` passando.
- Todo arquivo de teste novo entra nos scripts `test` **e** `test:watch` do `package.json`.
- Testes unitários sem rede; fakes para Tavily, `fetch` e LLM (estilo de `tests/llmProvider.test.ts`).
- LLM sempre via `createRoleServices()` / `FallbackLlmService`; uso registrado no `usageTracker`.
- `import { z } from 'zod/v3'`, igual ao resto do projeto.
- Sem `TAVILY_API_KEY` nada quebra: a pesquisa usa só URL/contexto e o download local; as pautas usam só os feeds.
- Nunca imprimir valores do `.env`.
- Texto exato do aviso: `⚠️ NÃO VERIFICADO: nenhuma fonte encontrada. Confira as informações técnicas antes de publicar.`
- Tipos de post: `'quick' | 'deep'` (padrão `deep`). Nichos das pautas: `'flutter_dart' | 'node_react' | 'ai_engineering'`.
- Novas variáveis no `.env.example`: `TAVILY_API_KEY=`, `RESEARCH_SEARCH=auto`, `# LLM_CHAIN_RESEARCHER=...`, `IDEAS_LOOKBACK_DAYS=7`.

## Review Focus

1. **Node instalado via nvm + launchd** (`/Users/…/.nvm/versions/node/v24.15.0/bin/node`): o launchd não carrega o PATH do shell. Esperado: o plist usa o caminho absoluto do node e um PATH que inclui a pasta dele, e o script de instalação mostra o caminho e o arquivo de log. Teste na Task 11.
2. **Tavily sem chave, com 401 ou com cota esgotada:** esperado: o post sai com as fontes do usuário (ou "não verificado") e as pautas saem só dos feeds, sem quebrar. Testes nas Tasks 2 e 9.
3. **URL que nem o Tavily nem o download local conseguem ler:** esperado: no modo `auto`, isso conta como "sem fonte do usuário" e dispara a busca principal (5 resultados). Teste na Task 2.
4. **LLM de ranking inventando links de estudo:** esperado: links que não vieram da coleta são descartados, e a pauta que fica sem nenhum link é descartada. Teste na Task 9.
5. **`--idea N` sem arquivo de ideias ou com N fora do intervalo, e `--context` com arquivo inexistente:** esperado: mensagem clara, por exemplo "Nenhum arquivo de ideias encontrado — rode `npm run ideas`", com saída ≠ 0 e sem stack trace. Testes nas Tasks 7 e 10.

---

### Task 1: Parser da CLI e novos campos do state

**Files:**
- Create: `src/cli/parseArgs.ts`
- Modify: `src/graph/graph.ts` (state)
- Test: `tests/parseArgs.test.ts`

**Interfaces:**
- Consumes: `extractUrls(text)` de `src/services/webContentService.ts`.
- Produces:
  ```ts
  export type PostType = 'quick' | 'deep';
  export type CliArgs =
    | { mode: 'interactive' }
    | { mode: 'post'; instruction: string; userContext: string[]; contextFiles: string[]; urls: string[]; postType: PostType }
    | { mode: 'idea'; ideaNumber: number; ideasFile?: string; postType?: PostType };
  export function parseCliArgs(argv: string[], env?: Record<string, string | undefined>): CliArgs;
  export async function loadContextFiles(paths: string[]): Promise<string[]>; // lança Error('Arquivo de contexto não encontrado: <path>')
  ```
  Novos campos em `PostStateAnnotation`: `userContext: z.array(z.string()).optional()`, `sourceUrls: z.array(z.string()).optional()`, `postType: z.enum(['quick','deep']).default('deep')`, `searchQuery: z.string().optional()`. Os campos de pesquisa e saída ficam com as Tasks 3 e 6.

- [ ] **Step 1: Write the failing tests** em `tests/parseArgs.test.ts`:
  - `[]` → `{ mode: 'interactive' }`
  - `['Explain', 'X']` → `mode 'post'`, `instruction 'Explain X'`, `postType 'deep'`, `userContext []`
  - `['Explain https://x.dev/a\nCONTEXTO:\nminhas notas\nhttps://y.dev']` → `instruction 'Explain https://x.dev/a'`, `userContext ['minhas notas\nhttps://y.dev']`, `urls ['https://x.dev/a']` (URLs do contexto não entram em `urls`)
  - `CONTEXT:` (em inglês) e minúsculas (`contexto:`) também funcionam como separador
  - `['X', '--context', 'n.md', '--context', 'm.md']` → `contextFiles ['n.md','m.md']`, `instruction 'X'`
  - `['X', '--quick']` → `postType 'quick'`
  - `['--idea', '3']` → `{ mode: 'idea', ideaNumber: 3 }`; `['--idea', '3', '--ideas-file', 'ideas/a.json']` → `ideasFile` preenchido
  - `['--idea', 'abc']` lança erro cuja mensagem contém `--idea`
  - fallback do npm: `argv ['3']`, `env { npm_config_idea: 'true' }` → `mode 'idea'`, `ideaNumber 3`; `env { npm_config_quick: 'true' }` com `['X']` → `postType 'quick'`
  - `loadContextFiles(['/nao/existe.md'])` rejeita com mensagem contendo `/nao/existe.md`
- [ ] **Step 2: Run** `node --test tests/parseArgs.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implement** `parseCliArgs` e `loadContextFiles` em `src/cli/parseArgs.ts`. Separador de contexto: primeira linha que casa `/^\s*(CONTEXTO|CONTEXT)\s*:\s*$/im`. Os posicionais são unidos com espaço, como hoje no `src/index.ts`. Depois, adicione os campos do state em `graph.ts`.
- [ ] **Step 4: Run** `node --test tests/parseArgs.test.ts` → PASS.
- [ ] **Step 5: Checkpoint** (registre o teste novo no `package.json`).

---

### Task 2: Cliente Tavily e coleta de fontes

**Files:**
- Create: `src/services/tavilyService.ts`, `src/research/sources.ts`, `src/research/collectSources.ts`, `src/research/officialDomains.ts`
- Test: `tests/collectSources.test.ts`, `tests/tavilyService.test.ts`

**Interfaces:**
- Consumes: `fetchUrlContent(url)` de `webContentService.ts`.
- Produces:
  ```ts
  // src/research/sources.ts
  export type SourceKind = 'user_context' | 'user_url' | 'search';
  export const SourceDocSchema: z.ZodObject<...>; // mesmos campos de SourceDoc (usado no state, Task 3)
  export type SourceDoc = { id: string; kind: SourceKind; url?: string; title?: string; publishedAt?: string; text: string };
  export const MAX_SOURCE_CHARS = 20_000;
  export function selectRelevantText(text: string, terms: string[], maxChars?: number): string;

  // src/services/tavilyService.ts
  export type WebSearchOptions = { maxResults: number; topic?: 'general' | 'news'; timeRange?: 'day' | 'week' | 'month'; includeDomains?: string[]; includeRawContent?: boolean };
  export type WebSearchResult = { url: string; title: string; content: string; rawContent?: string; publishedDate?: string };
  export interface IWebResearchClient {
    search(query: string, opts: WebSearchOptions): Promise<WebSearchResult[]>;
    extract(urls: string[]): Promise<{ url: string; text: string }[]>;
  }
  export class TavilyClient implements IWebResearchClient { constructor(apiKey: string, fetchImpl?: typeof fetch) }
  export function createWebResearchClient(env?: Record<string, string | undefined>): IWebResearchClient | null; // null sem TAVILY_API_KEY

  // src/research/officialDomains.ts
  export type PostNiche = 'flutter_dart' | 'node_react' | 'ai_engineering';
  export const OFFICIAL_DOMAINS: Record<PostNiche, string[]>;

  // src/research/collectSources.ts
  export type SearchMode = 'auto' | 'always' | 'never';
  export type CollectInput = { userContext: string[]; urls: string[]; searchQuery: string; niche: PostNiche; mode: SearchMode };
  export type CollectDeps = { web: IWebResearchClient | null; fetchUrl: (url: string) => Promise<string | null> };
  export async function collectSources(input: CollectInput, deps: CollectDeps): Promise<SourceDoc[]>;
  ```

- [ ] **Step 1: Write the failing tests.**
  - `tests/tavilyService.test.ts`, com `fetchImpl` falso que captura a requisição:
    - `search` faz POST em `https://api.tavily.com/search` com `Authorization: Bearer <key>` e corpo com `query`, `max_results`, `topic`, `time_range`, `include_domains`, `include_raw_content`;
    - mapeia `results[].raw_content` → `rawContent` e `published_date` → `publishedDate`;
    - resposta 401 → rejeita com mensagem contendo `401`;
    - `createWebResearchClient({})` → `null`.
  - `tests/collectSources.test.ts`, com `web` e `fetchUrl` falsos:
    - só contexto, modo `auto` → 1 fonte `user_context` (`id 'ctx-1'`) + busca complementar com `maxResults 3` e `includeDomains = OFFICIAL_DOMAINS[niche]`;
    - sem contexto e sem URL, modo `auto` → busca principal `maxResults 5`, sem `includeDomains`, `includeRawContent true`; fontes `web-1..n`, com `text` = `rawContent ?? content`;
    - URL extraída pelo Tavily → fonte `user_url` (`id 'url-1'`), e `fetchUrl` não é chamado;
    - URL que o `extract` não devolve → `fetchUrl` é chamado como fallback;
    - URL ilegível nos dois (`extract []`, `fetchUrl null`), modo `auto` → busca **principal** (5) [Review Focus 3];
    - `web: null` → nenhuma busca, fontes do usuário mantidas [Review Focus 2];
    - `web.search` que lança erro → não propaga, fontes do usuário mantidas [Review Focus 2];
    - modo `never` → nunca busca; modo `always` com contexto → busca principal (5);
    - busca que devolve a mesma URL do usuário → descartada (sem duplicata);
    - `selectRelevantText`: texto ≤ limite volta igual; texto maior volta ≤ `maxChars`, contém o parágrafo que menciona o termo, e os parágrafos mantêm a ordem original.
- [ ] **Step 2: Run** `node --test tests/tavilyService.test.ts tests/collectSources.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
  - Antes, confirme a API REST atual do Tavily (endpoints `/search` e `/extract`, nomes dos campos e custo em créditos). Use `fetch` direto, sem SDK.
  - Termos para o `selectRelevantText`: palavras com 4+ letras do `searchQuery`.
  - `OFFICIAL_DOMAINS`:
    - `flutter_dart`: `flutter.dev`, `docs.flutter.dev`, `dart.dev`, `pub.dev`, `firebase.google.com`, `github.com`, `medium.com/flutter`
    - `node_react`: `nodejs.org`, `react.dev`, `nextjs.org`, `typescriptlang.org`, `devblogs.microsoft.com`, `vite.dev`, `github.com`
    - `ai_engineering`: `langchain.com`, `docs.langchain.com`, `ai.google.dev`, `platform.openai.com`, `docs.anthropic.com`, `openrouter.ai`, `modelcontextprotocol.io`, `google.github.io`, `github.com`
- [ ] **Step 4: Run** os mesmos testes → PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 3: FactSheet, verificação de citações, papel `researcher` e nó `research`

**Files:**
- Create: `src/research/factSheet.ts`, `src/graph/nodes/researchNode.ts`, `src/prompts/v1/researcher.txt`
- Modify: `src/config.ts` (papel `researcher`, `prompts.researcher`, `RESEARCH_SEARCH`), `src/graph/graph.ts` (state), `tests/config.test.ts`
- Test: `tests/factSheet.test.ts`, `tests/researchNode.test.ts`

**Interfaces:**
- Consumes: `collectSources`, `SourceDoc`, `CollectDeps`, `SearchMode` (Task 2); `ILlmService`.
- Produces:
  ```ts
  // factSheet.ts
  export const FactSchema: z.ZodObject<{ claim; sourceId; quote; publishedAt /* '' se desconhecida */; contradictsUserSource: boolean }>;
  export const FactSheetOutputSchema: z.ZodObject<{ facts: z.ZodArray<typeof FactSchema>; gaps: z.ZodArray<z.ZodString> }>;
  export type Fact = z.infer<typeof FactSchema>;
  export type DropReason = 'unknown_source' | 'quote_not_found' | 'contradicts_user_source';
  export function normalizeForQuote(s: string): string;
  export function verifyFacts(facts: Fact[], sources: SourceDoc[]): { kept: Fact[]; dropped: { fact: Fact; reason: DropReason }[] };
  // researchNode.ts
  export function createResearchNode(llm: ILlmService, deps: CollectDeps & { searchMode: SearchMode }): (state: GraphState) => Promise<Partial<GraphState>>;
  ```
  - Novos campos no state: `sources: z.array(SourceDocSchema).optional()`, `factSheet: z.array(FactSchema).optional()`, `researchGaps: z.array(z.string()).optional()`, `researchStatus: z.enum(['ok','no_sources']).optional()`.
  - `LlmRole` ganha `'researcher'`. A cadeia é a mesma do `optimizer` (Gemini 2.5 Flash direto → OpenRouter Gemini 2.5 Flash → DeepSeek v4.1 Flash), com `temperature 0` e `maxOutputTokens 8_192`. Pode ser sobrescrita por `LLM_CHAIN_RESEARCHER`.
  - `export function researchSearchMode(env?): SearchMode` lê `RESEARCH_SEARCH` (o padrão e qualquer valor inválido viram `'auto'`).

- [ ] **Step 1: Write the failing tests.**
  - `tests/factSheet.test.ts`:
    - citação idêntica é mantida;
    - citação com aspas tipográficas, caixa diferente e quebras de linha extras é mantida (`normalizeForQuote`);
    - citação que não está no texto → `quote_not_found`;
    - `sourceId` inexistente → `unknown_source`;
    - fato de fonte `search` com `contradictsUserSource true` → `contradicts_user_source`;
    - fato de fonte `user_url` com `contradictsUserSource true` é mantido.
  - `tests/researchNode.test.ts`, com LLM falso que devolve fatos fixos e `CollectDeps` falsos:
    - fatos válidos → `researchStatus 'ok'` e `factSheet` só com os mantidos;
    - todos os fatos reprovados → `'no_sources'`, `sources` preservadas;
    - LLM falha → `'no_sources'`, `sources` preservadas;
    - sem nenhuma fonte → `'no_sources'` **sem chamar o LLM**;
    - `searchQuery` vazio no state usa `optimizedCommand ?? initialCommand` cortado em 200 caracteres;
    - `niche 'out_of_scope'` → devolve `{}`.
  - `tests/config.test.ts`: `resolveRoles({}).researcher.chain` termina em `deepseek/deepseek-v4.1-flash` e `LLM_ROLES` inclui `'researcher'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Prompt do `researcher.txt`:
    - extrair só fatos técnicos verificáveis (versões, APIs, flags, números, datas);
    - `quote` copiada literalmente da fonte, com no máximo 300 caracteres;
    - `sourceId` exatamente um dos ids informados;
    - `contradictsUserSource` true quando um fato de busca contradiz uma fonte do usuário;
    - `gaps` = o que a instrução pede e as fontes não cobrem.
  - A mensagem do usuário lista cada fonte como `[SOURCE <id> · <kind> · <url> · <publishedAt>]\n<text>`.
  - Ao final, registre no log quantos fatos foram descartados e por qual motivo.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 4: Especialistas com prompt único (FactSheet + tipo de post)

**Files:**
- Create: `src/graph/nodes/specialistNode.ts`
- Modify: `src/graph/nodes/flutterNode.ts`, `nodeJsReactNode.ts`, `aiNode.ts` (viram wrappers de uma linha); `src/prompts/v1/flutterNode.txt`, `nodeJsReact.txt`, `aiEngineer.txt` (trocar as regras de `[WEB_DATA]` por `[FACT_SHEET]`/`[SOURCES]`)
- Test: `tests/specialistPrompt.test.ts`

**Interfaces:**
- Consumes: campos do state das Tasks 1 e 3.
- Produces:
  ```ts
  export const POST_TYPE_RULES: Record<PostType, string>;
  export function buildSpecialistUserPrompt(state: GraphState): string;
  export function createSpecialistNode(llm: ILlmService, systemPrompt: string, label: string): (state: GraphState) => Promise<Partial<GraphState>>;
  ```
  `POST_TYPE_RULES.quick` = `"POST TYPE: QUICK — 80 to 150 words, one central idea, code optional (at most one short snippet)."`; `POST_TYPE_RULES.deep` = `"POST TYPE: DEEP — full technical post as usual."`
  O nó devolve só `{ technicalDraft, codeSnippets }`. Ele **não** chama mais `RagService` nem `fetchUrlContent`.

- [ ] **Step 1: Write the failing tests** (`buildSpecialistUserPrompt`):
  - com FactSheet, contém `[FACT_SHEET]`, linhas `F1 [url-1 · https://x.dev · 2026-11-01]`, a claim e a quote, mais a regra `"Specific technical claims (versions, flags, API names, numbers) are allowed ONLY if they appear in [FACT_SHEET]"`;
  - contém `[SOURCES]` com o texto de cada fonte cortado em 8_000 caracteres;
  - com `researchGaps` não vazio, contém `[GAPS]`;
  - `researchStatus 'no_sources'` → contém `[NO_SOURCES]` e não contém `[FACT_SHEET]`;
  - `postType 'quick'` → contém `POST_TYPE_RULES.quick`;
  - `userContext` aparece **só** como fonte, sem repetição no Topic;
  - o modo de correção cirúrgica (`reviewCount > 0` com `corrections`) mantém o texto atual (`[SURGICAL CORRECTION MODE`, `[APPROVED CONTENT`);
  - não contém `[WEB_DATA]` nem `[RAG Data]`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Mova a montagem de prompt que hoje está duplicada nos três nós para `specialistNode.ts`.
  - `createFlutterNode = (llm) => createSpecialistNode(llm, prompts.flutterNode, 'Flutter Specialist')`; idem para os outros dois.
  - Atualize as regras de *grounding* nos três `.txt`: onde diz `[WEB_DATA]`, passa a valer `[FACT_SHEET]` como verdade e `[SOURCES]` como contexto.
- [ ] **Step 4: Run** → PASS, e `npm test` inteiro.
- [ ] **Step 5: Checkpoint.**

---

### Task 5: Revisor com FactSheet e modo sem fatos

**Files:**
- Modify: `src/graph/nodes/reviewerNode.ts`, `src/prompts/v1/reviewer.txt`
- Test: `tests/reviewerPrompt.test.ts`

**Interfaces:**
- Produces: `export function buildReviewerUserPrompt(state: GraphState, today?: string): string`. O resto do nó permanece igual (incluindo a regra de placeholders adicionada antes).

- [ ] **Step 1: Write the failing tests:**
  - com FactSheet, contém `[FACT_SHEET]` e a regra `"Reject any specific technical claim that is not supported by [FACT_SHEET]"`;
  - não contém `[WEB_DATA]`;
  - `researchStatus 'no_sources'` → contém `NO-FACTS MODE`, a instrução de revisar só estilo, formato e erros técnicos evidentes, e **não** contém a regra de rejeição por FactSheet;
  - `postType 'quick'` → contém `POST_TYPE_RULES.quick`;
  - placeholders: o `PLACEHOLDER RULE` continua presente quando há snippets.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `buildReviewerUserPrompt` (extraído do nó). Ajuste o `reviewer.txt` para tratar a FactSheet como a verdade de referência.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 6: Histórico de posts e pautas

**Files:**
- Create: `src/discovery/history.ts`
- Test: `tests/history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HistoryEntry = { date: string; title: string; kind: 'suggested' | 'posted'; slug?: string; niche?: string; urls: string[]; timesSuggested?: number };
  export const HISTORY_PATH = 'ideas/history.json';
  export async function loadHistory(path?: string): Promise<HistoryEntry[]>;                 // arquivo ausente → []
  export async function saveHistory(entries: HistoryEntry[], path?: string): Promise<void>;
  export async function appendHistory(entry: HistoryEntry, path?: string): Promise<void>;
  export async function importOutputFolders(outputDir: string, path?: string): Promise<number>; // só se o histórico não existir; devolve quantos importou
  export function titleSimilarity(a: string, b: string): number;                            // Jaccard de palavras normalizadas, sem stopwords pt/en
  export function isDuplicate(candidate: { url?: string; title: string }, history: HistoryEntry[]): boolean;
  export function markSuggested(history: HistoryEntry[], items: { title: string; url?: string; niche: string }[], date: string): HistoryEntry[];
  ```
  Regras de `isDuplicate`:
  - a mesma URL de qualquer entrada → duplicata;
  - `titleSimilarity ≥ 0.6` com uma entrada `posted` → duplicata;
  - uma entrada `suggested` com `timesSuggested ≥ 2` e similaridade ≥ 0.6 → duplicata.

- [ ] **Step 1: Write the failing tests** (com diretórios temporários de `fs.mkdtemp`):
  - `loadHistory` sem arquivo devolve `[]`;
  - `importOutputFolders` lê as pastas e cria entradas `posted`, com `title` = a primeira linha não vazia do `linkedin_post.txt`, ou o nome da pasta se o arquivo não existir;
  - quando o histórico já existe, não importa de novo (devolve 0);
  - `isDuplicate`: mesma URL → true; título "Flutter MediaQuery sizeOf APIs" contra posted "New MediaQuery APIs in Flutter: sizeOf" → true; título sem relação → false; sugerida 2 vezes → true; sugerida 1 vez → false;
  - `markSuggested` incrementa `timesSuggested` de uma entrada existente semelhante e cria uma nova quando não existe.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 7: Fiação do grafo, saída do post e `runPost`

**Files:**
- Create: `src/app/runPost.ts`, `src/app/captureConsole.ts`
- Modify:
  - `src/graph/graph.ts`: nó `research`, `outputDir` e `runStatus` no state, e `buildPostGraph(llm, deps?)`;
  - `src/graph/nodes/edgeConditions.ts`: `routeAfterOrchestrator`;
  - `src/graph/nodes/orchestratorNode.ts`: pula o LLM com nicho preenchido e devolve `searchQuery`;
  - `src/graph/nodes/schemas.ts`: `searchQuery` no `OrchestratorOutputSchema`;
  - `src/graph/nodes/imageExtractorNode.ts`: `sources.md`, aviso, histórico;
  - `src/index.ts`: usa `parseCliArgs` + `runPost`;
  - `src/graph/factory.ts`: passa os deps padrão.
- Test: `tests/edgeConditions.test.ts` (ampliar), `tests/orchestratorSkip.test.ts`, `tests/sourcesMarkdown.test.ts`

**Interfaces:**
- Consumes: `createResearchNode` (Task 3), `appendHistory` (Task 6), `parseCliArgs` / `loadContextFiles` (Task 1), `createWebResearchClient` (Task 2), `researchSearchMode` (Task 3).
- Produces:
  ```ts
  // edgeConditions.ts
  export const routeAfterOrchestrator: (state: GraphState) => 'research' | 'imageExtractor';
  // imageExtractorNode.ts
  export const UNVERIFIED_WARNING = '⚠️ NÃO VERIFICADO: nenhuma fonte encontrada. Confira as informações técnicas antes de publicar.';
  export function renderSourcesMarkdown(sources: SourceDoc[], facts: Fact[], gaps: string[]): string;
  // runPost.ts
  export type PostRunInput = { instruction: string; userContext: string[]; urls: string[]; postType: PostType; niche?: PostNiche; slug?: string; searchQuery?: string };
  export type PostRunStatus = 'approved' | 'not_reviewed' | 'review_limit' | 'failed' | 'out_of_scope';
  export type PostRunResult = { outputDir: string; status: PostRunStatus; unverified: boolean; costUsd: number };
  export async function runPost(input: PostRunInput, opts?: { onStage?: (node: string) => void; quiet?: boolean }): Promise<PostRunResult>;
  // captureConsole.ts
  export function captureConsole(logFile: string, opts: { echo: boolean }): () => void; // devolve a função de restaurar
  ```
  - Fluxo do grafo: `START → promptOptimizer → orchestrator → (routeAfterOrchestrator) → research → (routeToSpecialist) → especialistas → reviewer → …`.
  - O `imageExtractor` grava `outputDir` e `runStatus` no state.
  - `runPost` usa `graph.stream(..., { streamMode: ['updates', 'values'] })`: os updates alimentam o `onStage` e o último `values` dá o resultado.
  - Com `quiet: true`, o console vai só para `output/.runs/<timestamp>.log`, que é copiado para `<outputDir>/run.log` no fim.
  - O `usageTracker` é zerado no início de cada `runPost`, porque o menu pode rodar vários posts no mesmo processo.

- [ ] **Step 1: Write the failing tests:**
  - `routeAfterOrchestrator`: `out_of_scope` → `imageExtractor`; `flutter_dart` → `research`;
  - orquestrador com `niche` e `suggestedFolderSlug` já no state devolve `{}` e não chama o LLM (LLM falso que lança erro);
  - `renderSourcesMarkdown` lista cada fonte (tipo, URL, data), cada fato com a citação entre aspas e a fonte, e a seção "Lacunas" quando há gaps;
  - `renderSourcesMarkdown([], [], [])` contém "Nenhuma fonte";
  - função pura `buildPostFileText(state)`, exportada do extractor, com `researchStatus 'no_sources'` e `finalPostText` → começa com `UNVERIFIED_WARNING`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - O extractor grava `sources.md` sempre que o nicho não for `out_of_scope`, e chama `appendHistory({ kind: 'posted', … })` quando salva `linkedin_post.txt`.
  - Em `src/index.ts`, os modos são:
    - `post`: carrega o contexto e chama `runPost`;
    - `idea`: Task 10;
    - `interactive`: Task 12; até lá, mostra o uso.
  - Erros esperados (`Error` com mensagem para o usuário) são impressos sem stack trace, com `exitCode 1` [Review Focus 5].
- [ ] **Step 4: Run** `npm test` → PASS; `npx tsc --noEmit` → limpo.
- [ ] **Step 5: Smoke test offline:** `RESEARCH_SEARCH=never RAG_ENABLED=false npm start -- "x" --context /nao/existe.md` → mensagem `Arquivo de contexto não encontrado`, exit 1, nenhuma chamada LLM.
- [ ] **Step 6: Checkpoint.**

---

### Task 8: Coleta de feeds para pautas

**Files:**
- Create: `src/discovery/sources.ts`, `src/discovery/feeds.ts`
- Modify: `package.json` (dependência `fast-xml-parser`)
- Test: `tests/feeds.test.ts` (com fixtures RSS e Atom inline)

**Interfaces:**
- Produces:
  ```ts
  // sources.ts
  export const WATCHED: Record<PostNiche, { techs: string[]; feeds: string[] }>;
  // feeds.ts
  export type FeedItem = { title: string; url: string; publishedAt?: string; summary?: string; feed: string; niche: PostNiche };
  export function parseFeed(xml: string, feed: string, niche: PostNiche): FeedItem[];   // RSS 2.0 e Atom
  export async function collectFeedItems(since: Date, fetchImpl?: typeof fetch): Promise<FeedItem[]>; // feed com erro é ignorado e logado
  ```
  - `techs` segue a seção 5.10 do spec.
  - `feeds` iniciais (o implementador confere que cada um responde 200 com XML e remove os que não respondem):
    - **Flutter/Dart:** `https://medium.com/feed/flutter`, `https://medium.com/feed/dartlang`, releases (`https://github.com/<repo>/releases.atom`) de `flutter/flutter`, `dart-lang/sdk`, `firebase/flutterfire`, `rrousselGit/riverpod`, `felangel/bloc`.
    - **Node/React:** `https://nodejs.org/en/feed/blog.xml`, `https://react.dev/rss.xml`, `https://nextjs.org/feed.xml`, `https://devblogs.microsoft.com/typescript/feed/`, releases de `vitejs/vite`.
    - **IA:** releases de `langchain-ai/langgraphjs`, `langchain-ai/langchainjs`, `modelcontextprotocol/modelcontextprotocol`, `google/adk-python`, `google-ai-edge/LiteRT`; mais `https://blog.langchain.com/rss/`.

- [ ] **Step 1: Write the failing tests:**
  - `parseFeed` em RSS: lê title, link e pubDate em ISO;
  - `parseFeed` em Atom: lê title, `link@href` e `updated`;
  - XML inválido → `[]`;
  - `collectFeedItems` com fetch falso: descarta itens anteriores a `since` e ignora feeds que respondem 500, sem lançar erro.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** O `collectFeedItems` lê os feeds de `WATCHED` em paralelo, com timeout de 10s por feed.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 9: Ranking, arquivo de ideias e `npm run ideas`

**Files:**
- Create: `src/discovery/rankIdeas.ts`, `src/discovery/ideasFile.ts`, `src/discovery/runIdeas.ts`, `src/discovery/cli.ts`, `src/prompts/v1/ideasRanker.txt`
- Modify: `src/config.ts` (`prompts.ideasRanker`), `package.json` (script `"ideas": "tsx --env-file .env src/discovery/cli.ts"`), `.env.example`, `.gitignore` (`ideas/logs`)
- Test: `tests/rankIdeas.test.ts`, `tests/ideasFile.test.ts`, `tests/runIdeas.test.ts`

**Interfaces:**
- Consumes: `collectFeedItems`, `WATCHED` (Task 8); `IWebResearchClient` (Task 2); `loadHistory`, `isDuplicate`, `markSuggested`, `saveHistory`, `importOutputFolders` (Task 6); papel `researcher` (Task 3).
- Produces:
  ```ts
  // rankIdeas.ts
  export type Candidate = { title: string; url: string; summary?: string; publishedAt?: string; niche: PostNiche; origin: 'feed' | 'search' };
  export const IdeaSchema: z.ZodObject<{ title; niche; postType; whatItIs; whyItMatters; studyLinks: z.ZodArray<{ url; note }>; angle }>;
  export type Idea = z.infer<typeof IdeaSchema>;
  export async function rankIdeas(llm: ILlmService, candidates: Candidate[], historyTitles: string[]): Promise<Idea[]>;
  export function sanitizeIdeas(ideas: Idea[], candidates: Candidate[]): Idea[]; // links fora dos candidatos saem; pauta sem link sai; máximo 7
  // ideasFile.ts
  export type IdeasFile = { date: string; ideas: Idea[] };
  export function renderIdeasMarkdown(file: IdeasFile): string;
  export async function writeIdeasFiles(file: IdeasFile, dir?: string): Promise<{ mdPath: string; jsonPath: string }>; // ideas/AAAA-MM-DD.md e .json
  export async function latestIdeasFile(dir?: string): Promise<string | null>;
  export async function loadIdea(n: number, file?: string, dir?: string): Promise<Idea>; // n começa em 1
  // runIdeas.ts
  export type IdeasDeps = { llm: ILlmService; web: IWebResearchClient | null; collectFeeds: (since: Date) => Promise<FeedItem[]>; notify: (msg: string) => Promise<void>; now: () => Date; dir: string };
  export async function runIdeas(deps: IdeasDeps): Promise<{ mdPath: string; count: number } | { mdPath: null; count: 0 }>;
  ```
  - Cada pauta no `.md` traz: `## N. <title>`, a linha `Nicho · Tipo`, as seções **O que é**, **Por que importa**, **Para estudar** (links com a nota) e **Ângulo sugerido**, e o comando `npm start -- --idea N`.
  - Busca de notícias: uma por nicho, `topic 'news'`, `timeRange 'week'`, `maxResults 5`. A query junta as `techs` do nicho com `OR`.
  - `IDEAS_LOOKBACK_DAYS` (padrão 7) define o `since` dos feeds.
  - Notificação: `osascript -e 'display notification "<N> pautas novas" with title "content-builder"'` via `execFile`, ignorando erros e plataformas que não são macOS.
  - Custo: `usageTracker.summary()` é gravado em `ideas/AAAA-MM-DD.usage.json`.
  - Sem candidatos ou com o LLM falhando: não grava arquivo, notifica "Nenhuma pauta nova" e o processo sai com código 0.

- [ ] **Step 1: Write the failing tests:**
  - `sanitizeIdeas`: link inventado removido; pauta que fica sem link removida; 9 pautas → 7 [Review Focus 4];
  - `renderIdeasMarkdown`: contém `## 1.`, `npm start -- --idea 1`, `Para estudar` e as URLs;
  - `loadIdea(2)` lê a segunda pauta do `.json` mais recente;
  - `loadIdea(9)` em arquivo com 5 pautas rejeita com mensagem contendo `1 e 5`;
  - `loadIdea` sem arquivos rejeita com `Nenhum arquivo de ideias encontrado — rode npm run ideas` [Review Focus 5];
  - `runIdeas` com `web` que lança erro → usa só os feeds e grava o arquivo [Review Focus 2];
  - candidatos duplicados do histórico não chegam ao LLM (o LLM falso registra o que recebeu);
  - o histórico é atualizado com `markSuggested`;
  - sem candidatos → `{ mdPath: null, count: 0 }` e `notify` chamado.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - `ideasRanker.txt` traz:
    - a rubrica (relevância para os nichos, novidade real, substância técnica, dá para aprender o básico em ~30 min);
    - 5 a 7 pautas, misturando `quick` e `deep`;
    - `studyLinks` só com URLs da lista de candidatos, a oficial primeiro;
    - não repetir os títulos do histórico.
  - O `cli.ts` monta os deps reais, chama `importOutputFolders('output')` antes do primeiro run e imprime o caminho do `.md`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 10: `--idea N` gera o post da pauta

**Files:**
- Create: `src/app/ideaToRunInput.ts`
- Modify: `src/index.ts`
- Test: `tests/ideaToRunInput.test.ts`

**Interfaces:**
- Consumes: `loadIdea` (Task 9), `runPost` / `PostRunInput` (Task 7).
- Produces: `export function ideaToRunInput(idea: Idea, postTypeOverride?: PostType): PostRunInput`.
  - `instruction`: ``Write a ${type === 'quick' ? 'short' : 'in-depth'} LinkedIn post about: ${idea.title}. Angle: ${idea.angle}``
  - `urls`: as URLs dos `studyLinks`;
  - `niche`: `idea.niche`;
  - `slug`: o título em slug, com no máximo 20 caracteres;
  - `searchQuery`: `idea.title`;
  - `userContext`: `[]`.

- [ ] **Step 1: Write the failing tests:** mapeamento completo; `postTypeOverride 'quick'` vence o `postType` da pauta; slug com no máximo 20 caracteres e sem hífen no fim.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** No modo `idea`, o `index.ts` faz `loadIdea` → `ideaToRunInput` → `runPost`. Erros de `loadIdea` saem como mensagem simples, com exit 1.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 11: Agendamento no Mac (launchd)

**Files:**
- Create: `scripts/ideasSchedule.ts`. Decisão: TypeScript em vez de `.sh`, para a geração do plist ser testável; o comportamento é o do spec 5.7.
- Modify: `package.json` (scripts `"ideas:schedule": "tsx scripts/ideasSchedule.ts install"` e `"ideas:unschedule": "tsx scripts/ideasSchedule.ts uninstall"`)
- Test: `tests/ideasSchedule.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ScheduleSlot = { weekday: number; hour: number; minute: number }; // weekday no padrão do launchd: 1 = segunda
  export const DEFAULT_SCHEDULE: ScheduleSlot[]; // seg, qua, sex às 08:00
  export const LABEL = 'com.content-builder.ideas';
  export function buildLaunchAgentPlist(o: { label: string; nodePath: string; projectDir: string; logDir: string; schedule: ScheduleSlot[] }): string;
  ```
  - `ProgramArguments`: `[nodePath, '--env-file', '<projectDir>/.env', '--import', 'tsx', '<projectDir>/src/discovery/cli.ts']`.
  - `WorkingDirectory` = `projectDir`.
  - `EnvironmentVariables.PATH` = `dirname(nodePath):/usr/bin:/bin:/usr/sbin:/sbin`.
  - `StandardOutPath` / `StandardErrorPath` = `<logDir>/ideas.log`.
  - `StartCalendarInterval` = um array com um dict por slot.
  - `install`:
    - grava `~/Library/LaunchAgents/<LABEL>.plist` usando `process.execPath` como `nodePath`;
    - roda `launchctl bootout gui/<uid>/<LABEL>` (ignorando erro) e depois `launchctl bootstrap gui/<uid> <plist>`;
    - imprime o node usado, os horários e o caminho do log;
    - avisa para reinstalar se trocar a versão do node no nvm.
  - `uninstall`: roda `bootout` e apaga o plist.

- [ ] **Step 1: Write the failing tests:**
  - o plist é XML válido, com 3 `<dict>` no `StartCalendarInterval`, `Weekday` 1/3/5 e `Hour` 8;
  - o primeiro `ProgramArguments` é o `nodePath` absoluto;
  - o PATH começa com a pasta do node [Review Focus 1];
  - caminhos com espaço aparecem escapados corretamente (não há shell no meio);
  - `&` vira `&amp;`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Checkpoint.** **Não** rode o `install`: quem roda é o usuário, porque altera a configuração do Mac dele.

---

### Task 12: Terminal interativo

**Files:**
- Create: `src/cli/menu.ts`, `src/cli/menuOptions.ts`
- Modify: `src/index.ts` (o modo `interactive` chama `runMenu`), `package.json` (dependência `@clack/prompts` e script `"app": "tsx --env-file .env src/index.ts"`)
- Test: `tests/menuOptions.test.ts`

**Interfaces:**
- Consumes: `runPost` (Task 7), `loadIdea` / `latestIdeasFile` / `IdeasFile` (Task 9), `runIdeas` (Task 9), `ideaToRunInput` (Task 10), `loadContextFiles` / `extractUrls`.
- Produces:
  ```ts
  // menuOptions.ts (puro)
  export const MAIN_MENU: { value: 'idea' | 'own' | 'ideas' | 'exit'; label: string }[]; // os rótulos exatos do spec 5.11
  export function ideaOptions(file: IdeasFile): { value: number; label: string; hint: string }[];  // label "N. título", hint "nicho · tipo"
  export function renderStudy(idea: Idea): string;
  export function ownTopicToRunInput(a: { instruction: string; urlsText: string; context: string[]; postType: PostType }): PostRunInput;
  export function stageLabel(node: string, reviewCount?: number): string; // research → "Pesquisando fontes…", reviewer → "Revisando (n/3)…"
  // menu.ts
  export async function runMenu(): Promise<void>;
  ```
  - O contexto pode ser colado no editor: grava um arquivo temporário e o abre com `spawnSync(process.env.EDITOR || 'nano', [file], { stdio: 'inherit' })`. Arquivo vazio = sem contexto.
  - `runPost` roda com `quiet: true` e um spinner atualizado por `onStage`.
  - No fim, mostra a pasta, o status (incluindo "não verificado") e o custo, e pergunta "Abrir a pasta?" (`open <dir>`). Depois volta ao menu principal.
  - Ctrl+C e cancelamento (`isCancel`) saem sem stack trace.

- [ ] **Step 1: Write the failing tests:**
  - `ideaOptions` numera a partir de 1;
  - `renderStudy` contém **O que é**, os links e o ângulo;
  - `ownTopicToRunInput` extrai URLs de `urlsText` separadas por espaço ou vírgula e junta com as URLs da instrução, sem duplicar;
  - `stageLabel('reviewer', 1)` → `'Revisando (2/3)…'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `menuOptions.ts`, depois `menu.ts`. Este último fica sem testes automatizados, como previsto no spec.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 13: Verificação final e documentação

**Files:**
- Modify: `.env.example` (variáveis novas), `docs/relatorio-tecnico-melhorias.md` (marcar a Fase 2 e parte da Fase 5 como feitas), README se existir

- [ ] **Step 1:** `npm test` → todos passam; `npx tsc --noEmit` → limpo.
- [ ] **Step 2:** `grep -rn "webData\|RagService" src/graph` → nenhuma ocorrência nos nós.
- [ ] **Step 3 (precisa do OK do usuário, gasta tokens e créditos do Tavily):**
  - `npm start -- "<tema com URL>"` → `sources.md` com fatos citados, post aprovado e custo no `usage.json`;
  - `npm run ideas` → `ideas/AAAA-MM-DD.md` com 5 a 7 pautas e notificação na tela;
  - `npm start -- --idea 1` → post da pauta.
- [ ] **Step 4:** Repassar ao usuário os comandos `npm run ideas:schedule` e `npm start` (menu), para ele rodar.
