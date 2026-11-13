# Relatório Técnico — `langgraph-critic-rag-builder`

> Análise do estado atual (commit `873e695`) e roadmap de melhorias.
> Objetivo: **posts mais assertivos, mesmo que o pipeline fique mais lento**, com descoberta de pautas, especialização mais adequada e troca de modelos confiável.

---

## 1. Como o sistema funciona hoje

### 1.1 Fluxo do grafo (`src/graph/graph.ts`)

```
START → promptOptimizer → orchestrator ──┬─ flutterSpecialist ─┐
                                         ├─ nodeReactSpecialist ┼→ reviewer ─┬─ aprovado / reviewCount≥3 → imageExtractor → END
                                         ├─ aiSpecialist ───────┘            └─ reprovado → volta ao mesmo specialist
                                         └─ out_of_scope → imageExtractor
```

| Nó | O que faz | Observação |
|---|---|---|
| `promptOptimizer` | Reescreve o comando do usuário (remove contradições, força linguagem) | Só "limpa" o prompt; não gera pauta, ângulo nem fontes |
| `orchestrator` | Classifica em 1 de 3 nichos + gera slug | Se o LLM falhar, cai **silenciosamente** em `node_react` |
| `*Specialist` (×3) | RAG Pinecone + fetch das URLs do comando + gera `technicalDraft` e `codeSnippets` | Os 3 arquivos são ~95% idênticos |
| `reviewer` | Fact-check **e** reescrita para LinkedIn **e** hashtags numa única chamada | O texto final é escrito pelo próprio revisor e nunca é revisado |
| `imageExtractor` | Salva `.txt`, snippets e gera PNG via Carbonara | Faz I/O, relatórios de erro e chamada HTTP externa |

### 1.2 Camada de LLM (`src/services/`)

- `ILlmService.generateStructured(system, user, zodSchema)` — boa abstração, única interface usada pelos nós.
- `FallbackLlmService` (`llmProvider.ts`): tenta **Gemini** (`gemini-2.5-flash`) e, se `success=false`, chama **OpenRouter** (`qwen/qwen3-coder-next`).
- `OpenRouterService`: `ChatOpenAI` apontando para OpenRouter, embrulhado em `createAgent` + `providerStrategy(schema)` só para obter structured output.
- `RagService`: Pinecone (`namespace: posts-content`, filtro por `niche`, top-4), embeddings `gemini-embedding-001`.
- `webContentService`: `fetch` + regex que remove tags HTML, corta em 12k chars.

### 1.3 Amostra dos resultados (`output/`)

Lendo os posts gerados, os padrões de qualidade são:
- **Genéricos e com clichês de LLM** ("The frustration is real", "Here's the hard truth", emojis ✅🤖💸).
- **Sem opinião/experiência própria** — o texto resume a fonte, não acrescenta visão de quem escreve.
- **Conteúdo raso quando a fonte é rasa**: `flutter-genui` termina dizendo que as instruções "estão no Get started" — preenchimento, não valor.
- **Afirmações temporais arriscadas**: `adk-20-agentic-workf` diz "Google launched ADK 2.0 earlier this month" — relativo à data de geração, não da publicação.
- **Colisão de pastas**: slugs truncados em 20 chars (`adk-20-agentic-workf`) e runs com o mesmo slug sobrescrevem as anteriores.

---

## 2. Diagnóstico por problema que você levantou

### 2.1 "Tenho dificuldade em achar matérias e criar um prompt adequado"

**Causa raiz:** o pipeline começa *depois* da parte mais difícil. Ele assume que você já tem (a) a pauta, (b) as fontes e (c) um prompt bem escrito. O `promptOptimizer` só higieniza o texto — ele não decide **ângulo, público, gancho, tese, nem quais fatos sustentam o post**.

Além disso, a obtenção de fontes é frágil:
- Só busca URLs que **você colar** no comando (`extractUrls`). Sem URL, o especialista escreve de memória + RAG.
- O RAG consulta um índice Pinecone **sem script de ingestão no repositório** — não há como saber se está atualizado. Para notícias/releases (a maioria dos seus outputs), um índice estático é quase inútil.
- A query do RAG é o **comando otimizado inteiro** (com regras de formatação, linguagem, etc.), o que degrada a similaridade semântica.
- Extração HTML por regex traz menus, cookies e boilerplate; sites com JS/SPA retornam quase nada.

