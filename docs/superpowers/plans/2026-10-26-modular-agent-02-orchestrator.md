# Orquestrador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL após autorização: superpowers:executing-plans ou superpowers:subagent-driven-development, conforme escolha do usuário. Este plano não autoriza código.

**Goal:** Transformar objetivos em tarefas compostas verificáveis usando a fundação modular, antes de novas integrações.
**Architecture:** Estender JasperRuntime no Python; Main mantém estado persistido/autoridade e broker. Live e texto compartilham capacidades, políticas e resultados, sem substituir o transporte de áudio.
**Tech Stack:** Provedores atuais, TypeScript/Python, SQLite governado pelo Main e stdio privado versionado.
**Spec:** [Especificação em revisão](../specs/2026-10-26-modular-agent-design-draft.md).
**Depends on:** [Fundação modular](2026-10-26-modular-agent-01-module-foundation.md), incluindo contratos aprovados e teste de cancelamento durante chat.
**Status:** IMPLEMENTADO COM VALIDAÇÃO LOCAL; aceite de objetivo composto com provedor real ainda pendente. Execução e conjunto O1–O5 autorizados pelo usuário em 26/10/2026. Progresso e evidências em [registro do orquestrador](2026-10-26-orchestrator-progress.md). Mantida main, sem commit/push.

O usuário autorizou avançar apesar do HTTP 503 do chat, sem considerar esse erro resolvido. A autorização posterior substitui as notas históricas abaixo de somente planejamento. O1–O5 adotados: sequencial, 8 etapas, 120 s, até 2 revisões, cancelamento de tarefas Live ao encerrar chamada sem cancelar chat independente, metadados sem exclusão automática e unknown sem prova. A implementação inicial valida o teto de revisões, mas não gera revisões/retries automáticos.

## Global Constraints

Todas as restrições do plano 01 se aplicam. Preservar shell/Total Control sem prompts, X atual, módulos, licença, credenciais independentes e MemoryStore.
Não usar texto do LLM como comprovação de resultado. Não abrir HTTP entre processos. Não repetir tarefas interrompidas ao reabrir.
A recuperação aprovada dos lembretes é um resumo no módulo próprio, não um replay de tarefas.
Nenhum serviço, iCal, OAuth, pesquisa web, documentos ou memória vetorial será implementado neste plano.
Não alegar rollback de comando PowerShell nem garantia exactly-once sobre efeitos externos.

## Propostas técnicas a revisar antes da implementação

O1 — Executor sequencial na primeira entrega, com contratos de dependências preparados para paralelismo futuro. Alternativa de paralelismo imediato exige política de locks/recursos e custo; não implementar sem escolha.
O2 — Limites propostos: 8 etapas por plano, 120 segundos por tarefa e máximo de 2 revisões de plano; timeout de cada ferramenta conforme manifesto, sem ampliar silenciosamente limites atuais. Sem retry automático do LLM nesta fase; manter a política explícita existente do adaptador e registrar tentativas. Limites são propostas, não valores já aprovados.
O3 — Fechar/interromper Live: proposta de preservar cancelamento das ferramentas ligadas à chamada; tarefa do chat já independente não é cancelada por esse evento. Alternativa de continuar tarefas da chamada em segundo plano precisa de decisão.
O4 — Persistência: snapshots/eventos redigidos, sem armazenar conversa bruta, screenshots ou comandos PowerShell. Armazenar identificadores e metadados necessários à deduplicação. Retenção das tarefas e limpeza deve ser aprovada, não herdar automaticamente 30 dias da memória.
O5 — Resultado do PowerShell: exit code é evidência de conclusão do processo, não de que um objetivo arbitrário foi atingido. Sem verificador adequado, resultado da etapa/objetivo é unknown ou unverified, nunca succeeded por interpretação do LLM.

## Review Focus

