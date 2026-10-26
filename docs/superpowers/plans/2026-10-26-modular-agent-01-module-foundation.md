# Fundação modular Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL após autorização: superpowers:executing-plans ou superpowers:subagent-driven-development, conforme método escolhido pelo usuário. Executar tarefa por tarefa com TDD e revisão. Este documento NÃO autoriza implementação.

**Goal:** Introduzir registro central, estado persistente, políticas e ciclo de vida dos módulos antes das integrações.
**Architecture:** Opção A aprovada: Main governa licença, consentimento, segredos, persistência e execução autorizada; Python coordena tarefas e mantém seus executores. Renderer só usa IPC tipado.
**Tech Stack:** Electron 44, TypeScript, Python, stdio privado, SQLite local para tarefas/agendas; configurações e segredos atuais preservados.
**Spec:** [Especificação em revisão](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** APROVADO pelo usuário, execução nativa autorizada em 26/10/2026. T1–T4 aprovados. Implementação em andamento; componentes isolados de registro/política/persistência/lifecycle em teste. Integração de runtime, IPC/painel e aceite de fase ainda pendentes. Ver ledger [progresso](2026-10-26-module-foundation-progress.md).

## Global Constraints

- Preservar arquitetura, licença comercial, integridade, Gemini Live, provedores e dados existentes.
- Total Control e PowerShell mantidos como estão, sem confirmação por operação; bloqueio de módulo/licença não pode ser contornado pelo caminho legado.
- Sem nova bandeja, serviço Windows, agendador externo ou alteração do botão X.
- SQLite não substitui configuração criptografada nem MemoryStore; nenhum segredo em snapshot, tarefa, auditoria ou renderer.
- Novos módulos não prontos não aparecem como operacionais. Não criar integrações simuladas.
- Nada de execução/commit/push/instalação de dependência sem autorização. Alternativas novas devem ser apresentadas antes da escolha.
- Versão de envelope atual: 1; quadro máximo atual: 16 MiB. Extensão exige negociação explícita, não aceitação permissiva.

## Gates técnicos ainda sujeitos à revisão

T1 — RESOLVIDA PARA DESENVOLVIMENTO: usuário autorizou verificar e adotar SQLite integrado caso compatível. Probe scripts/test-electron-sqlite.cjs passou no Main real do Electron 44.4.0, Node 24.21.0 e SQLite 3.53.4. Usar node:sqlite/DatabaseSync sem dependência adicional; interface isola o driver. Persistência, commit/rollback, WAL, foreign keys, unicidade e revisão CAS foram verificados com banco temporário removido ao terminar. Aceite no aplicativo empacotado permanece obrigatório; não inferir desempenho/carga nem empacotamento de produção a partir deste probe.
T2 — APROVADO: JSON canônico e validação estrita do subset utilizado, sem dependência adicional. Não manter duas fontes divergentes de schemas; migração dos schemas Python para o manifesto ainda é tarefa da integração.
T3 — APROVADO: manter as cinco ferramentas sob consentimento existente, agrupadas em computer; módulos novos desligados/não implementados.
T4 — APROVADO: envelope v1 mantido, com negociação explícita do suporte modular e bloqueio operacional modular se incompatível; usar moduleRuntimeVersion=1 e snapshotVersion.
O usuário aprovou as três recomendações antes do início do código; não substituí-las por alternativas silenciosamente.

## Review Focus

1. Dois toggles concorrentes: somente a revisão esperada pode ser persistida — tarefa 2.
2. Mensagem de sessão antiga ou snapshot divergente: nenhuma ferramenta nova executa — tarefa 3.
3. Desativação durante efeito externo: impedir nova execução, solicitar cancelamento e informar efeito já ocorrido/resultado desconhecido, nunca prometer rollback — tarefas 1/3.
4. Configuração inválida ou falha de disco: preservar configuração/segredos e não apresentar toggle salvo — tarefas 2/4.
5. Caminho Live, captura automática e worker direto: mesma política, nenhum bypass — tarefa 3.

## Contratos propostos e responsabilidade

Arquivos de tipos: src/shared/types/modules.ts.
- ModuleId: computer, reminders, pc-health, documents, email, web-research, home-assistant, webhooks, semantic-memory, knowledge-graph, briefings.
- ModuleSnapshot: { id, enabled, configured, authorized, health, lifecycle, revision, errorCode? }; health = healthy | unavailable | error; lifecycle = stopped | starting | running | stopping.
- CapabilityDefinition: { id, moduleId, description, inputSchema, outputSchema, permissions, configurationKeys, effects, timeoutMs, cancellable, verifierId? }.
- ExecutionContext: { taskId, stepId, sessionId, moduleRevision, invocationId }; IDs não são autorização.
- CapabilityResult: { status: succeeded | failed | cancelled | unknown, data?, evidence: Evidence[], errorCode? }; Evidence = { kind, reference, observedAt, verified }. Separar resultado bruto privado da versão redigida pública.
- ModuleService: list(): ModuleSnapshot[]; setEnabled(id: ModuleId, enabled: boolean, expectedRevision: number): Promise<ModuleSnapshot>; configure(id: ModuleId, settings: unknown, expectedRevision: number): Promise<ModuleSnapshot>; diagnose(id: ModuleId): Promise<ModuleSnapshot>.
- ModulePolicy.authorize(capabilityId: string, context: ExecutionContext): AuthorizationDecision; decisão permanece no Main, nunca é aceita do LLM.
- ModuleLifecycle.stop(id: ModuleId, reason: string): Promise<StopReport>; StopReport = { stopped, unknownInvocationIds, errorCode? }.
- ExecutionBroker.invoke(capabilityId: string, args: unknown, context: ExecutionContext): Promise<CapabilityResult>; broker valida input, política, sessão, revisão e output.
- StateDatabase: transaction<T>(action: (tx: StateTransaction) => T): T; close(): void. StateTransaction é um contexto opaco do driver, não exposto ao renderer/Python.

Evidence não pode carregar comandos, tokens, corpos de e-mail ou screenshots em auditoria. Referência não confere permissão de leitura.

## Mapa de arquivos

Criar (somente após gates):
- src/shared/types/modules.ts; src/main/modules/registry.ts, policy.ts, lifecycle.ts, service.ts, execution-broker.ts.
- resources/modules/native-capabilities.json: manifesto canônico proposto das cinco capacidades atuais.
- src/main/storage/state-database.ts; src/main/storage/migrations/001-module-state.sql.
- src/main/modules/invocation-store.ts; src/main/storage/migrations/002-capability-invocations.sql: deduplicação persistente aprovada pelo usuário, substituindo o teto de IDs em memória do primeiro broker.
- jasper-backend/modules/catalog.py e dispatch.py: executor e schemas recebidos/validados, sem autoridade independente.
- src/renderer/ui/module-settings.ts: controlador de cartões, sem segredos.

Modificar: src/shared/index.ts; src/shared/types/config.ts; src/main/config/config-store.ts (somente estado de módulos/migração aprovada); src/shared/constants/ipc-channels.ts; src/preload/index.ts e index.d.ts; src/main/ipc/register-ipc.ts; src/shared/types/backend-protocol.ts; jasper-backend/protocol.py; src/main/services/python-backend.ts; src/main/services/license-gate.ts; jasper-backend/main.py, runtime.py, live_session.py, live_tools.py, tools_os.py; src/renderer/index.html e ui/settings-modal.ts.
Empacotamento: jasper-backend/jasper-backend.spec, electron-builder.yml e manifesto gerado após rebuild. Confirmar inclusão do JSON canônico em ambos os artefatos.

Testes: test/module-registry.test.ts, module-policy.test.ts, module-store.test.ts, module-lifecycle.test.ts, module-ipc.test.ts; jasper-backend/tests/test_module_protocol.py e test_module_dispatch.py; test-artifact/module-runtime.test.ts.

## Tarefa 1 — Registro e política determinística

**Interfaces:** produz CapabilityDefinition, ModulePolicy.authorize e CapabilityResult; consome OperationalAccess.requireAgentAccess(), estado e sessão atuais. Store em memória somente no teste; produto aguarda tarefa 2.

- [ ] Escrever testes em module-registry/module-policy: ID duplicado rejeitado; permissão ausente, módulo desligado, revisão divergente e licença bloqueada retornam denied; consentimento válido + módulo habilitado/configurado permite a chamada sem prompt.
- [ ] Rodar npm.cmd test -- module-registry e npm.cmd test -- module-policy; confirmar falha do comportamento, não falha incidental.
- [ ] Implementar os contratos e registro aprovado por T2. Adaptar schemas das cinco ferramentas sem alterar seus corpos. Argumento inválido nunca chega ao executor; output inválido nunca vira sucesso.
- [ ] Testar o poder real do shell: desativar computer impede run_powershell, mesmo que o LLM o solicite por nome legado. Não afirmar isolamento de arquivos quando shell geral permanece disponível.
- [ ] Reexecutar os testes e npm.cmd test; registrar revisão. Commit sugerido após autorização: feat: add module registry and policy.

## Tarefa 2 — Persistência, migração e lifecycle

**Interfaces:** produz ModuleService, StateDatabase e ModuleLifecycle; consome tarefa 1. Banco de tarefas/agendas novo; configuração de módulo usa armazenamento atual, sem segunda fonte concorrente.

- [ ] Em module-store: revisão inicial 0; setEnabled com expectedRevision=0 produz revision=1; uma segunda alteração com expectedRevision=0 falha sem mudar estado. Falha de escrita preserva bytes/segredos anteriores.
- [ ] Em module-lifecycle: disable bloqueia admissão antes de esperar I/O; encerra observador e fila, invalida geração e pede cancelamento; callback antigo é ignorado. Stop com trabalho não interrompível informa stopping/unknown, não stopped falso.
- [ ] Rodar npm.cmd test -- module-store e -- module-lifecycle, observar vermelho.
- [ ] Após T1/T3 aprovados, implementar store/migração e ciclo de vida. Migração versionada e idempotente; backup recuperável; banco incompatível falha com diagnóstico, sem apagar/migrar destrutivamente.
- [ ] Testar reinício, configuração inválida, dois enables simultâneos e lock de licença durante start. Dados e configuração sobrevivem disable.
- [ ] Rodar testes focados, npm.cmd test e npm.cmd run typecheck; revisar. Commit sugerido: feat: persist module lifecycle.

## Tarefa 3 — Ponte Main/Python e interrupção real

**Interfaces:** ExecutionBroker.invoke, snapshot de catálogo e geração de sessão; adaptador Python executa somente uma invocação aceita na sessão/revisão atuais.

Mensagens propostas (confirmar T4):
- Main → Python: module_snapshot { moduleRuntimeVersion: 1, snapshotVersion, modules, capabilities }; capability_execute { context, capabilityId, args }; invocation_cancel { invocationId, reason }.
- Python → Main: module_snapshot_ack { snapshotVersion }; capability_request { context, capabilityId, args }; capability_result { context, result }.
Fluxo de ferramenta Python: pedido → Main verifica/reserva → Main envia execução autorizada → worker → resultado validado/reconciliado. Ferramenta Main executa localmente após mesma verificação. A confirmação do snapshot não é uma permissão futura ilimitada.

- [ ] Escrever testes cruzados: rejeitar tipo extra, campo desconhecido, payload enorme, ack fora de ordem e sessão antiga; deny não inicia worker. Autorizar e revogar antes do dispatch impede partida.
- [ ] Rodar npm.cmd test -- module-ipc e npm.cmd run test:python; observar vermelho nos testes novos.
- [ ] Adaptar main.py: leitura/decodificação e roteamento de comandos continuam ativos enquanto chat executa em tarefa gerenciada; controlar tarefas e fila de escrita, manter handshake/shutdown ordenados. Não apenas criar outro loop sem controlar EOF e exceções.
- [ ] Fazer texto e Live usarem broker. Cobrir captura automática de tela e worker --live-tool-worker, não apenas tool calls explícitas. Workers não recebem segredo nem acesso ao banco.
- [ ] Testar cancelamento durante ferramenta e lock/desativação antes de dispatch, durante execução e antes do retorno. Um efeito já concluído pode não ser reversível: registrar evidência/unknown.
- [ ] Testar duas requisições em execução sem bloquear interrupt/shutdown e sem misturar replyTo. Regressão de streaming PCM/barge-in.
- [ ] Rodar suítes e artefato; revisar. Commit sugerido: feat: gate text and live tools through module broker.

## Tarefa 4 — Sistema & Automação e aceite da fundação

**Interfaces:** IPC público modules:list, modules:set-enabled, modules:configure e modules:diagnose, com payload estrito, expectedRevision e resposta sem segredo. Nomes são propostos até aprovação do contrato.

- [ ] Testar IPC com origem confiável, licença/consentimento, ID desconhecido, segredo mascarado e gravação recusada; renderer não pode enviar enabled+authorized como prova.
- [ ] Rodar npm.cmd test -- module-ipc; observar vermelho.
- [ ] Implementar controlador separado de cartões na tela atual; erro real desfaz otimismo visual. Somente computer executável nesta fase; demais manifestos informam não implementado e não oferecem falsa ativação operacional.
- [ ] Teste Electron de toggle persistente e layout em janela compacta; manter atalhos/microfone/Live, provedor e onboarding.
- [ ] npm.cmd run verify; npm.cmd run test:python; npm.cmd run scan:secrets.
- [ ] Rebuild sidecar, regenerar manifesto, npm.cmd run test:package; verificar instalação Windows quando disponível, sem declarar aceite se faltarem ambiente/licença.
- [ ] Atualizar runbook com evidências e limites. Commit sugerido: feat: expose module settings and diagnostics.

## Saída e aprovação

**Após correção autorizada (opção 1):** projeção Gemini compartilhada implementada e validada. Live licenciado com ferramentas habilitadas conectou e emitiu áudio em 3.021 ms. Texto passou de HTTP 400 a HTTP 503 ServerError em duas tentativas, portanto permanece reprovado. Suítes: 220 TS, 60 Python e 8 de artefato aprovados; pacote recompilado/verificado. Consultar o registro de progresso para evidências e limites. Não iniciar 02 enquanto o aceite do chat continuar pendente.

**Atualização posterior do aceite real:** REPROVADO com catálogo modular habilitado. Licença e consentimento confirmados no aplicativo real; texto falha HTTP 400 e Live recusa abertura. Sem catálogo, Live respondeu áudio; texto recebeu HTTP 503. Estado computer restaurado após isolamento. Consultar a seção Aceite licenciado real no registro antes de retomar; não iniciar 02 ou declarar a fase concluída. Correção de compatibilidade Gemini aguarda escolha entre projeção de Schema e parameters_json_schema.

**Estado em 26/10/2026:** integração implementada, revisão independente com correções importantes e validação local concluídas. Evidências: 220 testes TS, 58 Python e 8 de artefato; painel Electron, pacote atualizado e smoke sem Python/Node global aprovados. Registro detalhado: [progresso da fundação](2026-10-26-module-foundation-progress.md). Os checklists históricos acima não significam aceite comercial integral: operação licenciada com chamada Gemini real, revisão visual completa e instalação/atualização em VM limpa permanecem sem comprovação nesta rodada. Plano 02 ainda não iniciado; sem commit/push.

Fundação pronta apenas se o desligamento de computer bloquear todas as cinco ferramentas em texto/Live, persistir corretamente e permitir cancelamento/lock sem bypass. Outros módulos são etapas futuras.
Antes de executar: aprovar especificação, T1–T4, plano e método. Não iniciar 02 automaticamente após concluir 01.

