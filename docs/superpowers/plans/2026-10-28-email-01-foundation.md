# E-mails01 — contas, cofre e configuração

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans após aprovação. Passos em ordem, com TDD. Sem commit/push automático.

**Goal:** criar armazenamento e configuração testáveis sem conectar contas.
**Architecture:** SQLite atual para metadados; cofre separado, filas por conta e safeStorage.
**Tech Stack:** TypeScript, node:sqlite, safeStorage, SDKs fixados.
**Spec:** [desenho](../specs/2026-10-28-email-design.md); [contratos canônicos](2026-10-28-email-00-execution-map.md).

## Global Constraints

Aplicam-se todos os limites do mapa00. Main, sem dados pessoais/API/instalador. Switch email continua não implementado até04. Não duplicar switch em SQLite. Backup/migrações preservam os módulos anteriores. Nenhum token em claro nem fallback de criptografia.

## Review Focus

Identidade repetida, duas conexões SQLite, atualização de preferência antiga, cofre sem criptografia e crash entre cofre/metadados são cobertos nas Tasks1–2; novo estado não deve perder preferências anteriores ou reativar conexão inválida.

### Task1: contratos, migração e CAS de contas

**Files:** criar `src/shared/types/email.ts`, `src/main/modules/email/contracts.ts`, `store.ts`, `publisher-config.ts`, `src/main/storage/migrations/008-email.sql`, `resources/email-oauth.example.json`; modificar `src/shared/index.ts`, `src/main/modules/application.ts`; testes `test/email-store.test.ts`, `test/email-config.test.ts`, `test/email-upgrade.test.ts`.

**Interfaces:** tipos do mapa00. `EmailStore(database:StateDatabase)` oferece `listAccounts():EmailAccount[]`, `getAccount(id):EmailAccount|null`, `upsertIdentity(identity:Omit<EmailAccount,'id'|'revision'|'status'>,vaultRef:string):EmailAccount`, `setConnection(id,status,expectedRevision):EmailAccount`, `getPreferences():EmailPreferences`, `setDefault(accountId:string|null,expectedRevision:number):EmailPreferences`. `readEmailPublisherConfig(root:string):EmailPublisherConfig|null`, config validada em runtime, sem segredo de servidor.

- [ ] **1 RED:** criar teste de upgrade v7→v8 com lembrete e preferências health preexistentes; reabrir e afirmar mesmos valores e backup existente. Store: mesma identidade retorna mesmo UUID, endereço igual com tenant/provedor diferentes não mescla, CAS antigo lança stale_email_revision, excluir/desconectar conta padrão conserva referência indisponível em vez de eleger outra. Config ausente retorna null, URL de authority arbitrária rejeitada.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-store`; esperado FAIL por implementação ausente. Registrar saída antes de escrever store.
- [ ] **3 Implementar:** migração aditiva com `email_accounts`, `email_preferences`, `email_operations`; operações já reservam UNIQUE(invocation_id), estados e coluna cifrada privada de reconciliação. Transações síncronas, sem rede/await. Converter dispatching de sessão anterior para unknown numa operação explícita de startup, nunca reenviar. Carregar008 no bootstrap sem habilitar módulo.
- [ ] **4 GREEN:** `npm.cmd test -- email-`; esperado testes criados nesta fase PASS. `npm.cmd run typecheck` exit0. Conferir que config ausente não impede startup dos módulos existentes.

### Task2: cofre atômico e coordenação de conta

**Files:** criar `src/main/modules/email/token-vault.ts`, `account-session.ts`; testes `test/email-vault.test.ts`, `test/email-account-session.test.ts`. Reusar `src/main/utils/atomic-json.ts`, sem mudar semântica global.

**Interfaces:** `EmailTokenVault(filename:string,crypto:{available():boolean;encrypt(text:string):Uint8Array;decrypt(bytes:Uint8Array):string})` com `get(accountId:string):Promise<unknown|null>`, `put(accountId:string,payload:unknown):Promise<void>`, `remove(accountId:string):Promise<void>`. `EmailAccountSession.capture(accountId):{revision:number,signal:AbortSignal,check():void}`, `invalidate(accountId):Promise<void>`, `runExclusive<T>(accountId,work:()=>Promise<T>):Promise<T>`. Método check também usa o gate injetado de política, não só epoch.

- [ ] **1 RED:** testes com crypto fake reversível e arquivo temporário: bytes não contêm token/código; put/remove concorrentes ordenados; encryption unavailable lança email_crypto_unavailable sem gravar; erro de replace preserva arquivo anterior. Usar barreira para refresh atrasado, invalidate/remove e depois conclusão; token e conta não podem reaparecer. Falha após salvar cofre mas antes de conta deixa conexão não ativa e permite limpar órfão sem promover autoridade.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-vault`; esperado FAIL antes de implementar.
- [ ] **3 Implementar:** cofre único com payloads por UUID e escrita atômica serializada; lock global do arquivo além da fila de conta evita lost update entre duas contas. Sem escrever segredo nos erros. Coordenador invalida epoch e espera cleanup conhecido; erro de cleanup mantém estado indisponível. Ordem connect: cofre → conta; disconnect: invalidar → marcar desconectada → remover segredo, sem rollback que reative conta se remoção falhar. Startup não adota conta sem cofre válido.
- [ ] **4 GREEN:** `npm.cmd test -- email-`; esperado PASS dos testes existentes da fase; diretórios temporários removidos, nenhuma escrita no perfil do usuário.

### Task3: dependências oficiais fixadas e baseline

**Files:** modificar `package.json`, `package-lock.json`; criar licenças originais em `resources/licenses/` e prova `test/email-dependencies.test.ts`.

**Interfaces:** pacotes exatos do mapa00 para os quatro SDKs; clientes não podem iniciar rede no import. Tipos Google/Graph ficam privados aos adaptadores, não vazam ao shared.

- [ ] **1 RED:** teste importa os quatro pacotes em fixtures sem tokens e confere versões fixas e licenças locais; esperado FAIL enquanto dependências ausentes.
- [ ] **2 Instalar apenas após autorização deste plano:** `npm.cmd install --save-exact --ignore-scripts @googleapis/gmail@22.0.2 google-auth-library@11.3.1 @azure/msal-node@7.1.2 @microsoft/microsoft-graph-client@3.0.7`. Esperado exit0 e lock coerente; não rodar npm audit fix. Guardar engine, licenças e auditoria sem ocultar achados.
- [ ] **3 GREEN:** `npm.cmd test -- email-dependencies`, `npm.cmd run typecheck`, `npm.cmd run audit:runtime`, `npm.cmd run verify`. Esperado testes/typecheck/build exit0 e auditoria sem vulnerabilidade de produção impeditiva; registrar qualquer achado como pendência antes de seguir. Validar imports também no runtime Electron isolado; Node26 local não prova Node24.
- [ ] **4 Handoff:** atualizar `2026-10-28-email-progress.md` com evidências, versões realmente instaladas, lista de arquivos, limites e próximo plano02. Revisão final conforme executing-plans, sem commit automático. Não criar clientes OAuth reais nesta fase.
