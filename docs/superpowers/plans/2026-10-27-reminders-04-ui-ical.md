# Lembretes04 — tela e iCalendar manual

**Estado27/10/2026:** implementado e validado em testes de fonte. Verify264/264, typecheck/build; reminders34/34 e Chromium/worker isolados. [Evidências, rulings e limites](2026-10-27-reminders-progress.md). Retomar05. Checklists preservam o roteiro original; registro de progresso prevalece. Migração006 adicionada para receipts de importação, sem alterar005. Sem commit/push.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans e TDD após revisão. Depende de01–03; main/nativo preservados. Não instalar biblioteca antes da autorização de execução.

**Goal:** Gerenciar lembretes na tela atual e importar/exportar .ics com relatório honesto.

**Architecture:** Renderer envia intenções tipadas; Main controla diálogos/arquivos/política. ical.js em worker thread interpreta arquivos; candidatos retornam ao Main para validação e commit. Sem sincronização remota.

**Tech Stack:** Electron/TypeScript, worker_threads e ical.js2.2.1 candidata, com publicação a confirmar.

**Spec:** [Desenho](../specs/2026-10-27-reminders-design-draft.md); [limites e interfaces00](2026-10-27-reminders-00-execution-map.md).

## Global Constraints

Aplicar00. Arquivos até2MiB/1.000 componentes, seleção manual; eventos no início, tarefas no vencimento, dia inteiro09:00 configurável. Reimportação não sobrescreve edição local. Nenhum anexo/URL/alarme PROCEDURE executado; nada de parser alternativo ad hoc.

## Review Focus

File dialog cancelado/path forjado; arquivo profundo/excessivo; UID repetido ou alterado localmente; TZID/regra sem equivalência; worker ausente do pacote/cancelado durante parse. Cada classe aparece nos testes abaixo.

### Tarefa1 — Codec e importação transacional

**Arquivos:** criar `src/main/modules/reminders/ical-codec.ts`, `ical-worker.ts`, `import-service.ts`, `test/reminders-ical.test.ts`, `test/reminders-import.test.ts`, `test/fixtures/reminders/` com fixtures sintéticas .ics. Alterar `electron.vite.config.ts` para entrypoints index e reminders-ical-worker e ampliar `store.ts` com applyImportBatch. Consumir ical.js/lock/licença já adicionados na01, sem instalar uma segunda versão.

**Interfaces:** ICalendarCodec/ImportCandidate/ImportReport do mapa00. Worker recebe somente bytes/preferences e devolve jCal/candidatos/dados serializáveis; sem DB, rede ou comandos. Main confere output e aplica RemindersImportService. Origin padrão `manual-ics` e UID global identificam item, não hash do arquivo/path que muda a cada reimportação.

