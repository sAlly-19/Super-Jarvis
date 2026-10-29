# Pesquisa web04 — integração direta, painel e aceite

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, método nativo; implementar task-by-task com TDD. Uma revisão independente final do conjunto após checks, sem agentes por tarefa.

**Goal:** Disponibilizar pesquisa/leitura/histórico no chat e Live com estado operacional verdadeiro e fontes visíveis.
**Architecture:** Composição Main dos componentes01–03 e quatro capacidades registradas. Python retira recibos das mensagens do modelo e devolve resumo pelo stdio tipado. Painel usa IPC seguro; não restaura orquestrador.
**Tech Stack:** Electron/TypeScript, Python3.11, IPC/stdio existentes, SQLite/safeStorage.
**Spec:** [desenho](../specs/2026-10-29-web-research-design.md). **Depends on:** [01](2026-10-29-web-research-01-network-search.md), [02](2026-10-29-web-research-02-reader-browser.md), [03](2026-10-29-web-research-03-history.md). **Contratos:** [00](2026-10-29-web-research-00-execution-map.md).

## Global Constraints

Todas as restrições00 e gate real aprovado de02. Preservar licença72h, Total Control, cancelamento, limites do ciclo direto e proteção de e-mails. Não expor recibo, HTML ou texto completo a eventos visuais/logs. Histórico contém conteúdo autorizado, sem confundir resumo do modelo com fonte verificada. Sem pacote/release, contas ou testes pessoais.

## Review Focus

1. Receber ticket não pode aumentar provas, executar efeitos ou escrever em pesquisa de outra rodada — Tasks1/2.
2. Interrupção Live/resultado tardio não contamina a rodada seguinte — Task2.
3. Sidecar antigo não deve anunciar web nem enviar ticket ao modelo — Tasks1/2.
4. Histórico, URLs ou resumo malicioso não executam HTML/JavaScript ou abrem protocolos locais — Task3.
5. Módulo/licença revogado, clear ou storage indisponível durante rede não vaza resultado nem apaga dados anteriores — Tasks1/4.

## Task1 — serviço, provas e composição Main

**Files:** criar src/main/modules/web-research/service.ts, application.ts e proofs.ts; modificar src/main/modules/application.ts, resources/modules/native-capabilities.json, src/shared/index.ts; testes test/web-service.test.ts, web-application.test.ts e web-task-proof.test.ts.
**Interfaces:** WebResearchService do00; `startWebResearchApplication(deps)` retorna `{service,history,notes,status():WebModuleStatus,clear(expectedGeneration:number):HistorySnapshot,testConnection():Promise<SearchOutcome>,stop():Promise<void>,restore():Promise<void>}`. deps: database, HistoryCrypto, WebTransport, WebReader, `authorizeAgent(context,id)`, `authorizeManagement()`, `moduleRevision()`, `sessionId()`, `changed()`, `sources(WebSources)`, clocks. status é somente local, não consulta internet. restore permite reativar serviço sem limpar histórico. stop invalida epoch/tickets, cancela requests/browser e libera observações.

- [ ] RED: quatro schemas recusam campos extras e limites inválidos. web_search abre handle, search/read retornam dados com IDs explícitos; read com researchId inexistente/evicto não cria pesquisa nova. Ler URL sem ID abre registro próprio. History tools não fazem rede.
- [ ] RED: researchId antigo, de outra sessão ou fechado por nota final não recebe páginas novas. Registro atual aceita associação dentro de cinco minutos; após poda/clear nenhum callback recria o registro. Pesquisa atual não atualiza silenciosamente registro recuperado de ontem.
- [ ] RED: exigir licença/módulo/revisão/sessão antes e depois dos awaits. Revogar durante DNS, fetch, render, cifragem ou nota→nenhuma entrega/persistência tardia. Fake timer prova timeout15/30s e stop sem trabalho órfão.
- [ ] RED: proteção local indisponível não bloqueia conteúdo obtido; historyStorage:volatile, nenhum INSERT/plaintext nem poda de dados cifrados anteriores. Manter contexto volátil de até10 pesquisas em memória para leituras/resumo da rodada; não promover para disco silenciosamente quando DPAPI voltar. clear invalida contextos voláteis e duráveis. Painel informa que histórico protegido está indisponível, não afirma que foi apagado.
- [ ] RED: proof aceita somente resultado exato observado no Main com contexto atual; dado forjado/resultado pós-stop→unknown. Busca empty reconhecida é consulta válida sem páginas; bloqueio/unavailable não é sucesso de pesquisa; partial continua parcial. Prova confirma obtenção, não verdade factual. Rodar `node scripts/run-tests.mjs web-service` e `web-task-proof`; RED.
- [ ] GREEN: implementar quatro capacidades, scopes de deadlines e fallback volátil limitado. Proofs em memória seguem padrão EmailProofs, sem persistir bytes brutos. Recibo só para search/read da sessão atual; `_historyReceipt` é metadata privada. Registrar limites/flags nos schemas do manifesto.
- [ ] GREEN: composição adiciona migração009 e executor web ao bridge, encaminha verify/release por capacidade sem task binding, registra lifecycle/licença/shutdown e restauração. Usar safeStorage sem plaintext. Condicionar catálogo web à negociação `webResearchRuntimeVersion===1` e bridge pronto. Estado local distingue disabled/not-ready/storage/network error; resultado de uma busca falha não declara todo runtime desligado. Rodar domínio+typecheck; PASS antes de ligar UI.

