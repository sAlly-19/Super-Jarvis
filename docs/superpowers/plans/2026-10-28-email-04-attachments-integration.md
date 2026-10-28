# E-mails04 — anexos, painel e ferramentas do agente

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans após aprovação. Conservar contratos00 e serviços01–03; não criar outro framework de módulos.

**Goal:** expor o módulo completo em Sistema & Automação, chat e Live com anexos seguros.
**Architecture:** composição própria email, IPC confiável, referências opacas de arquivos e executor Main.
**Tech Stack:** Electron dialogs/IPC, streams Node, TypeScript/Python, SDKs existentes.
**Spec:** [desenho](../specs/2026-10-28-email-design.md); [mapa00](2026-10-28-email-00-execution-map.md). Depende de03.

## Global Constraints

Anexos10 arquivos/10485760 bytes originais somados, limite menor do provedor prevalece. Sem interpretar/executar anexos ou passar bytes ao Python. Nenhum path vindo de uma mensagem autoriza acesso local. Conta padrão/resposta/origem preservadas. Sem per-operation confirmation, executável/commit/push.

## Review Focus

Filename ../../, symlink/arquivo alterado, transferência acima do tamanho declarado, IPC de janela falsa e module disable durante Live são cobertos nas Tasks1–3. Sem apagar arquivo preexistente ao cancelar e sem devolver dado após revogação.

### Task1: transferências e tickets locais

**Files:** criar `src/main/modules/email/attachments.ts`, `desktop-files.ts`; testes `test/email-attachments.test.ts`, `test/email-file-authority.test.ts`; completar download/write dos adaptadores e tipos00.

**Interfaces:** `EmailAttachments.selectUploads(scope):Promise<Array<{handle:string,name:string,sizeBytes:number}>>` usa dialog Main; `download(info:EmailAttachmentInfo,destinationHandle:string,scope):Promise<{receiptRef,name,sizeBytes}>`; `resolveUploads(handles:string[],accountId:string,scope):Promise<ReadonlyArray<{name,contentType,bytes}>>`; `clear():void`. `chooseDownloadDirectory(scope):Promise<string|null>` retorna handle opaco; fila de tickets por sessão/conta,TTL5min e até100; consumo em composição congela conteúdo somente pelo prazo da operação. O destino configurado por escolha explícita e arquivos selecionados são a origem da autoridade local nesta versão, não prompts de e-mail.

- [ ] **1 RED:**10 anexos e10MiB exatos aceitos no limite de aplicação;11 ou1 byte adicional rejeita. Arquivo muda entre seleção/leitura, alvo é diretório/reparse/symlink, handle de outra conta/sessão ou expirado: rejeitar sem enviar. Download cujo stream ultrapassa limite ou sizeBytes declarado falha e limpa só temporário próprio. Nomes absolutos/UNC/../ADS/CON e dupla extensão não escapam do destino; zero autoexecução. Colisão cria nome único usando abertura exclusiva, sem sobrescrever arquivo já existente, inclusive corrida de duas gravações.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-attachments`; esperado FAIL antes de transferências.
- [ ] **3 Implementar:** Main abre arquivo e valida stat antes/depois no mesmo handle, impede reparse/links não autorizados; lê com teto em vez de confiar no stat. Rede via SDK fixo e download stream abortável, total<=10MiB. Outlook sem upload resumível: attachment<3000000 bytes e JSON enviado<=4000000 bytes; se orçamento real menor, erro explícito antes da rede, mesmo que passe no teto10MiB. Gmail conta tamanho MIME/base64 e aplica seu limite real. Guardar resultado local, não conteúdo, na prova. `download` só resolve destino autorizado; não aceitar URL/path final do modelo.
- [ ] **4 GREEN:** testes de arquivo real temporário, race e streams falsos passam; typecheck exit0. Não selecionar arquivo/calendário pessoal nem abrir dialogs do usuário em teste automatizado.

### Task2: catálogo e serviço Main com provas

**Files:** criar `src/main/modules/email/service.ts`, `application.ts`, `capabilities.ts`; modificar `resources/modules/native-capabilities.json`, `src/main/modules/application.ts`, `src/main/tasks/application.ts` somente se necessário ao registro de verificador; modificar `jasper-backend/orchestration/contracts.py`, `diagnostics.py`, `planner.py`, `responder.py` e testes associados. Testes `test/email-routing.test.ts`, `test/email-tools.test.ts`, `test/email-task-proof.test.ts`, `jasper-backend/tests/test_email_module.py`.

**Interfaces:** EmailService do00 delega Read/Write/Attachments e usa proofs03. `startEmailApplication(dependencies):{service,accounts,auth,stop():Promise<void>}`; bootstrap registra `'email'` como implemented só com serviço completo. Política não depende de IA para painel, mas capacidades do agente exigem sessão negociada. `verifyCapability` roteia prefixos/capability map explícito, não confia em verifier do modelo.

Composição também oferece `status():{health:'healthy'|'unavailable'|'error',errorCode?:string}` para overlay email em `listModuleSnapshots`: código completo mantém configured:true, mas sem config/contas acessíveis mostra indisponibilidade real. Gestão de conexão exige licença+consentimento+switch e pode funcionar sem conta conectada; ferramentas de caixa exigem conta conectada/escopos. Não bloquear o botão conectar por exigir previamente uma conta conectada; não declarar healthy apenas por estar em implemented. Erros de configuração/conta email não mudam health de outros módulos.

Catálogo proposto (schemas de objetos sem campos extras, timeout30000ms e cancellable:true):

| ID | Entrada | Saída / verifier |
| --- | --- | --- |
| email_search | EmailQuery | EmailPage / email_read |
| email_read | ref | mensagem+version / email_read |
| email_conversation | accountId,threadId,cursor opcional | até5 mensagens+cursor / email_read |
| email_locations | accountId | locations / email_read |
| email_draft | request draft_create ou draft_update | operação / email_write |
| email_send | draftRef,expectedVersion | operação / email_write |
| email_reply | ref,expectedVersion,text,attachmentHandles | operação / email_write |
| email_forward | ref,expectedVersion,to,text,attachmentHandles | operação / email_write |
| email_organize | variante organize do00 | operação / email_write |
| email_attachments | ref | metadados / email_read |
| email_download_attachment | ref,attachmentId,destinationHandle | receipt local / email_file |
| email_reconcile | operationId | operação, sem replay / email_write |

Login, seleção de arquivos/diretório e gestão de contas ficam no painel autenticado, não são ferramentas capazes de abrir browser/dialog sob instrução do conteúdo recebido. Sem ferramenta para enviar por SMTP/PowerShell quando o módulo falha.

- [ ] **1 RED:** module_id email sem executor não cai em Python; capacidade mantém sessão/revisão/conta; saída forjada nunca promove task. Novo verificador diferente da capacidade rejeitado por validate_plan. Desativar email não cancela computer/reminders/health; tarefa da chamada cancela ao encerrar chamada. Unknown de envio não ganha tentativa de outra conta/PowerShell; classificação/resumo cita conta/mensagem e não cria memória/lembrete sozinho.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-routing`, `npm.cmd run test:python` usando Python resolvido pelo runner; esperado FAIL nos novos casos antes de registro/contratos, sem depender de Python global.
- [ ] **3 Implementar:** fachada registra observações verificadas do Main e libera no fim; catálogo com schemas exatos, permissões email.read/write/attachments e verifier correspondente. Python só planeja/compoõe respostas; nenhuma credencial, SDK ou worker email nele. Resumo não chama IA fixa diferente da configurada. Prompt explica resultados parciais/accepted/unknown, sem resposta genérica nem alegação de entrega. Mudança de catálogo Live conserva aviso de reiniciar chamada para habilitar novas ferramentas.
- [ ] **4 GREEN:** testes de tools/routing/proof e `npm.cmd run test:python` passam. Se alterar envelopes/protocolo não previstos, parar para revisar contrato; reutilizar bridge existente não exige versão nova por si só.

