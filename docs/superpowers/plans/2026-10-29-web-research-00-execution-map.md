# Pesquisa web — mapa de execução e contratos

**Estado:** planos aprovados com “sim”; etapa01 concluída, extração02 pronta e gate de navegador02 não aprovado. [Decisão pendente](2026-10-29-web-browser-gate.md) antes de03/04. Método nativo/main preservado; sem commit/push/deploy ou instalador.

**Spec:** [desenho aprovado](../specs/2026-10-29-web-research-design.md).

## Ordem

1. [01 — rede e busca](2026-10-29-web-research-01-network-search.md).
2. [02 — leitura e navegador](2026-10-29-web-research-02-reader-browser.md). O teste de contenção do navegador é gate obrigatório, não tarefa para deixar no fim.
3. [03 — histórico cifrado](2026-10-29-web-research-03-history.md).
4. [04 — integração e aceite](2026-10-29-web-research-04-integration.md).

Planos01–03 são componentes locais testáveis; somente04 publica o módulo. Nenhum componente parcial deve aparecer como integração pronta. Progresso oficial: [registro](2026-10-29-web-research-progress.md).

## Restrições comuns

- Busca sem chave adicional; DuckDuckGo HTML, sem afirmar API oficial ou disponibilidade irrestrita. Sem troca automática para outro buscador, API paga, proxy rotativo, login ou solver de CAPTCHA.
- Main executa as quatro capacidades; Python continua o ciclo direto. Não restaurar Planner/execute_task nem alterar módulos anteriores.
- Licença72h e Total Control, sem confirmação por consulta. Autoridade antes da rede, de entregar resultado e de persistir; bloquear cancelamento/revogação e sessão/revisão antiga.
- HTTP/HTTPS, portas80/443, URL até4.096 caracteres, sem credenciais. Cinco redirects, DNS fixado à conexão, inclusive recursos do navegador. Sem proxy/servidor local do produto.
- Busca500 caracteres/5 resultados/15s. Resposta2MiB transferida e2MiB descomprimida; texto48KiB UTF-8. Leitura30s, HTTP inicial8s, navegador15s, um navegador ativo, até40 requisições/10MiB por página; espera na fila conta no prazo.
- Histórico10 pesquisas, três últimas páginas distintas por pesquisa, payload JSON de256KiB antes da cifragem. Resumo4.000 caracteres; recibo5min, uso único, no máximo30 pendentes.
- Sem HTML, imagens, cookies, tokens de sessão ou scripts no histórico. Sem recibo ou texto bruto em logs/eventos visuais. Dados remotos e resumo da IA não concedem autoridade nem comprovam verdade factual.
- Manter ambiente/dev build e alterações pré-existentes. Pacotes antigos foram removidos na limpeza; não regenerar release para estes planos. Testes Electron usam dependência instalada, perfil temporário e fixtures.

## Contratos compartilhados

### Plano01 — DTOs compartilhados e contratos internos

Criar `src/shared/types/web-research.ts` para WebCode/SearchHit/SearchOutcome e exportar em src/shared/index.ts. `src/main/modules/web-research/contracts.ts` contém WebScope, SafeHttpResponse/WebTransport e reexporta os DTOs para consumidores Main. O shared nunca importa módulos do Main. Plano02 acrescenta WebPage/ReadOutcome no arquivo shared; plano03 acrescenta histórico/recibos.

- `WebScope = { signal: AbortSignal; deadline: number; check(): void }`; deadline absoluto em ms, clock injetável nos testes. check valida autoridade e prazo, não apenas AbortSignal.
- `WebCode`: união fechada `blocked_url | blocked_access | rate_limited | layout_changed | network_unavailable | timeout | too_large | unsupported_content | render_unavailable | cancelled | history_unavailable | history_changed | invalid_receipt`.
- `SearchHit = { title: string; url: string; snippet: string }`; título512 caracteres, snippet2.000, URL4.096; no máximo5 resultados.
- `SearchOutcome = { state: 'ok'|'empty'|'blocked'|'unavailable'; query: string; results: SearchHit[]; queriedAt: string; code?: WebCode }`.
- `SafeHttpResponse = { url: string; status: number; headers: Record<string,string>; body: Uint8Array }`; URL final após redirects; body já descomprimido dentro do limite. Nunca contém Set-Cookie.
- `WebTransport.fetch(url: string, scope: WebScope, options?: { method?: 'GET'|'HEAD'; accept?: string }): Promise<SafeHttpResponse>`.

### Plano02 — DTOs shared e contracts internos estendidos

- `WebPage = { title: string; url: string; text: string; fetchedAt: string; publishedAt: string|null; mode: 'http'|'browser'; truncated: boolean }`; datas publicadas só ISO válido presente na fonte, inclusive data civil sem hora, sem inventar timezone.
- `ReadOutcome = { state: 'ok'|'partial'|'blocked'|'unavailable'; page: WebPage|null; code?: WebCode }`.
- `WebReader.read(url: string, mode: 'auto'|'http'|'browser', scope: WebScope): Promise<ReadOutcome>`; browser solicitado explicitamente continua sob todas as barreiras de rede/acesso.

### Plano03 — `src/shared/types/web-research.ts`