### 2.2 "A divisão dos especialistas pode estar ruim"

Sua intuição está certa, mas o problema é **o eixo da divisão**, não só a granularidade.

O que realmente muda entre os 3 especialistas hoje:
1. linguagem do código (Dart / TS / TS-ou-Python),
2. algumas frases de persona,
3. o filtro de nicho no Pinecone.

Todo o resto (grounding, anti-alucinação, modo cirúrgico, fetch de URL) é **copiado e colado** nos três nós e nos três prompts. Ou seja: são o *mesmo agente* com três configurações diferentes.

O que mais afeta a qualidade de um post **não é a stack, é o formato/intenção**:

| Formato | Precisa de | Exemplo nos seus outputs |
|---|---|---|
| **Notícia/Release explicada** | fontes oficiais, datas, "o que muda pra mim" | `litertjs-web-ai`, `flutter-3-47`, `adk-20` |
| **Tutorial / how-to com código** | código compilável, passo a passo | `dependency-injection-tsyringe`, `bloc` |
| **Conceito / arquitetura / opinião** | tese forte, trade-offs, experiência pessoal | `agentic-workflows` |

Sobre Node × React especificamente: **são públicos diferentes** (backend vs frontend) com fontes oficiais, hashtags e vocabulários distintos. Separar faz sentido — mas separar criando *mais um nó copiado* vai piorar a manutenção. A solução é transformar domínio em **dados** (ver §3.2).

Outra limitação: a classificação é **single-label**. "LangGraph.js num backend Node" é `ai_engineering` *e* `node_react`; hoje o orquestrador é forçado a escolher um.

### 2.3 "A troca entre o fallback e os modelos do OpenRouter não está 100%"

Encontrei causas concretas — algumas explicam diretamente a sensação de "às vezes demora muito / às vezes troca, às vezes não":

| # | Problema | Onde | Efeito |
|---|---|---|---|
| F1 | **Gemini retenta 6× antes de cair no fallback.** `ChatGoogleGenerativeAI` herda `maxRetries = 6` do `AsyncCaller` do LangChain, que **retenta 429** (inclusive `RESOURCE_EXHAUSTED` de cota diária do Gemini) com backoff exponencial. | `googleGeminiService.ts:15` | Com cota estourada, cada chamada pode travar por minutos antes de trocar. Parece que "não trocou". |
| F2 | **Sem circuit breaker.** Cada nó tenta Gemini de novo do zero. | `llmProvider.ts:20` | Se o Gemini caiu no início do run, *todos* os ~8–10 calls repetem o ciclo de F1. |
| F3 | **Sem timeout** nas chamadas LLM. | ambos os services | Uma chamada pendurada bloqueia o grafo indefinidamente. |
| F4 | **Nenhuma classificação de erro.** Erro de parse do Zod, 401, 429, 500 e timeout recebem o mesmo tratamento. | `llmProvider.ts:23-28` | Erro de schema (corrigível com retry no mesmo modelo) troca de provider; 401 (configuração) não aborta. |
| F5 | **OpenRouter sem fallback real:** `models: ['qwen/qwen3-coder-next']` tem um único modelo. | `config.ts:45-50` | Se o Qwen falhar, acabou — o nó lança exceção e o grafo morre. |
| F6 | **Structured output sem `require_parameters`.** Sem `provider.require_parameters: true`, o OpenRouter pode rotear para um provider que ignora `response_format` → JSON inválido → falha. | `config.ts:51-56` | Falhas intermitentes que dependem de qual provider o OpenRouter escolheu (sort por throughput). |
| F7 | **Mistura de modelos dentro de um mesmo run.** Orquestrador no Gemini, especialista no Qwen, revisor no Gemini… | design | Estilo e rigor inconsistentes; difícil reproduzir/depurar. Não há registro de qual modelo respondeu. |
| F8 | **Falhas silenciosas nos nós.** Orquestrador cai em `node_react`; revisor com erro vira "reprovação" com feedback `"System error during review, retry."` | `orchestratorNode.ts:17-20`, `reviewerNode.ts:52-58` | Post de Flutter roteado para o especialista Node; ou um rascunho bom é **reescrito do zero** por causa de um erro de rede. |
| F9 | `createAgent` instanciado a cada chamada só para obter JSON. | `openrouterService.ts:45` | Overhead e uma camada a mais de falha; `withStructuredOutput` resolve. |
| F10 | `@langchain/openai` é importado mas **não está no `package.json`** (vem transitivo). `@openrouter/sdk`, `@modelcontextprotocol/sdk` e `@langchain/community` estão declarados e **não são usados**. | `package.json` | Um `npm install` limpo pode quebrar o OpenRouterService. |
| F11 | `temperature: 0.7` para tudo, inclusive classificador e revisor. Default do Gemini no código ainda é `gemini-1.5-flash` (descontinuado). `OPENROUTER_HTTP_REFERER`/`X_TITLE` do `.env` são ignorados (hardcoded). | `config.ts`, `googleGeminiService.ts:9` | Classificação/revisão não determinísticas. |

