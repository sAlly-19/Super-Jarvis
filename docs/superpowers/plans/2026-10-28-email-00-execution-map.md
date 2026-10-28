# E-mails — mapa executivo e contratos

> **For agentic workers:** após revisão/aprovação dos planos, usar superpowers:executing-plans. Método nativo/main já escolhido; não perguntar novamente. Não implementar a partir de aprovação somente da especificação.

**Goal:** integrar Gmail e Outlook ao Jasper com múltiplas contas e efeitos verificáveis.
**Architecture:** SDKs no Main, OAuth desktop, cofre local e ferramentas do orquestrador existente.
**Tech Stack:** Electron44, TypeScript, SQLite Main, Python/stdio, SDKs oficiais.
**Spec:** [desenho aprovado](../specs/2026-10-28-email-design.md).

## Global Constraints

Especificação aprovada pelo usuário em28/10/2026. Planos abaixo aguardam revisão; nenhuma instalação/código de produto autorizado nesta rodada documental. Main preservada, sem commit/push. Executáveis só no fim ou quando um teste realmente exigir. Documentos adiado.

Total Control geral, sem confirmação por operação. OAuth é autorização do provedor; escolhas ambíguas continuam sendo esclarecidas. Sem conta real/API/envio por iniciativa do agente de desenvolvimento. Testes usam fixtures, perfis temporários e transportes injetados. Não publicar cadastros ou consentimento automaticamente.

Conta padrão para novos envios; resposta/ação presa à conta de origem. Busca por padrão em todas as conectadas, origem explícita e resultado parcial declarado. Nenhum fallback para conta diferente.50 resultados por página agregada,100KiB de texto por mensagem,10 anexos/10MiB originais por composição, sujeitos a limite menor do provedor. Login5min, fora das tarefas120s/8 etapas/2 revisões existentes.

Não espelhar caixas nem persistir corpos/assuntos/destinatários em tarefas/logs. Cofre separado e cifrado; tokens nunca vão ao renderer/Python/modelo. Bytes de anexos não entram no protocolo16MiB. Sem serviço/tray/polling automático de mensagens, exclusão permanente, envio em massa, delegação/aliases ou interpretação de anexos.

## Sequência e retomada

| Plano | Entrega verificável | Depende de |
| --- | --- | --- |
| [01 — Contas/cofre](2026-10-28-email-01-foundation.md) | Migração, isolamento, configuração e SDKs fixados | núcleo atual |
| [02 — Login/leitura](2026-10-28-email-02-oauth-read.md) | OAuth, refresh, pesquisa parcial e leitura segura |01 |
| [03 — Escrita](2026-10-28-email-03-mutations.md) | Rascunhos, organização, envio sem replay e prova |02 |
| [04 — Anexos/integração](2026-10-28-email-04-attachments-integration.md) | Transferências, capacidades Main, IPC/painel e chat/Live |03 |
| [05 — Aceite](2026-10-28-email-05-acceptance.md) | Regressões integradas e gates comerciais explícitos |04 |

Cada fase pode ser testada sem contas reais. Até04, serviços são testáveis por injeção mas o módulo não entra em implemented nem anuncia capacidades incompletas. Não interpretar preparação interna como funcionalidade já disponível ao cliente.

## Arquivos e interfaces canônicos

`src/shared/types/email.ts`, reexportado em `src/shared/index.ts`, define:

- `EmailProviderId = 'gmail'|'outlook'`; `EmailAccount`: `{id,provider,subjectId,tenantId:string|null,address,displayName,revision:number,status:'connected'|'reauth_required'|'disconnected'}`. Identidade única `(provider,tenantId,subjectId)`; só Main obtém identidade validada do login. Renderer recebe conta sem subjectId/tenantId quando desnecessários.
- `EmailPreferences`: `{defaultAccountId:string|null,revision:number}`. Conta padrão perdida não elege outra automaticamente.
- `EmailMessageRef`: `{accountId:string,messageId:string}`; `EmailLocationRef`: `{accountId,id,kind:'folder'|'label'}`. Todas as ações usam conta+ID, nunca ID isolado.
- `EmailQuery`: `{accountIds?:string[],from?:string,to?:string,subject?:string,text?:string,afterUtc?:string,beforeUtc?:string,unread?:boolean,location?:EmailLocationRef,cursor?:string,limit:number}`. Strings até512, conta explícita deve existir/estar conectada, limit1–50. Datas ISO UTC válidas; cursor não pode mudar a consulta. Sem query/URL bruta do provedor.
- `EmailSummary`: `{ref:EmailMessageRef,threadId:string|null,from:string,subject:string,receivedAt:string|null,unread:boolean}`; `EmailPage`: `{items:EmailSummary[],nextCursor:string|null,queriedAccountIds:string[],failures:Array<{accountId,code}>,partial:boolean}`.
- `EmailMessage`: `{summary:EmailSummary,to:string[],cc:string[],replyTo:string[],text:string,truncated:boolean,attachments:EmailAttachmentInfo[]}`. Texto limitado a102400 bytes UTF-8; preservar caracteres completos ao truncar.
- `EmailConversation`: `{accountId:string,threadId:string,items:Array<{message:EmailMessage,version:string}>,nextCursor:string|null,truncated:boolean}`. Até5 mensagens por página, cursor da sessão/conta/conversa, nenhuma leitura ilimitada de corpos.
- `EmailAttachmentInfo`: `{ref:EmailMessageRef,attachmentId,name,contentType,sizeBytes:number|null}`. Nome é texto externo, nunca path autorizado.
- `EmailComposition`: `{accountId?:string,to:string[],cc:string[],bcc:string[],subject:string,text:string,attachmentHandles:string[]}`. Somente texto, assunto até998 caracteres sem CR/LF, texto até102400 bytes,1–50 destinatários somados; validar endereços sem resolver contatos por adivinhação. Nenhum campo from arbitrário.
- `EmailWriteRequest`: união `{type:'draft_create',composition}` / `{type:'draft_update',ref,expectedVersion,composition}` / `{type:'send',draftRef,expectedVersion}` / `{type:'reply'|'forward',ref,expectedVersion,text,to:string[],attachmentHandles:string[]}` / `{type:'organize',ref,expectedVersion,action:'read'|'unread'|'archive'|'move'|'labels'|'trash'|'restore',destination?:EmailLocationRef,addLabelIds?:string[],removeLabelIds?:string[]}`. Reply requer `to:[]` e deriva destinatários de Reply-To/remetente, sem reply-all implícito; forward exige destinatários. Versão é token opaco retornado por leitura Main, não timestamp inferido. Draft update conserva accountId do ref.
- `EmailOperation`: `{id,invocationId,accountId,kind,state:'prepared'|'dispatching'|'accepted'|'observed'|'rejected'|'unknown',providerRef:EmailMessageRef|null,errorCode:string|null,createdAt,updatedAt}`. `observed` significa condição verificada do efeito, não leitura pelo destinatário. Bytes/conteúdo não aparecem nesse tipo público.
- `EmailResult`: união `{kind:'read',value:EmailPage|EmailConversation|{message:EmailMessage,version:string}|EmailLocationRef[]|EmailAttachmentInfo[]}` / `{kind:'write',operation:EmailOperation}` / `{kind:'file',receiptRef:string,name:string,sizeBytes:number}`. Cada capacidade terá schema próprio em vez de validar só uma união ampla.

Interfaces privadas em `src/main/modules/email/contracts.ts`:

- `EmailScope = {context:ExecutionContext,signal:AbortSignal,check():void}`; check valida licença, módulo, sessão/revisão, conta/revisão antes de request e antes de devolver dado. UI cria contexto no Main, não aceita autoridade enviada pelo renderer.
- `VaultCrypto`: `{available():boolean;encrypt(text:string):Uint8Array;decrypt(bytes:Uint8Array):string}`. `EmailTokenVault.get/put/remove(accountId,payload?)`: métodos assíncronos com payload cifrado de tokens/cache; filas por conta e escrita atômica. Publicar assinaturas concretas no01; correlação de operação usa codec separado03.
- `EmailAuth.connect(provider,scope):Promise<EmailAccount>`, `accessToken(accountId,scope):Promise<string>`, `disconnect(accountId,scope):Promise<void>`, `stop():Promise<void>`; só Main consome string token. Callback de persistência com revisão não pode ressuscitar conta desconectada.
- `EmailProvider.search(account,queryWithoutCursor,providerCursor,scope):Promise<{items:EmailSummary[],cursor:string|null}>`; `read(account,ref,scope):Promise<{message:EmailMessage,version:string}>`; `locations(account,scope):Promise<EmailLocationRef[]>`; `write(account,request,operationId,scope):Promise<{state:'accepted'|'observed'|'rejected',providerRef:EmailMessageRef|null,correlation:unknown}>`; `reconcile(account,operation,scope):Promise<'observed'|'unknown'>`; `download(account,attachment,scope):AsyncIterable<Uint8Array>`.
- `EmailProvider.conversation(account,threadId:string,providerCursor:string|null,scope):Promise<EmailConversation>` complementa read. `locations` no máximo1000 elementos; acima disso, erro explícito email_locations_limit_exceeded em vez de alegar listagem completa.
- `EmailReadService.search(query,scope):Promise<EmailPage>`, `read(ref,scope):Promise<{message:EmailMessage,version:string}>`, `conversation(accountId:string,threadId:string,cursor:string|undefined,scope:EmailScope):Promise<EmailConversation>`, `locations(accountId,scope):Promise<EmailLocationRef[]>`; mantém cursores/observações voláteis e `clear():void`.
- `EmailWriteService.execute(request,scope):Promise<EmailOperation>`, `reconcile(operationId,scope):Promise<EmailOperation>`, `stop():Promise<void>`; usa diário antes da rede e nunca retoma envio ao iniciar.
- `EmailService.execute(id,args,context,signal):Promise<unknown>`, `verify(context,id,result):CapabilityResult`, `releaseObservation(invocationId):void`, `stop():Promise<void>`. É fachada04, não outro broker.

