# E-mails02 — OAuth e leitura multi-conta

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans após aprovação. Usar contratos00/01; não reinventar cofre/broker.

**Goal:** conectar contas e ler/pesquisar com isolamento e falhas parciais verdadeiras.
**Architecture:** OAuth no Main via navegador/loopback transitório, SDKs atrás de adaptadores injetáveis.
**Tech Stack:** quatro SDKs01, html-to-text10.0.1, tipos9.0.4.
**Spec:** [desenho](../specs/2026-10-28-email-design.md); [mapa00](2026-10-28-email-00-execution-map.md). Depende de01 concluído.

## Global Constraints

Tokens só Main, navegador externo, PKCE/state, prazo300000ms. Nenhum login real por teste automatizado. Busca50/página, texto102400 bytes com truncamento; dados voláteis. Nenhuma mutação ou catálogo email publicado nesta fase. Sem executável/commit/push.

## Review Focus

Callback repetido/errado, refresh após logout, HTML com recursos externos, cursor de outra consulta e uma conta throttled não podem expor tokens ou alegar busca completa. Cobertura nas Tasks1–3.

### Task1: login correlacionado, refresh e disconnect

**Files:** criar `src/main/modules/email/oauth-session.ts`, `auth.ts`, `google-auth.ts`, `microsoft-auth.ts`; testes `test/email-oauth.test.ts`, `test/email-auth.test.ts`.

**Interfaces:** implementar EmailAuth do00, consumindo vault/store/session01. `OAuthSession.begin({provider,buildAuthorizationUrl:(redirectUri,state,challenge)=>string},scope):Promise<{code:string,verifier:string,redirectUri:string}>`; dependências browser, random, clock e HTTP listener injetadas. Tokens trocados nos SDKs, não em código OAuth manual. `stop()` cancela todas as sessões, refreshes e listeners.

- [ ] **1 RED:** transporte OAuth sintético: callback state errado/path errado não resolve; callback certo resolve uma vez; cancelamento, relógio300000ms, revoke e close encerram listener; navegador não abre antes de escopo/config válidos. Refresh simultâneo mesma conta faz uma aquisição e persiste atomicamente; logout durante refresh impede retorno/persistência. Token expirado sem refresh retorna reauth_required, sem loop de login automático. Duas contas MSAL não compartilham seleção de activeAccount.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-oauth`; esperado FAIL antes do OAuthSession.
- [ ] **3 Implementar:** bind só127.0.0.1/porta0, callback com path aleatório + state criptográfico e PKCE S256. Resposta HTTP local sem tokens/código, sem refletir query, sem CORS. Google usa OAuth2Client, cache/refresh necessário; Microsoft PublicClientApplication e cache plugin persistido no cofre por conta. Identidade validada pelo fluxo/SDK antes de upsert; não confiar num JWT apenas decodificado ou email enviado pelo renderer. `scope.check` entre callback, troca, vault e retorno.
- [ ] **4 GREEN:** `npm.cmd test -- email-oauth`, `npm.cmd test -- email-auth`, typecheck; esperado PASS/exit0. Teste com listener loopback real usa servidor de provedor fake local e nunca browser/login do usuário.

### Task2: adaptadores de leitura e normalização limitada

**Files:** criar `src/main/modules/email/providers/gmail.ts`, `providers/outlook.ts`, `providers/sdk-transport.ts`, `message-text.ts`; testes `test/email-provider-read.test.ts`, `test/email-message-text.test.ts`; adicionar html-to-text/tipos e licenças.

**Interfaces:** implementar search/read/conversation/locations de EmailProvider00. `normalizeEmailText(input:{text?:string,html?:string}):{text:string,truncated:boolean}`. `EmailSdkTransport.request(method,path,body,scope):Promise<unknown>` é interface privada de teste; adaptadores reais a implementam usando SDK e URLs prefixadas fixas. Qualquer nextLink do Graph é validado contra origem/caminho permitidos antes do SDK.

- [ ] **1 RED:** Gmail multipart nested com texto e HTML, body base64url inválido, attachments que não são corpo; Graph HTML/script/imagem/URL remota; nenhuma rede de normalização. Assert `Buffer.byteLength(text)<=102400`, UTF-8 preservado, truncamento explícito. Message IDs iguais em contas diferentes retornam refs distintas; query com apóstrofo/&/CRLF não altera endpoint/filtro. Outlook solicita `Prefer: IdType="ImmutableId"` nas operações compatíveis, inclusive páginas; campos ausentes não viram fatos inventados.
- [ ] **1b RED conversa:** thread com6 mensagens exige páginas5+1 sem duplicação; cursor de outra conta/conversa rejeitado,6ª mensagem não entra no texto da primeira página. Consulta excedendo limite bruto de resposta falha explicitamente, sem chamar limite excedido de conversa vazia. Locations acima1000 falha com email_locations_limit_exceeded.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-provider-read`; esperado FAIL por adaptador ausente.
- [ ] **3 Implementar:** Gmail `users.messages.list/get` format full e lista de labels; conversa obtém IDs por threads.get com field mask sem corpos e lê até5 por página. Outlook `/me/messages`, filtro conversationId e mailFolders estáveis v1.0; normalizar datas/endereços e aplicar allowlist de campos. Não carregar corpos de todos os resultados antecipadamente. html-to-text sem fetch/execução de HTML; limitar profundidade MIME32 e partes1000, resposta de leitura bruta2MiB antes de processar; se exceder, erro limitado/truncamento, não crash. Não baixar anexos para obter corpo.
- [ ] **4 GREEN:** instalar exatos `html-to-text@10.0.1` e `@types/html-to-text@9.0.4` com --ignore-scripts, licenças; testar corpus sintético real contra normalizador. `npm.cmd test -- email-`, `npm.cmd run typecheck`; esperado exit0. APIs SDK mapeadas devem abortar requests pelo signal; import sem rede.

### Task3: agregação de contas, paginação e observações

**Files:** criar `src/main/modules/email/read-service.ts`, `cursors.ts`; testes `test/email-search.test.ts`, `test/email-read-scope.test.ts`.

**Interfaces:** EmailReadService00 e `EmailCursors.create(queryHash,accountRevisions,state):string`, `take(cursor,queryHash,accountRevisions):CursorState`, `clear():void`; TTL5min, até100 cursores por sessão, invalidação no disable/disconnect/close. Cursores nunca persistidos. Versões de leitura são handles vinculados à conta/message/contentHash/sessão, não concedem autoridade por si só.

- [ ] **1 RED:** duas contas com datas iguais: ordem receivedAt desc/accountId/messageId estável, página agregada<=50, sem duplicar/perder resultados ao avançar páginas. Uma conta503/429 gera partial:true e failures, não lista completa vazia. Cursor de outra query/sessão/revisão rejeitado; conta explícita desconectada falha sem fallback. Revogar enquanto read aguarda impede dado tardio e libera observação.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-search`; esperado FAIL antes do agregador.
- [ ] **3 Implementar:** merge de páginas com buffers limitados por conta e cursores privados; fanout no máximo2 por vez, deadline total30000ms por leitura, uma tentativa adicional só para GET idempotente em429/502/503/504 se Retry-After/delay couberem no prazo. Nenhuma fila infinita. Ler estados de conta no momento da busca; nenhum refresh chama conexão interativa.
- [ ] **4 GREEN e handoff:** `npm.cmd run verify`; esperado typecheck/testes/build exit0. Scanner sem conteúdo/segredos de fixture não ignorada. Atualizar progresso com testes reais executados, limitações e fase03. Sem alegar OAuth real ou acesso comercial validado.
