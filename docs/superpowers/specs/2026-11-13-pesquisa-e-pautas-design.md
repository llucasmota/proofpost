# Desenho — Pesquisa com fontes (Fase 2) e Sugestão de pautas (Fase 5)

Data: 2026-11-13 · Projeto: `content-builder` (LangGraph JS, Node 24, TS executado via `tsx`)

## 1. Intenção e porquê

O dono do projeto quer postar no LinkedIn **3 a 5 vezes por semana**, alternando posts **rápidos**
(comentar uma novidade/feature de algo que usa) e **aprofundados** (post técnico completo). Dois
bloqueios hoje:

1. **Posts imprecisos/genéricos.** Sem URL no comando, o especialista escreve de memória (o RAG do
   Pinecone está vazio e desligado). Com URL, o HTML vira texto por regex (menus, cookies), é cortado
   em 12k caracteres e é baixado de novo a cada rodada de revisão, dentro de cada especialista.
2. **Não sabe o que postar.** Quer **sugestões ativas** que venham com material para **aprender o
   assunto antes de postar** — não só um título.

Prioridade declarada: post mais assertivo mesmo que demore mais; **custo baixo por execução** (não
pode gastar alguns dólares/reais por run).

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Pesquisa roda **uma vez por run**, antes da escrita, e produz uma **FactSheet** usada pelo redator
  e pelo revisor.
- Funcionar com: só URL(s), só contexto do usuário, os dois, ou nenhum (aí a busca Tavily é a fonte).
- `npm run ideas` gera um arquivo de sugestões com mini-estudo por pauta; agendado no Mac (launchd).
- Escolher uma sugestão e gerar o post a partir dela com um comando.

**Não-objetivos (ficam para outras fases)**
- Brief/roteiro do post e reorganização dos especialistas (Fase 3).
- Fact-check afirmação por afirmação, validação de código por compilador, editor separado (Fase 4).
- Interrupções de aprovação dentro do grafo (`interrupt()`/checkpointer) — a escolha da pauta é feita
  fora do grafo, lendo o arquivo.
- Rodar na nuvem (GitHub Actions) — possível depois; o desenho não deve impedir.
- Recuperar o Pinecone/RAG.

**Anti-objetivos (falha mesmo que "funcione")**
- A FactSheet conter fatos cujo trecho não existe na fonte (citação inventada).
- A busca complementar sobrepor o que a URL/contexto do usuário diz.
- O contexto colado pelo usuário ser reescrito/resumido pelo `promptOptimizer` antes de virar fonte.
- Um run de pautas custar mais que centavos, ou gastar o plano gratuito do Tavily em poucos dias.
- Sugestões repetindo temas já postados.

## 3. Restrições

- Chave nova: `TAVILY_API_KEY` no `.env` (o usuário criou a conta; a chave ainda não está no `.env`).
  Sem chave, tudo continua funcionando com URL/contexto e o download local.
- LLM sempre via `createRoleServices()` / `FallbackLlmService` existentes (Gemini direto →
  OpenRouter Gemini → DeepSeek). Pesquisa e ranking usam um papel barato (ver 5.3).
- Uso de tokens deve continuar registrado no `usageTracker` (e no `usage.json`).
- O diretório **não é um repositório git** hoje.
- Testes unitários com `node --test` (sem rede); chamadas reais só em `test:integration`.
- Mac do usuário: macOS, Node 24; o job agendado não pode depender de um terminal aberto.

## 4. Abordagens consideradas

**Fonte dos fatos quando não há URL**
- *API de busca dedicada (Tavily)* — devolve URLs + conteúdo bruto, ideal para trechos literais.
  **Escolhida** (o usuário criou a conta).
- *Google Search grounding do Gemini* — usa a chave existente, mas devolve resposta sintetizada com
  links de redirecionamento, sem o texto das páginas; difícil montar citações literais. Descartada.
- *Sem busca* — só URL do usuário. Descartada: o usuário quer que funcione também sem URL.

**Onde o agendamento de pautas roda**
- *launchd no Mac* — custo zero, nada a hospedar; roda ao acordar se o Mac dormia no horário; não roda
  com o Mac desligado. **Escolhida pelo usuário.**
- *GitHub Actions* — roda com o Mac desligado, entrega como issue; exige criar repo e secrets. Fica
  para depois; mesmo comando `npm run ideas`, então migrar é só configuração.

## 5. Desenho

### 5.1 Entrada do comando (CLI)

`npm start` passa a aceitar:

