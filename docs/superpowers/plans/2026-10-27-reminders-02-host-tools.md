# Lembretes02 — broker multi-module e ferramentas Main

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans e TDD após revisão; executar depois de01, em main sem commit/push.

**Goal:** Permitir ao orquestrador operar lembretes no Main e verificar as mutações reais.

**Architecture:** Mesmo broker/política/snapshot; roteamento por moduleId do registro confiável. Computer continua no sidecar; reminders usa executor Main. Não restaurar plano A ou criar canal de execução paralelo.

**Tech Stack:** Electron/TypeScript e Python existentes.

**Spec:** [Desenho](../specs/2026-10-27-reminders-design-draft.md); [interfaces/limites00](2026-10-27-reminders-00-execution-map.md).

## Global Constraints

Todos os contratos00/01. Consentimento geral, licença, snapshot/revisão/sessão e cancelamento continuam obrigatórios. Cinco capacidades computer preservadas sem novas restrições de caminho. Módulo reminders desativado por padrão; banco/CRUD não dependem de chave de IA para a tela local.

## Review Focus

Revisão do módulo errado; módulo sem executor cair no sidecar; falso verified enviado pelo modelo; disable de reminders afetar computer; callback stale após cancel/revogação. Cada caso precisa aparecer nos testes desta entrega.

### Tarefa1 — Roteamento e política por módulo

**Arquivos:** alterar `src/main/modules/runtime-bridge.ts`, `service.ts`, `application.ts`, `jasper-backend/module_bridge.py`, `src/shared/types/modules.ts` somente se necessário; criar `test/reminders-routing.test.ts`; estender `test/module-runtime-bridge.test.ts`, `module-broker.test.ts` e testes Python existentes do bridge.

**Interfaces:** bridge recebe `getRevision(moduleId: ModuleId): number` e mapa opcional de `HostCapabilityExecutor`; `stopModule(moduleId): Promise<StopReport>` encerra só invocações desse módulo. `close()` encerra todos; snapshot autoriza cada capacidade com revisão de seu módulo. ModuleService recebe conjunto explícito de módulos implementados; default mantém computer nos testes antigos.

- [x] Escrever RED: reminders revisão7/computer revisão2 coexistem; host executor não emite capability_execute; módulo novo sem handler falha fechado; disable reminders mantém computer operacional; stale snapshot/sessão não chega ao store. Incluir computer com worker ainda em execução durante atualização do catálogo de reminders: resultado não pode ser cancelado apenas por mudança do outro módulo.
- [x] Rodar `npm.cmd test -- reminders-routing`; observar falhas antes da implementação.
- [x] Implementar roteamento usando registry.get(capabilityId).moduleId, nunca campo de autorização do payload. Reusar ExecutionBroker e InvocationStore. Handler Main valida signal/acesso antes de commit e após awaits; sem fallback para Python no módulo novo.
- [x] Generalizar synchronize/close/lifecycle e catálogo por módulo. synchronize cancela apenas capacidades/módulos cujo catálogo/autorização mudou, não todos os workers; close global encerra todos. Python ModuleBridge.snapshot hoje cancela todos os pending/executing: guardar metadata requestId/capability/grant e reconciliar diferencialmente. Preservar grant em curso de capacidade inalterada e rejeitar grant sem pedido pendente/definição correspondente; testar troca de snapshot durante resposta atrasada. Não reexecutar pedido antigo para reconciliar.
- [x] Desligar reminders chama stop do scheduler/execuções desse módulo, sem close global ou desativação de computer. Disponibilidade local de reminders não exige conexão ao modelo; ferramentas de chat exigem snapshot negociado. Refresh não dispara efeito novo nem encerra a chamada Live; habilitar novas ferramentas exige renovar a chamada, conforme escolha anterior.
- [x] Reexecutar testes até GREEN, `npm.cmd test -- module` e typecheck. Ajustar teste do planoB para comparar apenas registry.list filtrado por moduleId=computer; não apagar sua garantia de cinco ferramentas.

### Tarefa2 — Ferramentas e prova Main

**Arquivos:** criar `src/main/modules/reminders/service.ts`, `capabilities.ts`, `test/reminders-tools.test.ts`; alterar `resources/modules/native-capabilities.json`, `src/main/tasks/task-service.ts`, `jasper-backend/orchestration/contracts.py`, `planner.py`, `diagnostics.py`, `runtime.py` e testes Python de planner/responder.

**Interfaces:** sete capacidades `reminder_create/list/get/update/delete/complete/snooze` com schemas estritos correspondentes aos tipos00; permissions `reminders.read` ou `reminders.write`, timeout5.000ms, sem access a arquivos pela ferramenta. Leitura retorna registro/lista; escrita retorna IDs/revisões e receiptRef opaca. Verificadores `reminder_read` e `reminder_write`, expected=null; não receber esses campos como permissão do cliente.

- [x] Criar RED para CRUD completo, lote inválido atômico, filtros/lista vazia, recibo com argumentos diferentes, prova forjada e cancelamento antes do commit. Mutação confirmada deve permitir etapa dependente; erro/unknown não.
- [x] Implementar RemindersService.execute/verify do mapa00. Prova vem do store/receipt na mesma autoridade que fez a transação, conferida pelo contexto da invocação; não confiar em result.verified ou saída do sidecar. Integrar callback de verificação opcional em TaskService, preservando telemetry_read.
- [x] Para get/list, guardar observação de leitura temporária por invocationId no Main, inclusive lista vazia, para prova daquele snapshot/horário. Para escritas, conferir receipt persistido com invocação/capacidade/IDs. Remover observações voláteis no encerramento da etapa/sessão; não usar nova consulta posterior para fingir que foi o snapshot originalmente lido.
- [x] Persistir somente refs/IDs/kind no histórico de tarefas, sem títulos/descrições. Não reaplicar mutação para conferir prova; usar receipt/readback. Se cancelamento ocorrer depois do commit, preservar receipt e relatar efeito observado ou unknown se contexto invalidado, sem rollback/replay inventado.
- [x] Integrar critérios no Python/planner e diagnósticos limitados no compositor contextual. Live conhece as novas ferramentas somente ao renovar sessão conforme decisão anterior; desligamento bloqueia imediatamente o despacho.
- [x] Rodar `npm.cmd test -- reminders`, `npm.cmd run test:python`, `npm.cmd run typecheck`; esperar zero falhas. Confirmar que nenhuma ferramenta nova de reminders foi adicionada a AVAILABLE_FUNCTIONS do worker Python.

**Saída para03/04:** executor Main e ferramentas verificadas; ainda não prometer notificações/importação.