---

## 3. Outros problemas encontrados (bugs e riscos)

| Sev. | Problema | Onde |
|---|---|---|
| 🔴 | `CRITICAL_FAILURE` é **código morto**: o revisor só checa `reviewCount >= 5`, mas a aresta encerra em 3. | `reviewerNode.ts:11` vs `edgeConditions.ts:20` |
| 🔴 | O **texto publicado (`postText`) é escrito pelo revisor e nunca é revisado**. O fact-check vale para o rascunho, não para o que vai pro LinkedIn. | `reviewerNode.ts:77` |
| 🔴 | Revisor vê `webData` truncado em **6k chars**; especialista recebe até **12k por URL**. O revisor reprova fatos que ele não consegue ver. | `reviewerNode.ts:48` |
| 🟠 | Em cada iteração o especialista **refaz RAG e re-baixa as URLs**. Lento, não determinístico (a página pode mudar/falhar no meio). | 3 nós especialistas |
| 🟠 | `codeContent.replace(/\\n/g, '\n')` corrompe código que tem `"\n"` literal em strings (ex.: `console.log("a\nb")`). | `imageExtractorNode.ts:90` |
| 🟠 | Extensão do snippet adivinhada por regex (`ts`/`py`/`dart`); React vira `.ts` em vez de `.tsx`. | `imageExtractorNode.ts:17` |
| 🟠 | Após 3 reprovações salva o **último** rascunho, não o **melhor**. | `imageExtractorNode.ts:74` |
| 🟠 | `approvedContent`/`corrections` antigos podem persistir no state entre iterações (sem reducer/limpeza explícita). | `reviewerNode.ts:67-68` |
| 🟡 | `factory.ts` exporta função que retorna `{ graph }`, não o grafo compilado — o `langgraph:serve`/Studio provavelmente não carrega. | `factory.ts:28` |
| 🟡 | `config.ts` tem `dbUri` com senha e banco `song_recommender` (sobra de outro projeto). | `config.ts:59` |
| 🟡 | Testes de orquestrador/optimizer chamam **LLM real** (lentos, pagos, flaky). Não há teste da camada de fallback. | `tests/` |
| 🟡 | README diverge do código (nó "Iterative RAG" separado não existe; Node v20 vs `engines >=24`). | `README.md` |
| 🟡 | Sem checkpointer → não dá para pausar, aprovar e retomar; um erro no último nó perde tudo. | `graph.ts:72` |

---

## 4. Proposta — arquitetura alvo

Princípio: **trocar velocidade por qualidade em pontos específicos**: pesquisa antes de escrever, validação determinística de código, fact-check por afirmação, editor separado do revisor, e você no loop nos momentos que importam.

```
                ┌──────────── Discovery (opcional) ────────────┐
 [modo pauta]   │ feeds/releases/HN → dedupe → rank → top 5    │──► interrupt(): você escolhe 1 + escreve 1 linha de opinião
                └──────────────────────────────────────────────┘
                                   │
 [modo comando] ───────────────────┤
                                   ▼
                    Research  (1x por run, resultado congelado no state)
                    fetch c/ Readability + busca web + RAG → FactSheet {claim, source, quote, date}
                                   ▼
                    Brief Builder  → PostBrief {formato, domínio(s), público, tese, gancho×3, fatos, precisa código?, linguagem}
                                   ▼   interrupt(): aprovar/editar o brief (opcional)
                    Writer (por FORMATO, configurado pelo DOMÍNIO)
                                   ▼
             ┌──── Code Validator (determinístico: tsc / dart analyze / py_compile) ──┐
             ├──── Fact Checker (claim-by-claim contra a FactSheet, temp 0, outra família de modelo)
             └──── loop até passar ou N iterações; guarda a MELHOR versão
                                   ▼
                    Editor LinkedIn (voz + few-shot dos seus melhores posts)
                                   ▼
                    Regression check (o editor não mudou/introduziu fatos?)
                                   ▼
                    Judge com rubrica (gancho, profundidade, originalidade, clareza, CTA) → score
                                   ▼   interrupt(): aprovação final
                    Packager (post.md, snippets tipados, PNGs, sources.md, meta.json)
```