```
npm start "<instrução>"                         # como hoje
npm start -- "<instrução>" --context notas.md   # contexto vindo de arquivo (repetível)
npm start "<instrução com URL>
CONTEXTO:
<texto colado livremente>"                      # contexto inline, tudo depois da linha CONTEXTO:
npm start -- --idea 3                           # usa a pauta nº 3 do arquivo de ideias mais recente
npm start -- --idea 3 --ideas-file ideas/2026-11-16.md
```

- *(decisão do desenho)* O `--` é necessário porque o npm consome flags como `--idea` sozinho. A forma
  documentada (e impressa no arquivo de ideias) é com `--`. Como rede de segurança, o parser também
  lê `process.env.npm_config_idea` / `npm_config_context` quando o usuário esquecer o `--`.

- O parser (função pura, testável) separa: `instruction` (texto antes de `CONTEXTO:`),
  `userContext[]` (bloco inline + arquivos), `urls` (extraídas da instrução).
- Novos campos no state: `userContext: string[]`, `sourceUrls: string[]`. `initialCommand` recebe
  **só a instrução**; o `promptOptimizer` nunca vê o contexto colado.
- `--idea N`: lê o arquivo de ideias, monta a instrução a partir do ângulo + tipo da pauta e usa os
  links da pauta como `sourceUrls`. A pauta já traz o **nicho** (`flutter_dart | node_react |
  ai_engineering`) e um slug: o orquestrador é pulado nesse caso (evita uma pauta de IA ser
  classificada `out_of_scope`).
- *(decisão do desenho)* **Tipo do post nesta fase:** novo campo `postType: 'quick' | 'deep'`
  (padrão `deep`; `--idea` usa o da pauta; `--quick` força). Ele só acrescenta uma regra de tamanho
  e profundidade aos prompts dos especialistas e do revisor — *quick*: ~80–150 palavras, uma ideia
  central, código opcional; *deep*: como hoje. Formatos de verdade ficam na Fase 3.

### 5.2 Nó `research` (novo), uma vez por run

Posição: `promptOptimizer → orchestrator → research → especialista`. Para `out_of_scope` não roda.
Os três especialistas **deixam de baixar URLs** e de chamar o RAG; usam o que está no state.
Rodadas de reescrita não refazem a pesquisa.

Passos:
1. **Coletar fontes** (`SourceDoc { id, kind: 'user_context' | 'user_url' | 'search', url?, title?,
   publishedAt?, text }`):
   - `user_context`: cada bloco de contexto, como está.
   - `user_url`: Tavily Extract para as URLs; se falhar/sem chave, cai no `fetchUrlContent` atual.
   - `search` (Tavily Search), conforme `RESEARCH_SEARCH` no `.env`:
     - `auto` (padrão): sem fonte do usuário **utilizável** (nenhum contexto e nenhuma URL baixada com
       sucesso) → busca principal (até 5 resultados, conteúdo bruto incluído); com fonte do usuário →
       **uma** busca complementar curta (até 3 resultados) para confirmar versões/datas.
     - `always` / `never` como os nomes dizem.
   - A query de busca é gerada a partir da instrução otimizada + nicho (curta, sem regras de
     formatação — o problema da query atual do RAG).
   - Preferir domínios oficiais por nicho (lista em config) quando a API permitir.
2. **Montar a FactSheet** com uma chamada LLM estruturada:
   `Fact { claim, sourceId, quote, publishedAt? }`, mais `gaps: string[]` (o que a instrução pede e
   as fontes não cobrem).
   - Ordem de autoridade: `user_context` = `user_url` > `search`. *(decisão do desenho)* Quem detecta
     contradição é o LLM: cada `Fact` tem `contradictsUserSource: boolean`; o **código** descarta os
     fatos de `search` marcados assim (é isso que o teste unitário cobre).
3. **Verificação determinística**: cada `quote` precisa existir no `text` da fonte citada (comparação
   normalizada: espaços, aspas tipográficas, caixa). Fatos que falham são descartados e contados no
   log.
4. Grava no state `sources: SourceDoc[]`, `factSheet: Fact[]`, `researchGaps: string[]`,
   `researchStatus: 'ok' | 'no_sources'`.
   *(decisão do desenho)* `no_sources` = a FactSheet final está **vazia**, qualquer que seja o motivo
   (nenhuma fonte, todas as chamadas LLM falharam, ou todas as citações reprovaram). Se havia fontes
   mas a FactSheet falhou, os textos das fontes ainda vão para o redator.

Textos de fonte muito longos: em vez de cortar no começo, o builder escolhe um limite por fonte e uma
forma de não perder a parte relevante (ex.: priorizar parágrafos que mencionam termos da instrução).

