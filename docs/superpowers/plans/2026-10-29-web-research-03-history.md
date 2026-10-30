# Pesquisa web03 — histórico cifrado e recibos de resumo

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, método nativo; TDD task-by-task. Não alterar o perfil real para testar migrações/cifragem.

**Goal:** Guardar as dez últimas pesquisas com conteúdo limitado e atualização segura de resumo.
**Architecture:** SQLite Main reutilizado, migração aditiva009 e payload protegido por safeStorage/DPAPI. Recibos de uso único vinculam resumo à pesquisa/sessão sem conceder autoridade sobre fontes.
**Tech Stack:** node:sqlite, safeStorage, TypeScript; sem biblioteca nova nesta etapa.
**Spec:** [desenho](../specs/2026-10-29-web-research-design.md). **Depends on:** contratos01/02 no [mapa00](2026-10-29-web-research-00-execution-map.md); sem depender de capacidades já publicadas.

## Global Constraints

Restrições00. Dez registros, três páginas distintas por registro, texto48KiB UTF-8/página, payload serializado256KiB antes de cifrar, resumo4.000 caracteres. Ticket64hex/5min/uso único, no máximo30 pendentes. Sem plaintext, exclusão automática por idade ou sincronização. Limpar é exclusão lógica, não apagamento forense. Não alterar memória/tarefas/e-mail.

## Review Focus

1. Resposta da pesquisa1 termina depois da11 e não pode expulsar a11 nem recriar a1 — Task2.
2. Limpar enquanto há rede/resumo pendente impede repovoamento — Tasks2/3.
3. Falha DPAPI/corrupção não sobrescreve histórico cifrado com estado vazio — Tasks1/2.
4. Resumo forjado, de outra sessão ou expirado não muda conteúdo/prova — Task3.
5. Limite em caracteres não basta para Unicode/escape JSON; payload deve respeitar256KiB reais — Tasks1/2.

## Task1 — tipos e codec cifrado

**Files:** estender src/shared/types/web-research.ts de01/02; criar src/main/modules/web-research/history-codec.ts e test/web-history-codec.test.ts. Exportar tipos por src/shared/index.ts, sem fazer shared importar arquivos do Main.
**Interfaces:** tipos do mapa00; `HistoryCrypto={available():boolean;encrypt(text:string):Uint8Array;decrypt(bytes:Uint8Array):string}`; `WebHistoryCodec.encode(record:WebResearchRecord):Uint8Array`, `decode(bytes:Uint8Array):WebResearchRecord`. Injetar crypto; produção usa safeStorage somente na composição04.

- [x] RED: encode/decode round-trip com crypto fake reversível e sentinelas; assert que payload enviado ao encrypt possui até262.144bytes, estrutura estrita e três páginas no máximo; byte-array final não é cópia em plaintext. Proteção falsa/erro lança web_history_unavailable e não chama persistência.
- [x] RED: documento truncado/malformado, versão desconhecida, campos extras/IDs inválidos e texto maior que48KiB são rejeitados; Unicode e aspas escapadas entram no orçamento em bytes. Rodar `node scripts/run-tests.mjs web-history-codec`; RED.
- [x] GREEN: codec com documento cifrado de envelope `{schemaVersion:1,record}`; limites antes de encrypt e depois de decrypt/parse, teto de512KiB para ciphertext de entrada. Não registrar dados do erro/cifragem. O codec valida, não transforma HTML nem faz rede. Rodar teste e typecheck; PASS.

## Task2 — retenção, migração e limpeza concorrente

**Files:** criar src/main/storage/migrations/009-web-research.sql; src/main/modules/web-research/history-store.ts; test/web-history-store.test.ts; test/fixtures/web/database.ts.
**Interfaces:** `WebHistoryStore(database:StateDatabase,codec:WebHistoryCodec,deps:{now():string;id():string})`; métodos síncronos `begin(query:string):ResearchHandle`, `get(id:string):WebResearchRecord|null`, `list():HistorySnapshot`, `handle(id:string):ResearchHandle|null`, `addResults(handle,outcome:SearchOutcome):void`, `addPage(handle,outcome:ReadOutcome):void`, `setSummary(handle,summary:string):void`, `cancel(handle):void`, `clear(expectedGeneration:number):HistorySnapshot`, `contains(handle):boolean`. Não fazer await dentro de StateDatabase.transaction.

