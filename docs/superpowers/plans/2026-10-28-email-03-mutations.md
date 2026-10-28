# E-mails03 — rascunhos, organização e envio sem replay

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans após aprovação. Usar contratos00–02. Alterar somente o módulo e as integrações explicitamente previstas.

**Goal:** executar efeitos nas contas certas e distinguir aceitação, observação e resultado desconhecido.
**Architecture:** diário Main antes de rede; transporte sem retry de mutação; prova/reconciliação separadas do retorno do SDK.
**Tech Stack:** SQLite/cofre01, adaptadores02, nodemailer10.2.1 streamTransport.
**Spec:** [desenho](../specs/2026-10-28-email-design.md); [mapa00](2026-10-28-email-00-execution-map.md). Depende de02.

## Global Constraints

Total Control sem confirmação por operação; não adivinhar conta ou destinatário. Conta padrão só para novo rascunho/envio; resposta pela conta original. Sem delete permanente/bulk/aliases/SMTP. Mensagem100KiB, até50 destinatários. Não reenviar após timeout/crash/resposta perdida. Sem instalador/commit/push.

## Review Focus

POST repetido pelo SDK, referência cruzada entre contas, alteração externa de rascunho, crash entre request/receipt e Graph202 são cobertos nas Tasks1–3. Não confundir deduplicação local com garantia exactly-once remota.

### Task1: diário de operações e deduplicação

**Files:** criar `src/main/modules/email/operation-store.ts`, `operation-codec.ts`, `write-service.ts`; testes `test/email-operations.test.ts`, `test/email-mutation-races.test.ts`; usar tabela008 criada no01.

**Interfaces:** `EmailOperationStore.prepare(invocationId:string,accountId:string,kind:string,argsFingerprint:string,sealedCorrelation:string|null):EmailOperation`; `transition(id,expectedState,nextState,providerRef?,errorCode?):EmailOperation`; `get(id):EmailOperation|null`, `getByInvocation(id):EmailOperation|null`, `interruptDispatches():void`. `EmailWriteService.execute/reconcile/stop` conforme mapa00. Fingerprint usa HMAC com chave no cofre, nunca corpo/destinatário em claro. Operação local tem ID criado no Main.

`EmailOperationCodec(keyFile:string,crypto:VaultCrypto)` oferece `fingerprint(value:unknown):Promise<string>`, `seal(value:unknown):Promise<string>`, `open(ciphertext:string):Promise<unknown>`. Chave HMAC aleatória32 bytes, protegida pelo mesmo crypto do cofre e arquivo atômico separado no userData; não é chave derivada de conta/endereço. Canonicalização JSON ordena chaves recursivamente e rejeita valores não JSON. KeyFile indisponível/incifrável bloqueia nova mutação, sem trocar chave silenciosamente ou perder a reconciliação; arquivos de cofre/chave não entram em logs/backups em claro. “Chave no cofre” acima significa armazenamento protegido local, não campo da conta que desaparece ao desconectar.