### 4.1 Descoberta de pautas (resolve o problema nº 1)

Adicionar um **subgrafo `discovery`** que roda sob demanda (`npm run ideas`) ou agendado:

1. **Coletores** (sem LLM, baratos):
   - RSS/Atom de blogs oficiais: Node.js, React, Next.js/Vercel, TypeScript devblog, Flutter/Dart, LangChain, Google Developers, provedores de LLM.
   - GitHub Releases API: `nodejs/node`, `facebook/react`, `vercel/next.js`, `flutter/flutter`, `dart-lang/sdk`, `langchain-ai/langgraphjs`…
   - Hacker News (Algolia API) e dev.to com filtro por tags.
   - Uma API de busca web (Tavily, Exa, Brave) para aprofundar a pauta escolhida.
2. **Dedupe** contra um histórico local de posts já feitos (SQLite/JSON) — evita repetir assunto.
3. **Ranker LLM** com rubrica explícita: relevância para seus pilares, novidade, substância técnica (tem código/benchmark/mudança real?), "eu tenho algo a acrescentar?". Saída: top 5 com **ângulo sugerido** e por que vale postar.
4. **`interrupt()`**: você escolhe um e adiciona *uma linha* de opinião/experiência pessoal ("usei isso no projeto X e o problema foi Y"). **Essa linha é o que mais tira o post do genérico.**

Com isso o "prompt adequado" deixa de ser escrito por você: o **Brief Builder** gera um `PostBrief` estruturado (Zod) a partir da pauta + fontes + sua linha de opinião. O `promptOptimizer` atual vira desnecessário (ou se torna o Brief Builder no modo "comando livre").

Também criar `profile/` com:
- `persona.md` (quem você é, o que nunca dizer — hoje está duplicado em 4 prompts);
- `voice.md` (tom, comprimento, palavras banidas: "game-changer", "Here's the hard truth"…);
- `best-posts/*.md` — 3 a 5 posts **seus** que performaram bem, usados como few-shot pelo Editor.

### 4.2 Especialistas: domínio como dado, formato como agente

**Um único `createWriterNode`** parametrizado, no lugar de 3 nós copiados:

```ts
// src/domains/node-backend.ts
export const nodeBackend: DomainProfile = {
  id: 'node_backend',
  label: 'Node.js backend',
  languages: ['typescript'],
  codeValidator: 'tsc',
  officialSources: ['https://nodejs.org/en/blog', 'https://devblogs.microsoft.com/typescript/'],
  feeds: [/* RSS, GitHub repos */],
  personaNotes: 'Event loop, streams, workers, performance, testing...',
  hashtagPool: ['#NodeJS', '#TypeScript', '#Backend'],
  ragNamespace: 'node',
};
```

Domínios sugeridos: `flutter_dart`, `node_backend`, `react_frontend` (inclui Next.js), `ai_engineering` — adicionar um novo é criar um arquivo, sem tocar no grafo.

Formatos (cada um com prompt próprio, curto e focado): `news_explainer`, `tutorial`, `deep_dive_opinion`. O orquestrador passa a retornar `{ format, primaryDomain, secondaryDomains[] }` (multi-label), e o writer recebe a **composição** `prompt(formato) + profile(domínio) + persona + voz`.

Benefício: as regras de grounding/anti-alucinação ficam em **um** fragmento compartilhado (`prompts/shared/grounding.md`) em vez de três cópias que já divergem entre si (o prompt de AI não tem a seção de knowledge cutoff que os outros têm, por exemplo).

### 4.3 Camada de modelos confiável (resolve o problema nº 3)

Substituir `FallbackLlmService` por um **`ModelRouter`** com cadeia por papel:

```ts
// src/llm/roles.ts
export const roles = {
  classifier:  { chain: ['gemini:gemini-2.5-flash', 'openrouter:<modelo barato>'], temperature: 0 },
  writer:      { chain: ['openrouter:<modelo forte de escrita>', 'gemini:gemini-2.5-pro'], temperature: 0.7 },
  factChecker: { chain: ['<família DIFERENTE do writer>', '...'], temperature: 0 },
  editor:      { chain: ['openrouter:<modelo forte de escrita>'], temperature: 0.6 },
  judge:       { chain: ['<família diferente do writer>'], temperature: 0 },
};
```

Regras do router:
1. **`maxRetries: 1` e `timeout`** em cada client — o router controla retry, não o LangChain (corrige F1/F3).
2. **Classificação de erro** (corrige F4):
   - `429`, `5xx`, timeout, rede → próximo provider da cadeia;
   - erro de parse/validação Zod → **1 retry no mesmo modelo** com a mensagem de erro anexada ("seu JSON falhou em X, corrija");
   - `401/403` ou chave ausente → aborta com mensagem clara (configuração).
3. **Circuit breaker por run**: provider que deu 429/quota fica desabilitado por N minutos (corrige F2).
4. OpenRouter com **≥2 modelos em `models`** e `provider: { require_parameters: true, sort: 'throughput' }` (corrige F5/F6).
5. Usar `llm.withStructuredOutput(schema, { method: 'jsonSchema', includeRaw: true })` em vez de `createAgent` (F9) — `includeRaw` permite logar `response_metadata.model` e uso de tokens.
6. **Gravar no state `llmTrace: {node, provider, model, latencyMs, attempt}[]`** e escrever em `meta.json` do output (corrige F7 na parte de rastreabilidade).
7. Nós **nunca** caem em default silencioso (F8): falha do classificador → retry pela cadeia → se tudo falhar, erro explícito. Falha técnica do revisor **não** conta como reprovação.

Alternativa mais curta para começar: `model.withFallbacks([outro])` nativo do LangChain + `maxRetries: 1` + `timeout`. Resolve F1–F5 com ~30 linhas; o router completo vem depois.

### 4.4 Qualidade: o que mais aumenta assertividade (mesmo custando tempo)

Em ordem de impacto:

1. **Research uma vez, congelado** — fetch com `@mozilla/readability` + `jsdom` (ou um reader como Jina/Firecrawl para SPAs), busca web para corroborar, e uma **FactSheet** estruturada `{claim, sourceUrl, quote, publishedAt}`. Writer e revisor leem **a mesma** FactSheet (fim da assimetria 12k vs 6k).
2. **Validação de código determinística** — escrever os snippets num diretório temporário e rodar `tsc --noEmit` / `dart analyze` / `python -m py_compile`. Erros reais do compilador voltam para o writer. LLM revisando sintaxe é a parte mais fraca do revisor atual.
3. **Fact-check por afirmação** — revisor extrai cada claim do rascunho e marca `supported | unsupported | contradicted` com a fonte. Aprovação = zero `contradicted` e zero `unsupported` relevantes. Usar uma família de modelo **diferente** do writer (modelos tendem a aprovar o próprio estilo de erro).
4. **Correção cirúrgica aplicada por código** — como `originalText` já é verbatim, aplicar `draft.replace(originalText, suggestedReplacement)` deterministicamente e só chamar o LLM se a string não for encontrada. Elimina a etapa em que o revisor precisa copiar todo o `approvedContent` (caro e com perda).
5. **Separar Fact Checker de Editor** — hoje o mesmo prompt faz as duas coisas e o texto final não é checado. Depois do Editor, um *regression check* barato compara os claims antes/depois.
6. **Judge com rubrica numérica** (gancho, profundidade, originalidade, clareza, CTA, aderência à voz) e **guardar a melhor versão**, não a última.
7. **Datas absolutas** — proibir "this month/earlier this week"; usar a data da fonte da FactSheet.
8. **Human-in-the-loop real** com `MemorySaver`/`SqliteSaver` + `interrupt()` em: escolha da pauta, aprovação do brief, aprovação final. Permite retomar um run sem refazer tudo.

### 4.5 Organização do projeto