- [ ] Criar testes RED: VEVENT DTSTART/VTODO DUE, dia inteiro, UTF-8/escaping/folding, fuso IANA/UTC, daily/weekly/monthly e EXDATE suportados. Importar arquivo idêntico duas vezes mantém contagem/IDs; UID externo com mesmo hash é unchanged; mudança não local atualiza e localEdited preserva/conflita. UID duplicado conflitante no arquivo é relatado sem criar duas rows.
- [ ] Conferir versão exata/lock instalados na01 e rodar os novos testes; observar RED do codec ainda ausente. Não trocar versão ou biblioteca para contornar falha de fixture sem diagnóstico e aprovação correspondente.
- [ ] Implementar ICAL.parse/Component, RecurExpansion e serialização da biblioteca conforme APIs oficiais, validando componentes antes de expandir. Usar zonas IANA do Calendar do Main; não assumir que a biblioteca traz base IANA. VTIMEZONE sem equivalência e semântica que não couber no modelo é rejected com motivo.
- [ ] Validar subset explícito00; não corrigir RRULE importado para política clamp do Jasper. VTODO recorrente cuja relação DTSTART/DUE não puder manter o vencimento equivalente é rejeitado explicitamente. Iteração limitada, worker encerrado ao exceder15s/50.000 passos ou cancelar; Main não fica bloqueado. Não reportar regra interrompida pelo orçamento como encerrada sem próximas ocorrências.
- [ ] Passar AbortSignal explícito do job aos métodos parse/serialize/apply. Disable/revogação/janela destruída/teardown abortam o job e aguardam terminate do worker; resultado atrasado não reabre diálogo nem grava arquivo. Nenhum signal vindo do renderer concede autorização de acesso.
- [ ] Canonicalizar componente sem DTSTAMP volátil para hash de conteúdo; manter base importada e indicador localEdited por mutação real. SEQUENCE externo mais antigo, quando presente e comparável, retorna stale-source no relatório. Aplicar itens aceitos em lotes atômicos de100; cancelamento antes do lote não grava; após lote já gravado retorna relatório parcial com IDs/contagens, sem repetir os lotes.
- [ ] Exportar mantendo UID/tipo de origem e alterações representáveis, ou VTODO para itens Jasper; testar reimportação round-trip de campos/recorrência. Política mensal clamp precisa de RRULE equivalente testado, não BYMONTHDAY31 que pula fevereiro. Estado/exceção ou política de DST sem equivalente causa erro de exportação antes de escrever, sem arquivo incompleto ou downgrade silencioso.
- [ ] Rodar `npm.cmd test -- reminders-ical` e `npm.cmd test -- reminders-import` até GREEN, depois `npm.cmd run typecheck`/build. Verificar worker em out/main/reminders-ical-worker.js e licença do pacote distribuída.

### Tarefa2 — IPC, tela e resumo de atrasados

**Arquivos:** criar `src/main/ipc/reminders-ipc.ts`, `src/renderer/ui/reminders-settings.ts`, `test/reminders-ipc.test.ts`, `test/reminders-ui.test.ts`; alterar `src/main/ipc/register-ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts` (ElectronAPI/Window real), `src/shared/constants/ipc-channels.ts`, `src/shared/types/agent-api.ts` para payloads, `src/renderer/ui/settings-modal.ts`, `module-settings.ts`, `src/renderer/index.html` e `src/renderer/styles/modal.css` que atende os cards.

**Interfaces:** canais REMINDERS_LIST/GET/MUTATE/PREFERENCES/IMPORT/EXPORT/CHANGED/OVERDUE/ACK_OVERDUE. Preload expõe métodos tipados, sem ipcRenderer genérico. Handlers usam assertTrustedSender/requireIpcAccess existentes e gate de domínio; nenhum canal novo entra em LOCKED_ALLOWED_CHANNELS. UI opera sem modelo conectado, com licença/consentimento válidos.

- [ ] Criar RED: remetente não confiável/licença inválida não abre diálogo nem lê banco; path enviado pelo renderer é rejeitado; cancelamento do diálogo é no-op; títulos HTML são textContent; get/list e lote inválido não viram operações de filesystem.
- [ ] Implementar diálogos exclusivamente Main. Importação guarda bytes selecionados/preview sob token Main ligado à janela e hash; alterações no arquivo não mudam o conteúdo entre preview e commit. Para exportação, dialog.save obtém destino; gerar bytes completos antes de escrita atômica, respeitando decisão explícita do diálogo para arquivo existente. Sem downloads de URLs de .ics.
- [ ] Adicionar editor/lista/paginação e preferências no painel existente; switches reminders habilitáveis sem alterar computer. CRUD reutiliza RemindersService e mesmas regras/provas; IPC de UI não cria outro executor sem política. Mostrar fuso do item, ajuste de horário e relatórios de importação, sem segredos/paths em logs.
- [ ] Renderizar OverdueBatch depois de acesso válido, deduplicar por batchId e enviar ack só após montar resumo visível. Paginação permite consultar todos; resumo contém total real. Ack atrasado de janela/sessão velha não marca batch novo. Nenhum botão de confirmação operacional adicional.
- [ ] Rodar `npm.cmd test -- reminders`, `npm.cmd run typecheck` e `npm.cmd run build`; esperar GREEN. Registrar que testes de DOM não provam toast Windows, a ser coberto na05.

**Saída para05:** interface/codec/IPC completos; exceções não suportadas aparecem com motivo antes de perder dados.