Migração008: `email_accounts` guarda os campos EmailAccount + vault_ref e UNIQUE(provider,COALESCE(tenant_id,''),subject_id) por índice; `email_preferences` singleton guarda default_account_id nullable e revision, sem mudar padrão ao desconectar; `email_operations` guarda campos EmailOperation + args_fingerprint, sealed_correlation nullable, revision e leg_receipts_json apenas com IDs/estados, UNIQUE(invocation_id). Correlação que contenha Message-ID/nonce remoto fica cifrada, nunca no JSON de metadados públicos. Persistir estado da conta não persiste autorização atual: a política é revalidada sempre.

TokenVault e configuração: `EmailPublisherConfig = {google:{clientId:string,desktopClientSecret?:string}|null,microsoft:{clientId:string,authority:'https://login.microsoftonline.com/common'}|null}`. Arquivo com schemaVersion:1 e esses dois provedores; pode configurar um só, nunca aceitar authority/endpoints arbitrários. `desktopClientSecret` Google, se necessário para cliente público distribuível, não é segredo de servidor: não incluí-lo em exemplos, logs ou resposta do renderer; scanner deve distinguir a configuração desktop aprovada sem allowlist genérica de credenciais. Ausência de configuração de um provedor só bloqueia sua conexão.

## Bibliotecas e configuração

Metadados consultados com npm view no registro oficial em28/10, sem instalar: `@googleapis/gmail@22.0.2` (Node>=22), `google-auth-library@11.3.1` (>=22), `@azure/msal-node@7.1.2` (>=20), `@microsoft/microsoft-graph-client@3.0.7` (>=12). Fixar --save-exact no01 e testar sob Node24 e Node embutido no Electron. `@googleapis/gmail` é o cliente específico oficial; não instalar o pacote googleapis inteiro em duplicata.

No02, `html-to-text@10.0.1` + `@types/html-to-text@9.0.4`; no03, `nodemailer@10.2.1` exclusivamente streamTransport para gerar MIME local, sem SMTP/transportes externos. Nodemailer10 declara tipos próprios. Se registro/engine/audit contradisser esses metadados na execução, registrar falha e apresentar substituição material antes de mudar abordagem; não instalar latest silenciosamente. Copiar licenças e manter lock. Nenhuma biblioteca foi instalada nesta atividade.

Configuração pública do publicador em `resources/email-oauth.json`: clientes desktop Google/Microsoft, authority Microsoft comum para contas pessoais/organizacionais e escopos permitidos. Exemplo sem valores reais em `resources/email-oauth.example.json`; configuração ausente representa email_oauth_not_configured, não app quebrado. Nunca colocar token, segredo confidencial de servidor ou dado de cliente nesse arquivo. Qualquer material desktop Google exigido pelo SDK deve seguir classificação de cliente público e scanner específico, sem relaxar a detecção global de segredos.

## Review Focus e rastreabilidade

1. Refresh termina após disconnect/revogação: não restaura token nem estado —01/02 testes de barreiras.
2. Mesmo ID em duas contas, conta padrão removida e reply misturado: rejeitar cruzamento —02/03/04.
3. SDK repete POST após429/503 ou processo cai após envio: uma tentativa de transporte, unknown/reconciliação sem reenviar —03.
4. Cursor/throttling/HTML/MIME malicioso: busca parcial verdadeira, memória limitada e zero recurso remoto —02/04.
5. Anexo muda, filename atravessa diretório, janela fecha após callback: não sobrescrever/abrir dado tardio —04/05.

## Gate documental

- [x] Especificação aprovada; arquitetura/interfaces existentes inspecionadas.
- [x] Contratos, etapas e versões propostas definidos; nenhuma dependência instalada.
- [ ] Usuário revisar/aprovar os planos01–05 e seus detalhes técnicos.
- [ ] Executar sequencialmente pelo método nativo/main, registrando RED/GREEN/evidência em progresso.

Cada plano produz evidência própria; esta lista não alega teste de produto. Para retomar, ler este mapa, a especificação, o progresso e o primeiro plano incompleto. Não repetir decisões de SDKs/contas/escopos funcionais já recebidas. Novas alternativas materiais devem ser apresentadas ao usuário.