- [ ] **1 RED:** mesmo invocationId+fingerprint retorna mesma operação, fingerprint diferente rejeita email_invocation_conflict. Duas conexões SQLite disputando invocationId permitem só um dispatch. Crash após estado dispatching: reabrir converte para unknown, zero POST de replay. Banco/logs/histórico sem assunto/corpo/destinatários/caminhos; correlação privada é cifrada. Vault falha antes do prepare implica zero rede.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-operations`; esperado FAIL antes da implementação.
- [ ] **3 Implementar:** validar/selecionar conta, preparar diário, checar autoridade, marcar dispatching e somente então solicitar efeito. Reservar legs de um fluxo composto de reply/forward com IDs derivados da operação e tipo de leg, persistindo correlação antes do próximo request; não repetir leg cujo estado seja dispatching/unknown ao reabrir. Falha antes da rede pode ser rejected; qualquer possível despacho sem prova vira unknown. Mutação de um rascunho/alvo serializada; stop invalida epoch, aborta e aguarda cleanup limitado, sem rollback de efeito remoto.
- [ ] **4 GREEN:** `npm.cmd test -- email-operations`, `npm.cmd test -- email-mutation-races`; esperado PASS. Não fazer awaits dentro de transação StateDatabase.

### Task2: composição e adaptadores de escrita

**Files:** criar `src/main/modules/email/mime.ts`, `draft-versions.ts`; completar `providers/gmail.ts`, `providers/outlook.ts`, `providers/sdk-transport.ts`; testes `test/email-provider-write.test.ts`, `test/email-mime.test.ts`; adicionar nodemailer/licença.

**Interfaces:** `composeGmailMessage(composition:EmailComposition,account:EmailAccount,attachments:ReadonlyArray<{name:string,contentType:string,bytes:Uint8Array}>,messageId:string):Promise<Uint8Array>`; sem paths/URLs/raw custom headers vindos do modelo. `EmailDraftVersions.require(ref,expectedVersion,scope):Promise<void>` usa versão opaca02 + nova leitura antes da mutação. `EmailProvider.write` usa IDs/conta do00, correlation privada contendo nonce/Message-ID/immutable draft ID e estado de cada leg.

- [ ] **1 RED:** streamTransport gera MIME para Unicode, destinatários To/Cc/Bcc e reply headers válidos sem injeção CRLF; to/cc/bcc somados51 rejeita, assunto com CRLF rejeita, attachment path/URL não aceito. Reply ignora padrão de outra conta e usa Reply-To válido ou From; autores ambíguos retornam erro. Draft update com expectedVersion obsoleto é rejeitado antes de PUT/POST. Outlook IDs permanecem imutáveis nas mudanças suportadas; archive/move/labels não equivalentes retornam unsupported_email_action sem fallback destrutivo.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-provider-write`; esperado FAIL antes de completar adaptadores.
- [ ] **3 Implementar:** Gmail drafts.create/update/send, messages.modify/trash/untrash e labels conforme ação; não chamar messages.delete. Gmail reply mantém threadId e cabeçalhos de referência, forward é composição nova com conteúdo explicitamente lido. Outlook cria/atualiza draft, createReply/createForward e send; organização via PATCH/move/pastas, sem inventar equivalência Gmail labels. Retornar somente estados/provas observáveis, preservando corpo fora do diário. Versão de preflight não é CAS remoto universal: usar condicionais quando disponíveis; sem suporte, serialização local + fresh read não garante exclusão de edição externa concorrente, e essa limitação deve ser registrada.
- [ ] **4 Transporte:** para toda mutação, Google/gaxios retry:false e retryConfig sem métodos de escrita; Graph middleware de retry desabilitado para writes. Testar transporte real do SDK com endpoint fake, não só mock da fachada:429,503 e conexão encerrada após receber request devem observar uma tentativa por leg. Não usar política automática do SDK para repetir body/redirect autenticado. Token refresh precede despacho;401 após POST não dispara reenvio automático.
- [ ] **5 GREEN:** instalar `nodemailer@10.2.1 --save-exact --ignore-scripts`, licenças, testes MIME + escritos e typecheck. Usar createTransport({streamTransport:true,buffer:true,disableFileAccess:true,disableUrlAccess:true}); nunca sendmail/SMTP/jsonTransport/plugins remotos. `npm.cmd test -- email-` esperado PASS.

### Task3: observações verificáveis e reconciliação conservadora

**Files:** criar `src/main/modules/email/proofs.ts`, `reconciliation.ts`; testes `test/email-proof.test.ts`, `test/email-reconciliation.test.ts`.

**Interfaces:** `EmailProofs.observe(context,capabilityId,argsFingerprint,data,kind):void`, `verify(context,capabilityId,result):CapabilityResult`, `release(invocationId):void`, `clear():void`; kind `'email_read'|'email_write'|'email_file'`. `EmailReconciliation.check(operationId:string,scope:EmailScope):Promise<EmailOperation>` faz somente leituras, dentro de30000ms, não muda unknown para rejected por ausência de resultado.

- [ ] **1 RED:** Graph202 produz accepted e texto de aceitação, nunca delivered/read; Gmail retorno válido referencia mensagem sem provar entrega final. Resultado ou contexto/conta alterados não verificam; replay da prova em outra sessão falha. Reconciliação por mesmo assunto/destinatário não promove unknown. Draft imutável/nonce previamente persistido e resposta autenticada podem comprovar observed; ausência, múltiplas correspondências, período não coberto ou timeout mantém unknown. Todas as reconciliações fazem zero writes do provedor.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-proof`; esperado FAIL antes de provas.
- [ ] **3 Implementar:** store registra accepted somente por resposta autorizada da solicitação e observed por estado verificado do recurso correto. Mudança de autoridade impede saída ao agente mesmo se o diário guarda o fato remoto já observado. Evidência da tarefa contém só operação/conta opacas e horário, sem conteúdo. Um objetivo “solicitar envio” pode ser comprovado por accepted; entrega ao destinatário nunca inferida. Corrida pós-envio devolve unknown/cancelled segundo broker, sem tentar desfazer mensagem.
- [ ] **4 GREEN e handoff:** `npm.cmd run verify`, scanner e revisão final da fase; esperado exit0. Registrar limitações de CAS remoto, reconciliação e diferenças Gmail/Graph. Ainda não anunciar módulo parcial nem testar conta real. Próxima fase04.