## Task2 — contrato stdio e associação chat/Live

**Files:** criar jasper-backend/web_research_notes.py, jasper-backend/tests/test_web_research_notes.py; modificar jasper-backend/runtime.py, live_session.py, direct_agent.py, protocol.py, src/shared/types/backend-protocol.ts, src/main/services/backend-framing.ts, src/main/modules/application.ts; criar src/main/modules/web-research/note-protocol.ts, test/web-note-protocol.test.ts; ampliar jasper-backend/tests/test_runtime.py, test_live_session.py, test_protocol.py e test/backend-framing.test.ts.
**Interfaces:** envelope sidecar→Main `web_research_note` do00, validado em TS/Python. Novo flag1 em hello_ack. `ResearchNotes(emit,session_id)` com `begin(turn_id:str)`, `consume(turn_id:str,result:dict)->dict`, `async finish(turn_id:str,text:str)`, `discard(turn_id:str)`, `close()`.

- [ ] RED: codec rejeita nota com campo extra, receipt inválido, sessão float/stale, summary>4.000; framing direcional reconhece tipo só sidecar→Main. Features ausentes não publicam web; outras capacidades continuam funcionando.
- [ ] RED Python: consume retira `_historyReceipt` sem alterar dados observados, guarda só recibo válido de search/read e nunca registra em histórico conversacional/tool_result. finish emite no máximo uma nota por researchId da rodada com o último recibo, sem chamada extra à IA. Recebimento de nota arbitrária do modelo não é caminho de execução.
- [ ] RED Python: duas pesquisas/rodadas sobrepostas não trocam resumos; receipt antigo após discard/close/expiração não recria bucket. Exceção de emissão não perde resposta principal nem repete ferramentas. Rodar testes notes/protocol/runtime/live; observar RED.
- [ ] GREEN: atualizar listas de tipos e validadores dos dois lados sem afrouxar os existentes. Main verifica nota com SummaryReceipts e nunca a encaminha em wireBackendForwarding. Registrar no Python hello_ack feature1; Main guarda feature da sessão e a invalida no reconnect.
- [ ] GREEN: chat usa req_id como turn_id, begin antes das ferramentas, consume antes da serialização para modelo, finish na resposta final e discard em finally/cancel/error. Mesmo com event_sink ausente, remover metadata privada e não persistir ticket no modelo/histórico.
- [ ] GREEN: instruções compartilhadas em direct_agent.py orientam web_search/web_read para pesquisa atual, datas/URLs e recuperação por history tools quando solicitada; snippets não lidos não são citados como artigo consultado. Módulo desativado/bloqueado não autoriza PowerShell como fallback. Nenhuma contrapergunta para parâmetros opcionais que já possuem padrão.
- [ ] GREEN: LiveCall recebe parâmetro opcional `research_notes=None`, preservando callbacks existentes de duas entradas. Gera turn_id local; captura-o ao agendar `_tool(call,turn_id)`, consume antes de send_tool_response; no turn_complete, finish com a transcrição de saída não vazia, depois descarta/rotaciona. Interrupted/tool-cancellation/stop descartam o contexto correspondente; resultado de tool antigo não reabre bucket e não entra na rodada nova. Sem transcrição, resumo fica pending/unavailable; não gerar texto por outro modelo. Envolver tarefas/cleanup nos testes reais de LiveCall com SDK falso.
- [ ] Rodar `npm.cmd run test:python`, testes note/framing e typecheck; PASS. Inspecionar que dados brutos e Parts assinados Gemini continuam só no contexto volátil autorizado; assinatura de function calls da entrega anterior deve permanecer intacta.

## Task3 — painel, fontes e IPC

**Files:** criar src/main/ipc/web-research-ipc.ts, src/renderer/ui/web-research-settings.ts e web-research-sources.ts; modificar register-ipc.ts, src/shared/constants/ipc-channels.ts, src/shared/types/agent-api.ts, src/preload/index.ts e index.d.ts, src/renderer/index.html, src/renderer/ui/settings-modal.ts, module-settings.ts, src/renderer/main.ts e estilos existentes; testes test/web-ipc.test.ts, web-settings.test.ts e web-ui.browser.ts.
**Interfaces:** IPC/API/WebSources do00. `initializeWebResearchSettings():void`, `initializeWebResearchSources():void`; chamadas pelo preload tipado. registerWebResearchIpc segue guard e senderFrame Main de email-ipc; não ampliar LOCKED_ALLOWED_CHANNELS. Alterações notify sem conteúdo completo.