### 5.3 Modelos

- Novo papel `researcher` no `config.ts` (mesma cadeia do otimizador: Gemini 2.5 Flash direto →
  OpenRouter Gemini 2.5 Flash → DeepSeek; temperatura 0). Usado pela FactSheet e pelo ranking de
  pautas. Sobrescrevível por `LLM_CHAIN_RESEARCHER`.

### 5.4 Redator e revisor

- O prompt do especialista recebe `[FACT_SHEET]` (lista numerada com fonte e data) e `[GAPS]`; a regra
  passa a ser: afirmações técnicas específicas (versões, flags, nomes de API, números) só se
  estiverem na FactSheet; o resto é opinião/experiência e deve soar como tal.
- Trechos das fontes também vão ao redator, mas a FactSheet é a referência principal.
- O revisor recebe **a mesma** FactSheet no lugar do `webData` bruto, e a regra de rejeitar afirmação
  técnica que não esteja nela.
- `researchStatus: 'no_sources'` → o revisor roda em **modo sem fatos**: não exige FactSheet, revisa
  só estilo, formato e erros técnicos evidentes (como hoje sem `webData`). Assim não gasta 3 rodadas
  de Sonnet rejeitando tudo. O post aprovado é salvo com aviso **"NÃO VERIFICADO: nenhuma fonte
  encontrada"** no topo do `linkedin_post.txt`.
- O campo `webData` e o código de fetch dentro dos especialistas são removidos.

### 5.5 Saída do post

Na pasta do post, além do que já existe: `sources.md` com a lista de fontes (tipo, URL, data) e os
fatos com citação, e as lacunas.

### 5.6 Sugestão de pautas — `npm run ideas`

Script separado do grafo do post (pode ser um pequeno grafo ou funções em sequência — escolha do
builder).

1. **Coleta sem LLM** de uma lista em config (`src/discovery/sources.ts`): feeds RSS/Atom de blogs
   oficiais e `releases.atom` do GitHub dos pilares — Flutter/Dart, Node.js, React/Next.js,
   TypeScript, LangChain/LangGraph JS, provedores de LLM. O builder confirma as URLs dos feeds. Só
   itens dos últimos 7 dias (configurável).
2. **Tavily Search** com tópico de notícias, janela de 1 semana, **uma busca por nicho** (3 buscas:
   `flutter_dart`, `node_react`, `ai_engineering`), cada uma cobrindo as tecnologias monitoradas
   daquele nicho (lista em config, ver 5.10).
3. **Dedupe** contra `ideas/history.json`, por URL e por similaridade de título.
   *(decisão do desenho)* O histórico registra: (a) pautas sugeridas; (b) **todo post salvo** — o
   `imageExtractor` acrescenta `{data, título = instrução, slug, nicho, URLs das fontes}`, seja via
   `--idea` ou `npm start` normal. Na primeira execução, as pastas existentes em `output/` são
   importadas como histórico (slug + texto do `linkedin_post.txt`, para ter o que comparar além do
   slug curto). Pauta sugerida e não escolhida pode reaparecer no máximo mais uma vez. O LLM de
   ranking recebe os títulos do histórico para evitar repetição semântica.
4. **Ranking LLM** (papel `researcher`) com rubrica: relevância para os pilares, novidade real,
   substância técnica, se dá para aprender o básico em ~30 min. Saída: **5 a 7 pautas**, com
   mistura de tipos (rápido/aprofundado).
5. **Arquivo `ideas/AAAA-MM-DD.md`**, por pauta:
   - nº, título, pilar, tipo sugerido (rápido | aprofundado)
   - o que é (3–4 linhas)
   - por que importa para quem usa a stack
   - para estudar: 2–3 links (oficial primeiro) com uma linha sobre cada
   - ângulo sugerido para o post
   - comando pronto: `npm start --idea N`
   Os links e o ângulo também vão num bloco JSON no fim do arquivo (ou `ideas/AAAA-MM-DD.json`) para
   o `--idea` ler sem parse de markdown.
6. **Notificação macOS** ao terminar ("5 pautas novas") via `osascript`; falha silenciosa em outros SOs.
7. Grava `usage.json`/custo do run de ideias também (no `ideas/`).

### 5.7 Agendamento no Mac (launchd)

- `scripts/install-ideas-schedule.sh` gera e carrega `~/Library/LaunchAgents/<label>.plist` com
  `StartCalendarInterval` em **segunda, quarta e sexta às 8h** (horário e dias por variável no topo
  do script), `WorkingDirectory` = pasta do projeto, logs em `ideas/logs/`.