### Task3: IPC e painel multi-conta

**Files:** criar `src/main/ipc/email-ipc.ts`, `src/renderer/ui/email-settings.ts`; modificar `src/main/ipc/register-ipc.ts`, `src/shared/constants/ipc-channels.ts`, `src/shared/types/agent-api.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/index.html`, `styles/modal.css`, `ui/settings-modal.ts`, `ui/module-settings.ts`, `.env.example` só para documentar configuração pública sem segredo. Testes `test/email-ipc.test.ts`, `test/email-ui.test.ts`, `test/email-ui.browser.ts`.

**Interfaces:** API específica `listEmailAccounts()`, `connectEmailAccount(provider)`, `disconnectEmailAccount(id,expectedRevision)`, `setDefaultEmailAccount(id|null,expectedRevision)`, `emailPreferences()`, `selectEmailUploads(accountId)`, `selectEmailDownloadDirectory(accountId)`, `onEmailChanged(callback):()=>void`. Channels email:accounts/connect/disconnect/default/preferences/uploads/download-directory/changed; definir constantes exatas e requests discriminados, sem invoke arbitrário. Dados da caixa chegam só quando necessários à UI; gestão de conta nunca aceita tokens do renderer.

- [ ] **1 RED:** Chromium mostra Gmail+Outlook múltiplos, padrão indisponível sem troca silenciosa, config ausente orienta configuração, mensagens externas escapadas, erro parcial distinto. Módulo desativado não consulta endpoints de dados (regressão health preservada). Revogação oculta conteúdo, limpa tickets/handlers, ignora callback tardio; janela falsa/frame filho não obtém auth/store antes de guard. Input tokens/authority/url inesperados rejeitados.
- [ ] **1b RED gestão:** nenhum connected com config válida mostra conectar disponível, mas ferramenta email_search falha email_account_unavailable; config ausente mostra email_oauth_not_configured, sem abrir navegador. Após conexão real do fake, status healthy; disconnect retorna unavailable sem impedir nova conexão. Licence/module bloqueados impedem ambas as operações.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-ui`, `npm.cmd test -- email-ipc`; esperado FAIL antes do painel/IPC.
- [ ] **3 Implementar:** check listModules antes da UI consultar email; conexão acionada por botão e browser externo, sem WebView. Estado conectado só após token/identidade/store confirmados, desconectar com CAS e cleanup; botões não anunciam operação remota que não fizeram. UI usa textContent, campos sem token, desabilita durante trabalho sem travar o app. Registar unsubscribers e fechar operações de janela no unload/did-start-loading.
- [ ] **4 GREEN e handoff:** `npm.cmd run verify`, `npm.cmd run test:python`, scanner e whitespace; esperado exit0 sem APIs reais. Registrar fase04 e liberar05; sem gerar artefato de instalação.