- [ ] RED: sender de iframe, janela de pesquisa remota ou sessão não autorizada é rejeitado; list/get/clear locais com módulo desligado não fazem rede e continuam exigindo licença/consentimento. clear exige geração atual. test só funciona com módulo ligado, por clique explícito e sem salvar pesquisa no histórico.
- [ ] RED browser: lista10, detalhe em texto, resumo pending, storage indisponível, clear e resultado atrasado; nova entrada11 remove a mais antiga da apresentação. Desligar não limpa dados. HTML/script/markdown malicioso é texto, não innerHTML. Links javascript/file/data/credenciais ou fora das fontes do registro são recusados.
- [ ] GREEN: painel sem campo de chave/cadastro, badge de modo HTTP+navegador, histórico e diagnóstico local. Históricos cifrados indisponíveis não aparecem como “nenhuma pesquisa realizada”; informar estado. Ação testar rede usa query fixa pública do00 sem histórico. Clique abrir fonte passa por IPC Main e shell.openExternal após validar pertinência e URL, nunca abre automaticamente ao pesquisar.
- [ ] GREEN: fontes consultadas aparecem em área própria do chat com título/query/horário, links clicáveis obtidos do Main; não depender de a IA copiar URL correta. Voz pode sintetizar resposta breve, fontes continuam visíveis. Ao limpar/revogar, remover metadados da interface e ignorar callbacks antigos por geração. Eventos sources não levam texto/payload cifrado/recibo.
- [ ] Rodar testes IPC/UI e harness Electron em perfil temporário, janela oculta e transporte fictício; typecheck/build dev PASS. Confirmar chamada aberta exige reinício para habilitar ferramentas novas, conforme regra anterior; sem introduzir confirmação por consulta.

## Task4 — aceite integrado e revisão

**Files:** criar test/web-stdio.test.ts, test/fixtures/web/acceptance-host.ts e deterministic-sidecar.py, scripts/test-web-ui.cjs, docs/web-research-setup.md; atualizar README.md, progresso web e roteiro08 para indicar execução direta/decisões vigentes.
**Interfaces:** composição/transportes reais e contratos00; fake DNS/páginas/modelo com dados sintéticos. Harness Python3.11 e Main reais sem autenticação de usuário; não reutilizar licença/perfil pessoal.

- [ ] RED: stdio com task_runtime negociado executa web_search→web_read→resposta e nota sem Planner/task_event; proofs Main validam somente leituras realizadas, recibo não aparece em prompts/eventos visuais. Modelo retorna fonte antiga/contraditória de fixture; instruções e datas mantêm distinção entre consulta atual e histórico.
- [ ] RED: recuperar histórico sem rede, incluir11ª, clear durante busca, storage indisponível, CAPTCHA, módulo/licença revogados durante browser e cancelamento Live. Confirmar arquivos/cookies/perfis temporários removidos e zero envio de e-mail, worker de shell ou novo serviço. Rodar `node scripts/run-tests.mjs web-stdio`; observar RED antes dos ajustes de integração.
- [ ] GREEN: completar somente lacunas do fluxo; não afrouxar política para passar fixtures. Executar `node scripts/run-tests.mjs web-`, `node scripts/test-web-browser.cjs`, `node scripts/test-web-ui.cjs`, `npm.cmd run test:python`, `npm.cmd run verify`, `npm.cmd run audit:runtime`, `node scripts/scan-secrets.mjs --include-untracked`, `git diff --check`. Esperado: exit0 e limites documentados; falhas novas precisam ser resolvidas antes de declarar entrega local.
- [ ] Uma revisão independente do conjunto; corrigir Critical/Important com RED→GREEN e repetir checks afetados. Registrar Minors/limitações em progresso, sem anunciar segunda revisão que não ocorreu. Node26 local não comprova engine24; CI/Node24 permanece gate se não disponível. Sem instalador ou novo pacote.
- [ ] Aceite público separado, somente após testes locais e escopo autorizado: uma consulta pública sem dados pessoais e leitura de documentação; registrar hora/URLs/resultado real sem promessa de disponibilidade. CAPTCHA/layout bloqueado permanece pendência de integração real, não sucesso simulado. Não testar serviços de login, compras ou dados privados.
- [ ] Fechar progresso com fontes, dependências/licenças, evidências e pendências. Solicitar direção antes de outro módulo; Documentos e Outlook continuam adiados. Manter main e alterações sem commit/push.
