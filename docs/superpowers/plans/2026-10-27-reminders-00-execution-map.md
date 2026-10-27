# Lembretes — mapa executivo e contratos comuns

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Etapas01–04 implementadas; validações locais05/pacote aprovadas. Método nativo e main já escolhidos. Retomar pelo progresso05: falta aceite operacional comercial licenciado/X/restart, não refazer builds sem mudança. Assinatura e VM limpa são gates separados; não iniciar próximo módulo automaticamente.

**Goal:** Entregar lembretes persistentes, notificações e intercâmbio manual .ics integrados ao orquestrador.

**Architecture:** Main é dono do SQLite, agenda, política e efeitos. Python planeja e recebe resultados verificáveis; renderer usa IPC validado. Codec ical.js interpreta arquivos, sem HTTP, CalDAV ou execução de alarmes externos.

**Tech Stack:** Electron/TypeScript, node:sqlite, Python existente e ical.js autorizado. Sem outro pacote de datas, scheduler ou banco.

**Spec:** [Desenho aprovado](../specs/2026-10-27-reminders-design-draft.md). Desenho e planos aprovados; [estado de execução](2026-10-27-reminders-progress.md).

## Ordem e entregas

1. [01 — Store, calendário e política](2026-10-27-reminders-01-foundation.md).
2. [02 — Broker e ferramentas no Main](2026-10-27-reminders-02-host-tools.md).
3. [03 — Scheduler e notificações](2026-10-27-reminders-03-scheduler.md).
4. [04 — Tela e iCalendar manual](2026-10-27-reminders-04-ui-ical.md).
5. [05 — Aceite integrado e pacote](2026-10-27-reminders-05-acceptance.md).

Executar nessa ordem; nenhuma entrega precisa reimplementar computer. Atualizar [progresso](2026-10-27-reminders-progress.md) após cada tarefa. Sem commits/push automáticos.

## Global Constraints — vinculantes para os cinco planos

- Preservar planoB: somente as cinco capacidades existentes do módulo computer, PowerShell livre, respostas contextuais e nenhuma restauração do guard/catálogo A.
- Licença72h e consentimento geral da instalação; sem confirmação por operação. Reminders começa desativado e usa o switch existente. Desligar preserva dados, impede novos efeitos e invalida callbacks pendentes.
- Agenda funciona com app aberto, inclusive minimizado. X/encerramento permanecem; sem bandeja, serviço, tarefa Windows ou inicialização automática.
- Reabertura/resume: resumo de vencidos, sem disparos individuais retroativos, comandos ou replay. Exibir não é ler/concluir/adiar.
- Mensal31 usa último dia nos meses curtos e mantém anchorDay31. Fuso original preservado até edição; lacuna de horário usa primeiro instante válido seguinte; repetição usa o primeiro instante e uma notificação por instância.
- Padrão de dia inteiro09:00, ajustável. Mudanças de preferência só afetam novos itens/importações. Datas ambíguas pedem esclarecimento de intenção.
- .ics manual: VEVENT no DTSTART e VTODO no DUE; sem data utilizável informa rejeição. Reimportar atualiza não editados localmente; conflitos preservam local. UID estável; nada de duplicação por mesmo arquivo.
- Limites aprovados no desenho:2MiB/1.000 componentes; título200, descrição4.000; página100 e lote100. Lote de mutação atômico; importação relata cada item rejeitado/conflitante.
- Tests novos usam clock fake, dados sintéticos e diretórios temporários; sem modelos/voz, calendário pessoal ou notificação no perfil real. Provedor real, assinatura comercial e VM limpa são gates distintos, não concluídos por testes determinísticos.

## Review Focus — mapa dos riscos

1. Janeiro31→fevereiro→março, DST, fuso do Windows e snooze atravessando a próxima recorrência —01/03.
2. Dois callbacks/reimportações/retries concorrentes ou CAS antigo não duplicam/criam efeito parcial —01/02/03/04.
3. Revogação/desligamento entre claim e apresentação bloqueia o efeito; independência de computer/reminders —02/03.
4. .ics malformado, UID conflitante, componente remoto/alarme, fuso/regra não representável —04.
5. Crash após efeito e antes de ack, atualização de SQLite e binário sem worker/codec/migração —01/03/05.