- `scripts/uninstall-ideas-schedule.sh` remove.
- O job usa o caminho absoluto do `node`/`npx` (launchd não carrega o PATH do shell) e o `.env` do
  projeto.
- O usuário roda o script de instalação ele mesmo (altera a configuração do Mac dele).

### 5.8 Configuração nova (`.env.example`)

`TAVILY_API_KEY`, `RESEARCH_SEARCH=auto|always|never`, `LLM_CHAIN_RESEARCHER` (comentado),
`IDEAS_LOOKBACK_DAYS=7`.

### 5.9 Custo esperado

- Por post: + 1 chamada LLM barata (FactSheet) + 0–2 chamadas Tavily (busca + extract). O texto das
  fontes aumenta a entrada do redator/revisor; o Sonnet continua sendo o maior custo.
- Por run de ideias: 3 buscas Tavily + 1 chamada LLM de ranking. Três runs por semana devem caber no
  plano gratuito do Tavily — o builder confirma o custo em créditos de cada endpoint usado.

### 5.10 Tecnologias monitoradas

Lista em `src/discovery/sources.ts`, agrupada pelos três nichos; cada pauta no arquivo traz o nicho.
Confirmada pelo usuário (pode crescer depois):
- `flutter_dart`: Flutter, Dart, Firebase/FlutterFire, Riverpod, Bloc.
- `node_react`: Node.js, React, Next.js, TypeScript, Vite.
- `ai_engineering`: LangChain/LangGraph JS, APIs de LLM (Gemini, OpenAI, Anthropic, OpenRouter), MCP,
  Google ADK, LiteRT/IA no navegador.

### 5.11 Terminal interativo (substitui digitar comandos no dia a dia)

Pedido do usuário: um modo interativo no terminal, como já fez em Python, para não decorar comandos.

- `npm start` **sem argumentos** abre um menu interativo; com argumentos/flags continua como 5.1
  (necessário para o launchd e scripts). Script extra `npm run app` como atalho do menu.
- Biblioteca *(decisão do desenho)*: `@clack/prompts` — menus, seleção, texto, confirmação e spinner
  com pouco código. Ink (React no terminal) foi descartado: mais poder do que o necessário.
- Fluxo:
  ```
  ◆ O que você quer fazer?
  │ ● Escrever post a partir de uma pauta da semana
  │ ○ Escrever post sobre um tema meu
  │ ○ Buscar pautas agora
  │ ○ Sair
  ```
  - *Pauta da semana*: lista as pautas do arquivo mais recente (título · nicho · tipo); ao escolher,
    mostra o mini-estudo e os links, e pergunta "Escrever o post agora?" (ou volta à lista).
  - *Tema meu*: pede a instrução; URLs opcionais; contexto opcional — "colar no editor" abre um
    arquivo temporário no editor do usuário (`$EDITOR`, padrão `nano`) porque colar várias linhas
    num prompt de terminal é frágil; ou caminho de um arquivo. Depois pergunta o tipo (rápido |
    aprofundado).
  - Durante o run: spinner com a etapa atual (pesquisa, escrita, revisão 1/3…); os logs detalhados
    continuam, mas vão para `output/<slug>/run.log` em vez de poluir a tela.
  - No fim: caminho da pasta, se foi aprovado/não verificado, custo estimado, e "Abrir a pasta?"
    (`open` do macOS).
  - *Buscar pautas agora*: roda o mesmo código do `npm run ideas` e cai na lista de pautas.
- O menu só chama as mesmas funções da CLI; nenhuma lógica nova de geração mora nele.
- Testes: a montagem das opções e o mapeamento escolha → parâmetros do run são funções puras e
  testadas; a interação em si não é testada automaticamente.

## 6. Testes

- Unitários (sem rede): parser da CLI; verificação de citação (normalização); ordem de autoridade e
  descarte de contradição; montagem do prompt com/sem FactSheet; dedupe de pautas; geração do
  markdown/JSON de ideias; leitura de `--idea N`; geração do plist.
- Fakes para Tavily e LLM, no mesmo estilo de `tests/llmProvider.test.ts`.
- Integração (opcional, rede): um run de `research` real e um `npm run ideas` real.

## 7. Deixado para o builder

- Usar o SDK do Tavily ou `fetch` direto na REST API (verificar a API atual).
- Estratégia de limite de texto por fonte.
- Normalização exata da comparação de citações.
- Pequeno grafo vs. funções simples para o `ideas`.
- Lista inicial exata de feeds (confirmar que existem).
- Formato exato do bloco JSON das ideias.