1. Efeito já ocorreu, resposta sumiu: unknown e reconciliação, sem replay — tarefas 1/3.
2. Módulo foi desativado depois do planejamento: broker recusa execução e plano mostra parcial — tarefa 3.
3. Cancelamento encerra worker, mas chamada de provedor ainda responde: ignorar callback antigo e não executar tool — tarefas 2/3.
4. Ordem de dependências inválida, referência circular e output não validado: plano recusado antes de efeito — tarefa 2.
5. Live fechado e task ainda viva: ownership e cancelamento explícitos, sem matar tarefa de outro canal — tarefa 4.

## Contratos propostos

src/shared/types/tasks.ts, espelhados por modelos validados em Python:
- TaskStatus = queued | planning | running | cancelling | cancelled | succeeded | failed | partial | unknown | interrupted.
- StepStatus = pending | running | succeeded | failed | cancelled | skipped | unknown.
- TaskOrigin = chat | live | automation; sessionId também identifica o vínculo Live quando aplicável.
- TaskPlan: { taskId, revision, steps: PlanStep[] }.
- PlanStep: { id, capabilityId, args, dependsOn: string[], bindings: InputBinding[], successCriterion: { verifierId: string, expected: unknown } }.
- InputBinding: { inputField, fromStepId, outputField }. Referências só a outputs de dependências validadas; jamais interpolar strings em comandos shell ou conceder autorização via binding.
- TaskEvent: { taskId, sequence, revision, type, stepId?, summary, occurredAt }; summary redigido.
- TaskRecord: { taskId, origin, status, revision, createdAt, updatedAt, stepStates, evidence, errorCode? }. Pedido/conversa privados permanecem no contexto volátil, não no log do banco.
- TaskStore.create(origin: TaskOrigin): TaskRecord; appendEvent(taskId: string, expectedRevision: number, event: TaskEvent): TaskRecord; get(taskId: string): TaskRecord | null; listActive(): TaskRecord[]; markInterrupted(sessionId: number): void.
- TaskService.cancel(taskId: string, reason: string): Promise<TaskRecord>; status não termina até encerrar trabalho próprio ou reconhecer resultado desconhecido.
- Python: validate_plan(plan: dict, catalog: dict, limits: dict) -> dict; Planner.plan(task_id: str, request: str, catalog: dict) -> dict (async); Executor.run(plan: dict, context: dict) -> dict (async); Verification.verify(step: dict, result: dict) -> dict.
- Broker e CapabilityResult/Evidence são exatamente os do plano 01. Não criar uma segunda política de autorização no Python.

Não existe estado aguardando confirmação por operação; bloqueio por configuração/permissão retorna erro específico. Perguntas para esclarecer objetivo ambíguo são distintas de confirmação repetitiva.

## Mapa de arquivos

Criar src/shared/types/tasks.ts; src/main/tasks/task-store.ts, task-service.ts e task-event-router.ts; src/main/storage/migrations/003-tasks.sql. Versão 002 já reservada para capability_invocations na fundação. Reutilizar InvocationStore no broker; não criar outra autoridade de deduplicação.
Criar jasper-backend/orchestration/__init__.py, contracts.py, planner.py, executor.py e verification.py.
Modificar runtime.py, main.py e live_session.py pelos pontos de entrada existentes, sem reescrever STT/TTS/PCM.
Modificar src/shared/types/backend-protocol.ts, jasper-backend/protocol.py, src/main/ipc/register-ipc.ts, src/preload/index.ts/index.d.ts e src/shared/index.ts.
Criar src/renderer/ui/task-progress.ts; integrar em src/renderer/main.ts/index.html com área discreta e botão cancelar.
Testes: test/task-store.test.ts, task-ipc.test.ts; jasper-backend/tests/test_task_plan.py, test_task_executor.py, test_task_verification.py; test-artifact/orchestrator.test.ts.

## Tarefa 1 — Histórico transacional e recuperação sem replay

**Interfaces:** TaskStore e TaskEvent; consumir StateDatabase do 01, sem abrir banco no sidecar.

