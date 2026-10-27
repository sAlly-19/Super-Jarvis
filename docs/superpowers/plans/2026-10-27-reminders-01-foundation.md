# Lembretes01 — store, calendário e política

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans e TDD após revisão. Método nativo/main preservado; sem commit/push automático.

**Goal:** Persistir lembretes e resolver suas ocorrências de forma previsível.

**Architecture:** Store Main sobre StateDatabase, migração005 e calendário independente do fuso do Windows. Sem habilitar agenda ou ferramentas antes das entregas seguintes.

**Tech Stack:** TypeScript, node:sqlite, Intl/ICU e ical.js autorizado, com versão candidata2.2.1 a confirmar no registro.

**Spec:** [Desenho aprovado](../specs/2026-10-27-reminders-design-draft.md); [contratos comuns](2026-10-27-reminders-00-execution-map.md).

## Global Constraints

Aplicar integralmente os contratos/limites do mapa00. Sem mudanças em computer, agenda em background, dependências além do ical.js aprovado ou API de IA. Datas civis preservam zona/anchorDay; mutações não persistem conversa ou comando.

## Review Focus

Janeiro31/fevereiro/leap year; horário inexistente/duplicado e zona alterada; mesma invocationId com args diferentes; falha na metade de lote; backup/upgrade do banco v4 e conflito de revisão. Casos pertencem às tarefas abaixo.

### Tarefa1 — Schema e armazenamento transacional

**Arquivos:** criar `src/shared/types/reminders.ts`, `src/main/storage/migrations/005-reminders.sql`, `src/main/modules/reminders/store.ts`, `test/reminders-store.test.ts`; alterar `src/shared/index.ts` e loader de migrações em `src/main/modules/application.ts`.

**Interfaces:** produzir tipos e RemindersStore do mapa00. Tabelas reminders (estado/revisão/agenda/UID/base importada), reminder_occurrences (key única/revisão/estado/override), reminder_receipts (invocation_id único/capability/argsHash/IDs), reminder_preferences, reminder_deliveries (occurrence/epoch/estado/horários), reminder_overdue_batches e reminder_overdue_members (batch/occurrence únicos). Títulos ficam somente no domínio; task_events/evidence continuam metadados. Índices UID/origem e próxima ocorrência; migração aditiva sem derrubar004.

- [x] Escrever `create_roundtrips_after_reopen`, `same_invocation_has_one_effect`, `changed_args_same_invocation_rejected`, `stale_revision_keeps_row`, `batch_failure_rolls_back_all`, `v4_upgrade_preserves_history`. Assertar contagem/revisões e rollback reais em SQLite temporário, não mocks do store.
- [x] Rodar `npm.cmd test -- reminders-store`; esperar RED das novas interfaces/asserções. Se falha for ambiente, corrigir setup e observar a falha de comportamento.
- [x] Implementar schema, validação de tipos/limites e mutate/mutateBatch com receipt na mesma transação. Extrair operação privada que recebe StateTransaction para o lote, sem abrir transações aninhadas. Create gera UUID no Main; hashes de args canônicos; delete marca tombstone. Repetir mesma invocação/mesmos args recupera receipt sem efeito; args diferentes rejeitam. UI não escolhe IDs de criação nem verified.
- [x] Implementar list paginada estável/get/preferences e CAS; patch de preferência não reescreve lembretes existentes. Completar recorrente afeta occurrenceKey, não encerra série inteira; completar não recorrente marca item completed. Snooze só muda instância e exige untilUtc futuro.
- [x] Contar no limite de lote os alvos totais, não apenas os envelopes:100 requests com100 IDs cada não podem contornar limite100. Validar todo o lote antes da transação e usar o mesmo receipt recuperável para sua execução lógica.
- [x] Reexecutar teste até GREEN e `npm.cmd run typecheck`; registrar resultados no progresso. Não habilitar switch reminders ainda.

### Tarefa2 — Calendário e invariantes temporais

**Arquivos:** criar `src/main/modules/reminders/calendar.ts`, `test/reminders-calendar.test.ts`, `resources/licenses/ical.js-LICENSE.txt`; alterar `package.json`/`package-lock.json`. Usar os tipos da tarefa1. Store recebe instância de calendário, sem import circular de application.

**Interfaces:** `ReminderCalendar.resolve` e `nextAfter` do mapa00; `Occurrence.key` deriva da hora nominal, não do UTC corrigido. Injeção de clock no serviço/store para validação de futuro; calendário puro não lê relógio global.

- [x] Criar testes com `2027-01-31T09:00:00` e zona America/Sao_Paulo: próximas datas28/02 e31/03; leap year29/02; edit de título não muda scheduleRevision/ocorrência. Testar snooze atravessando outra instância sem fundir as duas.
- [x] Criar fixtures America/New_York:14/03/2027 02:30 resolve para primeiro horário válido03:00;07/11/2027 01:30 usa primeiro instante, uma key. Incluir Asia/Kathmandu para offset fracionário e alteração do TZ do processo sem alterar itens existentes.
- [x] Confirmar `npm.cmd view ical.js@2.2.1 version --registry=https://registry.npmjs.org/` →2.2.1; instalar somente na execução autorizada com `npm.cmd install --save-exact ical.js@2.2.1`, preservando lock e licença do pacote. Se indisponível, parar para decisão, sem latest silencioso. Esse passo pertence à01 porque Calendar também usa RRULE; não reinstalar na04.
- [x] Rodar `npm.cmd test -- reminders-calendar`, observar RED; implementar com Intl.DateTimeFormat/formatToParts para conversão IANA e busca limitada da transição. Validar data civil estrita e zona antes de calcular; nunca usar overflow de Date como correção automática de entrada inválida.
- [x] Otimizar avanço direto de recorrência diária/semanal/mensal nativa a partir da âncora, sem varrer infinitamente anos passados. Hora original volta nas ocorrências seguintes a uma lacuna. Dados importados usam ical.js para RRULE validado e preservam modo RFC conforme codec da04: não aplicar clamp ou reparo de horário inexistente do Jasper a RRULE externo. Limitar expansão; orçamento excedido é erro explícito, não série encerrada. Cobrir a diferença de policies com fixture de RRULE mensal31.
- [x] Rodar `npm.cmd test -- reminders` e `npm.cmd run typecheck`; esperar zero falhas. Registrar cobertura e limites; aprovação desta entrega não afirma que notificações já funcionam.

**Saída para02/03:** store/calendar testados, schema005 disponível e nenhum novo módulo anunciado prematuramente.