## Contratos canônicos a criar

Arquivo de tipos: `src/shared/types/reminders.ts`, reexportado em `src/shared/index.ts`.

- `CivilSchedule`: união de `NativeSchedule` e `ImportedSchedule`, ambos com `{ localDateTime: string; timeZone: string; recurrence: 'none'|'daily'|'weekly'|'monthly'; anchorDay: number }`. NativeSchedule tem `policy:'jasper'`; ImportedSchedule tem `policy:'ical'` e `icalRule:{rrule:string|null,exdates:string[]}`. localDateTime canônico `YYYY-MM-DDTHH:mm:ss`; timeZone IANA validado. UTC explícito é aceito como zona UTC; nunca converter string inválida para horário atual. Create/update por ferramenta ou formulário aceita só NativeSchedule; ImportedSchedule nasce do codec validado, não de campos ocultos do renderer/modelo.
- `Reminder`: `{ id, revision, scheduleRevision, title, description, schedule: CivilSchedule, nextDueUtc: string|null, state:'active'|'completed'|'deleted', source:'jasper'|'ical', uid, sourceHash:string|null, localEdited:boolean, createdAt, updatedAt }`, mais `icalSource:null|{component:'vevent'|'vtodo',allDay:boolean,sequence:number|null,dtstamp:string|null,canonicalComponent:string}`. Horários UTC em ISO8601 com Z; IDs UUID Main. scheduleRevision só muda ao alterar efetivamente agenda; título não reenvia aviso. Componente canônico fica só no domínio/importação, nunca no histórico de tarefas/logs.
- `Occurrence`: `{ key, reminderId, scheduleRevision, nominalLocalTime, dueUtc, state:'pending'|'notified'|'completed'|'missed'|'cancelled', snoozedUntilUtc:string|null }`. key opaca determinística de reminderId/scheduleRevision/hora civil nominal, não do instante ajustado por DST. Snooze afeta só essa instância; não altera a série nem funde instâncias distintas.
- `MutationContext`: `{ invocationId:string; nowUtc:string }`, criado pelo Main. `ReminderReceipt`: `{ invocationId, capabilityId, argsHash, affected:Array<{id,revision}>, committedAt }`; sem título/descrição no histórico de tarefas. Receipt fica no banco do domínio, transacional com a mutação.
- `ReminderPreferences`: `{ timeZone:string; allDayTime:string; notificationsEnabled:boolean; revision:number }`; allDayTime HH:mm. Preferências em SQLite, não duplicar o switch modules.json.
- `ReminderListQuery`: `{ state?:'active'|'completed'; fromUtc?:string; toUtc?:string; cursor?:string; limit:number }`, limit1–100; resposta `{items:Reminder[],nextCursor:string|null}` com ordenação estável nextDueUtc/id.
- `MutationRequest`: união discriminada create/update/delete/complete/snooze. create contém title/description/schedule; update contém id/expectedRevision e patch explícito; delete contém até100 pares id/expectedRevision e tombstone, não apaga histórico; complete contém id/expectedRevision/occurrenceKey; snooze acrescenta untilUtc estritamente futuro. Sem campo authorized/verified vindo de renderer/modelo.
- `ImportReport`: `{created:number,updated:number,unchanged:number,conflicts:Array<{uid,reason}>,rejected:Array<{uid?:string,reason}>,warnings:string[]}`. Não incluir arquivo integral/path/descrições nos logs.
- `OverdueBatch`: `{id:string,occurrenceKeys:string[],createdAt:string,acknowledgedAt:string|null}`. Mesmo batch/IDs na recuperação de apresentação não confirmada.

## Interfaces entre planos