- [ ] Teste em task-store: criar task, avançar revisão por CAS e rejeitar evento repetido/fora de ordem. Reservar invocationId de forma única por tarefa/etapa antes do dispatch.
- [ ] Testar crash nos três pontos: antes da reserva, depois da reserva e após efeito sem ack. No retorno, nenhuma execução automática; running/planning/cancelling de sessão encerrada tornam-se interrupted/unknown segundo evidência.
- [ ] Rodar npm.cmd test -- task-store e observar vermelho.
- [x] Implementar migration 003 e API TaskStore; não persistir pedido, argumentos sensíveis nem segredos. Alteração crítica de schema requer backup; rollback de app não remove dados novos silenciosamente.
- [ ] Testar transação abortada e banco incompatível; tarefa não aparece concluída após falha de escrita.
- [ ] Rodar testes focados e npm.cmd test; revisar. Commit sugerido: feat: persist task lifecycle without replay.

## Tarefa 2 — Planejamento assistido por LLM com validação

**Interfaces:** Planner.plan e validate_plan, TaskPlan e catálogo somente de capacidades utilizáveis fornecido pelo 01.

- [ ] Escrever test_task_plan: ciclo A→B→A, dependência inexistente, ID duplicado, capacidade desconhecida, bindings para etapa futura/não dependente e etapa além do limite são rejeitados.
- [ ] Exemplo de assertion proposta: validate_plan de plano com 9 etapas sob max_steps=8 deve rejeitar com código plan_limit; limite só será fixado após O2 aprovado.
- [ ] Rodar python -m unittest discover -s jasper-backend/tests -p test_task_plan.py -v; observar falhas novas.
- [ ] Implementar contratos e validação determinística antes de qualquer execução. Reaproveitar adaptadores; resposta textual inválida do provedor não vira JSON executável por heurística permissiva.
- [ ] Testar instrução maliciosa contida em documento/tool output: não altera módulo/permissão/catálogo; informação externa sempre rotulada como dado não confiável.
- [ ] Replanejamento limitado exige novo plano validado e não reexecuta etapas concluídas por novo ID. Dúvida de intenção retorna solicitação de esclarecimento, não ação presumida.
- [ ] Rodar testes focados e npm.cmd run test:python; revisar. Commit sugerido: feat: validate structured task plans.

## Tarefa 3 — Execução, verificação e efeitos ambíguos

**Interfaces:** Executor.run e Verification.verify; consumir ExecutionBroker.invoke/CapabilityResult do 01 e TaskStore do Main.

- [ ] Escrever test_task_executor: duas etapas dependentes executam em ordem; módulo desativado entre elas bloqueia a segunda; falha não deixa dependente executar; callback de sessão velha não produz chamada.
- [ ] Escrever test_task_verification: processo termina com exit code 0 mas arquivo esperado não existe → não succeeded; confirmação verificável → succeeded; prova indisponível → unknown. PowerShell sem prova de efeito não comprova objetivo.
- [ ] Escrever teste de cancelamento durante worker real: árvore encerrada; efeitos já observados permanecem registrados; etapa pendente não inicia; retorno tardio é descartado para avanço da tarefa.
- [ ] Rodar python -m unittest discover -s jasper-backend/tests -p test_task_*.py -v (no Windows, passar o padrão entre aspas) e observar vermelho.
- [ ] Implementar executor sequencial proposto em O1, prazo/limites aprovados em O2 e verificação por contratos. Não fazer rollback automático de operações arbitrárias nem repetir unknown.
- [ ] Status final: todas as etapas exigidas verificadas → succeeded; alguma verificada e resto falhou/cancelou → partial; efeito não reconciliado → unknown; nenhuma ação iniciada e erro → failed; interrupção explícita sem efeito ambíguo → cancelled.
- [ ] Testar cancelamento do provedor e dos workers separadamente; manter stdin/controle responsivos pelo trabalho do 01. Limite excedido sem ferramenta iniciada não pode anunciar ação realizada.
- [ ] Rodar suites Python/TypeScript e teste de artefato; revisar. Commit sugerido: feat: execute and verify cancellable tasks.

## Tarefa 4 — Texto, Live e interface mínima