- `ResearchState = 'running'|'complete'|'partial'|'blocked'|'unavailable'|'cancelled'`.
- `WebResearchRecord = { id: string; sequence: number; createdAt: string; updatedAt: string; state: ResearchState; query: string; results: SearchHit[]; pages: WebPage[]; summary: string|null; summaryState: 'pending'|'available'|'unavailable' }`.
- `ResearchHandle = { id: string; generation: number; storage: 'saved'|'volatile' }` é interno ao Main; não confiar em handle recebido do modelo.
- `WebHistoryItem = Omit<WebResearchRecord,'pages'> & { pageCount: number }`.
- `HistorySnapshot = { generation: number; storage: 'saved'|'volatile'|'unavailable'; items: WebHistoryItem[] }`, ordenação decrescente, no máximo10.
- `SummaryReceipt = { researchId: string; ticket: string; sessionId: number; expiresAt: number }`; UUID em researchId, ticket aleatório32bytes codificado em64hex, relógio não pode voltar antes da emissão.
- `WebResearchNote = { researchId: string; ticket: string; sessionId: number; summary: string }`. Validar chaves exatas; resumo até4.000 caracteres; note não altera state, pages ou results.

### Plano04 — quatro capacidades

| ID | Entrada estrita | Timeout | Permissão |
| --- | --- | --- | --- |
| web_search | `{query:string}` | 15.000ms | web.search |
| web_read | `{url:string, mode?:'auto'|'http'|'browser', researchId?:string}` | 30.000ms | web.read |
| web_history_list | `{}` | 5.000ms | web.history |
| web_history_get | `{id:string}` | 5.000ms | web.history |

`WebCapabilityData` é união discriminada por `kind`:
- search: `{kind:'search', researchId:string, historyStorage:'saved'|'volatile', outcome:SearchOutcome, _historyReceipt?:SummaryReceipt}`.
- read: `{kind:'read', researchId:string, historyStorage:'saved'|'volatile', outcome:ReadOutcome, _historyReceipt?:SummaryReceipt}`.
- history_list: `{kind:'history_list', snapshot:HistorySnapshot}`.
- history_get: `{kind:'history_get', record:WebResearchRecord|null}`.

Recibo opcional somente em search/read registrados nesta sessão. A chave `_historyReceipt` será removida antes de enviar dados ao modelo. Ausência de histórico protegido não impede pesquisa; usar registro volátil limitado, nunca persistir plaintext.

`WebResearchService.execute(id:string,args:unknown,context:ExecutionContext,signal:AbortSignal):Promise<WebCapabilityData>`, `verify(context,id,result):CapabilityResult`, `releaseObservation(invocationId):void`, `stop():Promise<void>`.

### Canal e APIs do painel

- hello_ack acrescenta `webResearchRuntimeVersion:1`. Main não anuncia capacidades web a sidecar sem essa feature: não deixar backend antigo enviar recibos ao modelo.
- Sidecar→Main: `web_research_note`, payload WebResearchNote; não encaminhar ao renderer. Main aceita somente sessão atual e recibo emitido para ela. Sem ack bloqueando a resposta do modelo; UI permanece pending/unavailable se nota não chegar.
- IPC: `web-research:history-list` (sem payload), `history-get` (`{id}`), `history-clear` (`{expectedGeneration}`), `test` (sem payload, ação manual de rede), `open-source` (`{id,url}`), `changed` (evento sem conteúdo), `sources` (evento de metadados sem texto/recibo).
- `WebResearchAPI`: `listWebResearch():Promise<HistorySnapshot>`, `getWebResearch(id:string):Promise<WebResearchRecord|null>`, `clearWebResearch(expectedGeneration:number):Promise<HistorySnapshot>`, `testWebResearch():Promise<SearchOutcome>`, `openWebResearchSource(id:string,url:string):Promise<void>`, `onWebResearchChanged(callback:()=>void):()=>void`, `onWebResearchSources(callback:(sources:WebSources)=>void):()=>void`.
- Gestão local de histórico exige renderer confiável, licença e consentimento, mesmo com switch desligado; ferramentas da IA só existem com módulo ativo. test exige também módulo ativo, consulta fixa pública “Electron documentation”, sem inserir no histórico. Nenhuma chamada de teste ao abrir/diagnosticar a tela.
- `WebSources = {researchId:string; query:string; consultedAt:string; sources:Array<{title:string;url:string}>}`; no máximo5, obtidos de resultado validado no Main. Clique é ação explícita do usuário, URL deve pertencer ao registro e passar validação HTTP/HTTPS, sem protocolos locais/credenciais.

## Regras de ligação entre componentes

Somente pesquisas abertas nesta sessão nos últimos cinco minutos podem receber páginas por researchId; IDs recuperados de histórico antigo são somente leitura. Pedido por informação atual cria pesquisa nova, não reescreve a data da anterior. Nota final aceita fecha a associação ativa; resultado de leitura tardio revalida antes de anexar. Registro volátil não é promovido silenciosamente para disco se a cifragem voltar durante a rodada.

O serviço03 de disco não contém fallback plaintext. O serviço04 mantém contextos temporários limitados para consultas enquanto o histórico protegido estiver indisponível. list retorna storage:unavailable com geração e aviso (sem declarar histórico vazio), preservando os ciphertexts anteriores; clear explícito pode removê-los logicamente sem decriptar.

`WebModuleStatus={health:ModuleSnapshot['health'];lifecycle:ModuleSnapshot['lifecycle'];storage:'saved'|'volatile'|'unavailable';errorCode?:string;lastNetworkCode?:WebCode}`. Falha de armazenamento isolada não desliga consulta em memória; ausência de feature/bridge pronto faz runtime unavailable. Painel usa esses campos, não presume que importação da classe comprova conectividade.

## Gate e retomada

Etapa01 executada com19 testes de domínio e verify394/394; dependências diretas HTML promovidas. Testes e comandos02–04 continuam futuros, migração009 não aplicada. Aprovação dos planos e método nativo preservados. Mudança estrutural necessária para isolamento do navegador ou busca pública bloqueada volta ao usuário, sem reduzir silenciosamente o escopo aprovado. Evidências no progresso oficial.