01 produz `ReminderCalendar.resolve(schedule): {utc:string,adjusted:boolean}` e `nextAfter(schedule, afterUtc): {nominalLocalTime:string,utc:string}|null`; usa Intl/ICU para zonas IANA e ical.js para RRULE importado, sem depender de Date.parse de hora local do Windows. `RemindersStore.mutate(request,context): {items:Reminder[],receipt:ReminderReceipt}`, `mutateBatch(requests,context)` para até100 requisições atômicas, `get(id)`, `list(query)`, `getReceipt(invocationId)`, `getPreferences()`, `updatePreferences(patch,expectedRevision)` e `withTransaction` privado. Mesma transaction executa mutação e receipt, sem callbacks assíncronos ou transações aninhadas. Banco usa StateDatabase existente, sem conexão Python.

02 produz `RemindersService.execute(capabilityId,args,context,signal): Promise<unknown>` e `verify(context,capabilityId,result): CapabilityResult`; dependências store/policy/clock injetadas. `HostCapabilityExecutor` tem a mesma assinatura do executor do broker existente. Bridge aceita `getRevision(moduleId)` e mapa de executores Main por moduleId; computer continua no sidecar. Sem executor registrado, falha fechada para módulo novo.

03 produz `RemindersScheduler.start()`, `stop()`, `tick(nowUtc)`, `recover(nowUtc)` e `acknowledgeBatch(batchId)`; dependências clock/store/policy/notifier/renderer injetadas. Notifier oferece `show(occurrence): Promise<'shown'|'unavailable'>`, sem alegação de leitura. Store adiciona métodos transacionais de claim e batches nessa entrega, sobre as tabelas da01.

04 produz `ICalendarCodec.parse(bytes,preferences,signal:AbortSignal): Promise<{candidates:ImportCandidate[],report:ImportReport}>` e `serialize(items,signal:AbortSignal): Promise<Uint8Array>`; `ImportCandidate`, definido nos tipos compartilhados, contém UID, hash canônico, icalSource, título/descrição e ImportedSchedule suportado, nunca autorização. `RemindersImportService.apply(candidates,context,signal:AbortSignal): Promise<ImportReport>` valida e chama `RemindersStore.applyImportBatch(candidates,context)` por lote no Main, com yield e reconferência de signal entre lotes; esse método síncrono do store é acrescentado na04 e não chama mutate dentro de outra transação. `ReminderImportRequestId` Main liga preview ao conteúdo já selecionado, sem reabrir path enviado pelo renderer. Main possui AbortController por job, abortado em disable/revogação/encerramento da janela ou app.

## Detalhes a revisar no plano, não decisões silenciosas na execução

ical.js2.2.1 confirmado por npm view e instalado --save-exact --ignore-scripts na etapa01, com lock/licença. Fonte inicial: [package.json oficial](https://github.com/kewisch/ical.js/blob/main/package.json). Não trocar versão ou biblioteca silenciosamente.

O subset inicial importa DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT/UNTIL e EXDATE representáveis; RDATE/overrides RECURRENCE-ID, BYSETPOS arbitrário e VTIMEZONE sem zona IANA equivalente exigem relatório de não suportado. Exportação da regra mensal clamp usa representação equivalente, incluindo BYSETPOS quando gerada internamente e testada. Exportação sem equivalência de estados/exceções falha explicitamente antes de escrever arquivo; nenhuma perda silenciosa. Esse limite de cobertura integra a revisão do plano.

Parser/expansão .ics em worker thread pertencente ao Main, não na thread da janela nem no sidecar. Worker não acessa banco, rede, notificações ou comandos; Main valida seus candidatos. Prazo15s e encerramento do worker em cancelamento; expansão máxima50.000 passos por componente, rejeitando como orçamento excedido, nunca como série encerrada. Esses limites técnicos adicionais estão propostos nesta revisão dos planos, não implementados.

## Aceite documental e ponto de retomada

Revisão/aprovação dos cinco planos recebida. Método nativo/main permanece. Etapas01–02 executadas; seguir o progresso para não refazer trabalho nem anunciar agenda/notificações antes de03–05. As referências a propostas descrevem o desenho aprovado; novas alternativas materiais ainda devem ser apresentadas ao usuário.
