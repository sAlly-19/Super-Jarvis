# Lembretes03 — scheduler, notificações e retomada

**Estado27/10/2026:** implementação e testes de fonte concluídos. Verify:252 testes TS, typecheck e build; reminders22/22. [Evidências, decisões e limites](2026-10-27-reminders-progress.md). Notificação real/pacote não alegados; apresentação renderer vem04 e aceite05. Checklists abaixo preservam o roteiro original; o registro de progresso prevalece como ponto de retomada.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans e TDD após revisão. Depende de01/02; main e método nativo preservados, sem commit/push.

**Goal:** Avisar ocorrências enquanto o app está aberto e recuperar vencidos por resumo.

**Architecture:** Scheduler Main com clock/notifier injetados e claims SQLite. Estado de entrega separado de leitura/conclusão. Não cria processo de agenda independente.

**Tech Stack:** Electron Notification/powerMonitor, TypeScript e SQLite existentes.

**Spec:** [Desenho](../specs/2026-10-27-reminders-design-draft.md); [contratos00](2026-10-27-reminders-00-execution-map.md).

## Global Constraints

Aplicam-se00/01/02. App encerrado não agenda; minimizar mantém processo. Startup/resume/reativação recuperam vencidos por resumo, sem disparar notificações antigas individualmente. Hora duplicada gera uma instância. Nenhuma ação de computador está associada ao aviso.

## Review Focus

Dois ticks simultâneos; disable/revogação entre claim e show; crash antes/depois da apresentação/ack; suspend/resume antes do ticker; série editada/snoozed enquanto callback está pendente. Testar efeitos reais do fake notifier e estados SQLite, não apenas quantidade de chamadas do scheduler.

### Tarefa1 — Claims e entrega em execução normal

**Arquivos:** criar `src/main/modules/reminders/scheduler.ts`, `notifier.ts`, `test/reminders-scheduler.test.ts`; estender `store.ts` da01. Composição em `src/main/modules/reminders/application.ts` novo e `src/main/modules/application.ts` existente.

**Interfaces:** scheduler do mapa00. Store acrescenta `claimDue(nowUtc,epoch): Occurrence[]`, `markDelivery(key,epoch,state)`, `releaseClaims(epoch)`; epoch pertence à geração autorizada do scheduler. Tabelas deliveries/occurrences com chaves únicas, sem remover rows para permitir deduplicação após reinício.

- [ ] Criar RED: dois schedulers/duas conexões no mesmo arquivo reivindicam uma única ocorrência; clock avança e dispara só uma; referência nominal de horário repetido não duplica; edit de título não reenvia; snooze muda só a instância escolhida.
- [ ] Rodar `npm.cmd test -- reminders-scheduler`, observar falhas. Implementar ticker1s com trabalho serializado e lote até100 claims, sem bloquear por duração de notificação. Iniciar somente após recuperação e acesso válido. Reutilizar Calendar.nextAfter para manter próxima ocorrência armazenada.
- [ ] Antes de chamar Notification.show, reconferir licença, consentimento, switch, preferência e epoch. `shown` significa evento show aceito pelo Windows, não leitura; Notification.isSupported=false mantém diagnóstico/estado para resumo no app, sem dizer que houve aviso.
- [ ] `stop()` incrementa epoch, remove timers/listeners ativos e invalida callbacks; cancela claims ainda não apresentados. O Windows pode já ter aceitado um toast antes da revogação: não prometer recolhimento nem ausência retroativa desse efeito. Resultado incerto fica recuperável, sem repetir individualmente.
- [ ] Reexecutar teste GREEN e incluir `disabled_between_claim_and_show`, `revoked_while_show_pending`, `old_schedule_revision_cannot_notify`, `unsupported_notifier_is_not_shown`.

### Tarefa2 — Recuperação e resumo confirmado pelo renderer

**Arquivos:** criar `test/reminders-recovery.test.ts`; alterar scheduler/store/notifier e `src/main/index.ts` para powerMonitor e teardown. Eventos/preload/UI de apresentação completados na04; nesta entrega usar renderer fake que emite ack.

**Interfaces:** `recover(nowUtc)` cria/reutiliza OverdueBatch; `acknowledgeBatch(batchId)` aceita somente batch realmente entregue à sessão de janela vigente. Payload `{batchId,total,preview,cursor}` contém até100 itens; membros completos ficam no banco para paginação. Ack é confirmação de apresentação do renderer, não confirmação operacional do usuário.

- [ ] Escrever RED: fechar/reabrir arquivoSQLite, suspend→resume, batch mostrado sem ack seguido de crash, ack duplicado e múltiplos resumes simultâneos. Assertar mesmo batchId, nenhuma ação antiga e nenhum item marcado completed/read pela apresentação.
- [ ] Implementar recover antes de habilitar tick após startup/resume/enable: vencidos anteriores a now viram missed/summary, novas próximas datas são calculadas sem executar ações passadas. Paginar processamento de séries longas com yield; manter checkpoint para não perder ocorrência se encerrar no meio. Não expandir série infinita de uma vez.
- [ ] Se crash ocorrer antes do ack, reapresentar mesmo batch na próxima janela autorizada. UI deduplica mesmo batch na sessão atual; após crash completo a reapresentação é permitida e documentada. Se janela não existe, manter pending. Confirmar batch não altera o estado funcional dos lembretes.
- [ ] Integrar powerMonitor suspend/resume sem bandeja/close-to-tray; fechamento do app encerra scheduler antes de fechar StateDatabase. Inicializar acesso/notificações mesmo sem modelo conectado; revogação desliga entrega e preserva dados. Preferência notificationsEnabled=false suprime toast; resumo continua acessível no painel, sem notificação forçada.
- [ ] Rodar `npm.cmd test -- reminders`, `npm.cmd run typecheck`; registrar GREEN e janela de apresentação incerta. Não alegar exatamente uma leitura pelo usuário ou entrega com app encerrado.

**Saída para04/05:** scheduler e recuperação testados com notifier/clock sintéticos; falta validar apresentação real no perfil isolado.