- [x] RED: abrir DB8 sintético e migrar para9 mantendo dados anteriores; verificar user_version9, backup/snapshot do StateDatabase e inexistência de texto/URL/sentinelas em colunas não cifradas. Usar fixtures próprias; não alterar versão dos testes históricos que intencionalmente exercitam DB8.
- [x] RED: criar11 registros, assert list.items.length===10, id1 ausente/id11 presente; callback tardio addPage/setSummary do1 lança history_changed sem upsert. Inserção+prune atômicos: falha de cifragem/INSERT não elimina o anterior. Ordem por sequence, não updatedAt.
- [x] RED: clear(generation) invalida handle antigo e clear com geração antiga é rejeitado; resultado tardio não recria pesquisa. Quarta página distinta remove a mais antiga; nova leitura da mesma URL final substitui e move para o fim, sem quarta duplicata. Serialização com escapes mantém teto, truncando conteúdo com flag em vez de descartar a resposta de rede.
- [x] RED: falha de proteção, blob corrupto e erro SQL preservam dados cifrados; nenhuma tentativa de gravar doc vazio. Rodar `node scripts/run-tests.mjs web-history-store`; RED.
- [x] GREEN: schema `web_research_meta(singleton=1,generation>=0)` e `web_research_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,created_at,updated_at,state,sealed_payload BLOB)`; sem consulta/URL/resumo/texto em colunas claras. Atualizações exigem geração atual e registro existente, não usam INSERT OR REPLACE. Criar registro cifrado e podar excedentes na mesma transação. Não resetar sequência ao limpar.
- [x] GREEN: list indisponível retorna storage:unavailable e geração do meta, com lista não utilizável e aviso na fachada; não converte falha de decrypt em sucesso vazio nem grava alteração. get de blob corrupto lança web_history_unavailable. clear explícito independe de decrypt e não faz rede.
- [x] GREEN: limitar queries/metadados conforme00 e reduzir texto das páginas mais antigas em fronteira UTF-8 até satisfazer256KiB serializados, marcando truncated. Se só metadados excederem, rejeitar escrita e manter estado anterior. Não encobrir falha de histórico como falha da rede. Rodar testes e typecheck; PASS.
- [x] Registrar explicitamente: modo volátil será fallback do serviço04, não plaintext nesta tabela. Se proteção indisponível, begin falha sem podar históricos anteriores; clear explícito do usuário continua possível sem descriptografar, sujeito à geração/autorização da fachada.

## Task3 — recibos vinculados e resumo independente de prova

**Files:** criar src/main/modules/web-research/summary-receipts.ts; test/web-summary-receipts.test.ts.
**Interfaces:** `SummaryReceipts({now:()=>number,currentSession:()=>number,authorize:()=>void,contains:(h:ResearchHandle)=>boolean,setSummary:(h:ResearchHandle,text:string)=>void})`; `issue(handle:ResearchHandle,context:ExecutionContext):SummaryReceipt`, `accept(note:WebResearchNote,eventSessionId:number):boolean`, `invalidate(researchId?:string):void`, `close():void`. Getter de geração/contains revalida antes do setSummary. Método não recebe páginas/state/provas do sidecar.

- [x] RED: ticket forjado, sessão diferente/stale, nota com chaves extras, resumo4.001, expiry300.000ms e clock anterior à emissão→false sem setSummary. Ticket válido→true uma vez, segunda aceitação→false.
- [x] RED: emitir31 recibos mantém no máximo30; recibo substituído para mesma pesquisa deixa de valer; poda/clear/disconnect/revogação torna recebimento inválido; nota aceita muda só summary/summaryState, sem promover state ou alterar páginas/resultados. Rodar `node scripts/run-tests.mjs web-summary-receipts`; RED.
- [x] GREEN: gerar randomBytes(32).toString('hex'), TTL absoluto5min; registrar handle/context completo no Main. Reemitir para mesma pesquisa invalida anterior, remover expirados e consumir antes de escrever. Se a escrita falhar, não repetir por conta própria; histórico mostra resumo indisponível. Rodar todos `web-history` e `web-summary`, typecheck; PASS.
- [x] Atualizar progresso com retenção, byte budgets, migração e testes. Composição DPAPI real fica04; não anunciar fake crypto como teste de proteção do Windows real.

## Conclusão

Domínio de histórico pronto sem capacidades publicadas. Próximo04 conecta UI e resultados ao fluxo direto. Desligar módulo não limpa dados; recibos/cifragem não autorizam acesso sem licença.