**Interfaces:** IPC tasks:list, tasks:get, tasks:cancel e evento tasks:changed; início permanece pelos pontos de entrada de chat/Live existentes. Não adicionar API renderer de execução privilegiada direta.
Mensagens propostas do stdio: task_event (Python→Main), task_event_ack (Main→Python), task_cancel (Main→Python). task_event carrega expectedRevision e sessão; Main persiste e confirma antes de autorizar próxima etapa. Definir tipos exatos com os contratos do 01, sem “qualquer evento” genérico.

- [ ] Teste em task-ipc: origem inválida/licença bloqueada impede acesso; cancelamento de task inexistente retorna not_found; renderer não altera status/revisão arbitrariamente.
- [ ] Teste Live com modelo/áudio atuais: ferramentas fazem o mesmo broker, encerramento respeita O3 e não cancela task origin=chat. Chamada de ferramenta já em curso não é duplicada no catálogo.
- [ ] Rodar npm.cmd test -- task-ipc e testes Live existentes; observar vermelho nos testes novos.
- [ ] Integrar progresso (planejando/executando/verificando/parcial/cancelado) com área existente, sem outra tela de módulos. Registrar cancelamento distinto de mute/barge-in.
- [ ] Testar texto sem tools, objetivo com duas ferramentas existentes, erro HTTP do provedor e falha de TTS. TTS falhar não apaga resultado já comprovado; erro de provedor não vira sucesso.
- [ ] Teste com sidecar compilado: iniciar tarefa longa e enviar cancelamento por stdio antes de ela terminar, verificar ack/encerramento e ausência de novo efeito.
- [ ] npm.cmd run verify; npm.cmd run test:python; npm.cmd run scan:secrets; rebuild/manifesto; npm.cmd run test:package; testes Windows de licença/consentimento e pacote.
- [ ] Atualizar runbook com evidências e limitações. Commit sugerido: feat: expose verified task progress for chat and live.

## Critério de aceite e fronteira da fase

### Evidência atual e limites

- 227 testes TS, 72 Python, 9 de artefato; typecheck/build aprovados. Testes Electron de tarefas, módulos e microfone aprovados.
- Fluxo stdio com Main/Python reais e workers nativos executou duas etapas dependentes de telemetria e persistiu succeeded somente por observação validada no Main. Provedor determinístico exclusivo do teste: não é prova de um LLM real planejando.
- Cancelamento testado após PowerShell gravar seu PID; PID ausente depois da limpeza, tarefa unknown, etapa dependente skipped. Execução sem replay e rejeição de acks/revisões/sessões inválidas cobertas em testes.
- Pacote Windows recompilado e verificado; smoke isolado repetido e aprovado no binário final após a última correção de cancelamento (consultar registro atualizado).
- Chamada real licenciada respondeu áudio com a integração negociada. Chat segue HTTP 503: objetivo composto planejado por modelo real e cancelamento de tarefa longa no sidecar compilado com provedor real não estão comprovados. Instalação/atualização em VM limpa e assinatura comercial não verificadas nesta rodada.
- Referências de evidência ainda não persistidas no histórico; verificador disponível comprova apenas leitura de telemetria. Não anunciar verificação de efeitos arbitrários de PowerShell. Minor de paridade de validadores documentado no registro.

Os checklists históricos detalham também cenários de aceite ainda sem demonstração; não presumir todos concluídos por haver suítes verdes. Nenhuma integração dos planos 03–14 foi iniciada.

Demonstrar um objetivo composto com ferramentas nativas reais, com efeitos autorizados e resultado verificável, e um caso de falha/cancelamento sem sucesso falso. Testes com doubles são válidos para falhas; demonstração de produto não usa integração simulada.
Sem integração de e-mail/web/lembrete nesta fase. Aceite e-mail→lembrete ocorrerá em fases posteriores.
DAG paralelo, retomada automática de tarefas interrompidas e tarefas Live que continuam após fechar chamada não estão aprovados. Revisão deste plano e O1–O5 não substitui autorização de implementação ou publicação.