```
src/
  app/
    cli.ts                 # npm start "comando" | npm run ideas
  config/
    env.ts                 # env validado com Zod (falha cedo se faltar chave)
  graph/
    state.ts               # PostState + reducers explícitos
    main.graph.ts          # composição dos subgrafos
    subgraphs/
      discovery/           # coletores, dedupe, ranker
      research/            # fetch, search, rag, factSheet
      writing/             # brief, writer, code-validator, fact-checker, loop
      publishing/          # editor, regression, judge, packager
  domains/                 # flutter.ts, node-backend.ts, react-frontend.ts, ai.ts
  formats/                 # news-explainer.ts, tutorial.ts, deep-dive.ts
  llm/
    router.ts  errors.ts  roles.ts
    providers/gemini.ts  providers/openrouter.ts
  tools/
    fetchArticle.ts  webSearch.ts  feeds.ts  codeValidator.ts  carbonRenderer.ts
  prompts/
    v2/                    # .md por papel/formato
    shared/                # grounding.md, persona.md (fragmentos compostos)
profile/                   # persona.md, voice.md, best-posts/
evals/                     # golden set de pautas + rubricas (LangSmith já está no .env)
tests/                     # unitários com LLM fake; integração separada (npm run test:int)
```

Packager: pasta `output/YYYY-MM-DD-<slug>/` (sem truncar a 20 chars, sem sobrescrever), contendo `post.md`, `snippet_N.<ext correta>`, `snippet_N.png`, `sources.md`, `meta.json` (modelos usados, scores, iterações). O schema do especialista passa a devolver snippets tipados: `{ language, filename, code }` — acaba com a heurística de extensão e com o hack de unescape.

---

## 5. Roadmap sugerido

| Fase | Entrega | Esforço | Impacto |
|---|---|---|---|
| **0 — Correções rápidas** | F1/F3 (`maxRetries:1` + timeout), F5/F6 (2+ modelos, `require_parameters`), F8 (sem defaults silenciosos), bug do `>= 5`, assimetria 6k/12k, unescape de `\n`, deps no `package.json`, `dbUri` removido | ~1 dia | Alto na confiabilidade |
| **1 — Camada LLM** | `ModelRouter` com papéis, classificação de erro, circuit breaker, `llmTrace`, testes com providers fake | 2–3 dias | Alto |
| **2 — Research + FactSheet** | Readability, busca web, research único por run, FactSheet compartilhada | 2–3 dias | **Muito alto** na assertividade |
| **3 — Writer único + domínios/formatos** | `DomainProfile`, formatos, prompts compostos, multi-label, separar Node × React | 2–3 dias | Alto + manutenção |
| **4 — Pipeline de qualidade** | Code validator, fact-check por claim, correção cirúrgica por código, editor separado, judge, best-version | 3–4 dias | **Muito alto** |
| **5 — Discovery + HITL** | Coletores, ranker, histórico, `interrupt()` + checkpointer, `profile/` com few-shot | 3–4 dias | **Muito alto** (problema nº 1) |
| **6 — Evals** | Golden set de ~10 pautas, rubricas no LangSmith, comparar `prompts/v1` × `v2` | 1–2 dias | Garante que as mudanças melhoram de fato |

**Status (2026-11-13):** Fase 0 e Fase 1 concluídas (modelos por papel, fallback com circuit breaker, custo por run). Fase 2 concluída (pesquisa única por run com Tavily + FactSheet verificada, `sources.md`). Fase 5 parcial: sugestão de pautas (`npm run ideas`, agendável no Mac) e escolha via `--idea N` ou menu interativo; `interrupt()`/checkpointer e `profile/` com few-shot ainda pendentes. Desenho: `docs/superpowers/specs/2026-11-13-pesquisa-e-pautas-design.md`.

**Recomendação de ordem:** Fase 0 → 1 (para parar de perder runs) → 2 e 5 (que atacam diretamente "achar matéria" e "post genérico") → 3 → 4 → 6.

---

## 6. Pontos a confirmar

- **Pinecone**: o índice ainda é populado/atualizado? Se não, vale considerar trocar o RAG estático por busca web + cache local das fontes, e manter o vetor só para *seus posts antigos* (estilo e dedupe).
- **Carbonara** (`carbonara.solopov.dev`) é um serviço de terceiro sem SLA; alternativa local: renderizar com `shiki` + `satori`/`resvg` ou Playwright.
- **F1** foi confirmado lendo `@langchain/core` (`AsyncCaller`, `maxRetries` default 6, retenta 429 exceto `insufficient_quota`); vale confirmar nos logs/LangSmith de um run real em que o Gemini estava sem cota.
