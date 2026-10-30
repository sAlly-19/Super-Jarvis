# Memória04 — Main, captura, chat/Live, painel e aceite

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, nativo/main. Uma revisão independente final; sem implementar habilidades automáticas nesta entrega.

**Goal:** Publicar memória permanente/semântica com preparação sob demanda e contexto relevante no agente, preservando dados existentes.

**Architecture:** Composição única Main01–03, capability memory_recall, protocolo versionado e captura vinculada à entrada real do usuário. Adaptador substitui o MemoryStore legado antes de qualquer rotina com TTL; painel permite preparar, consultar, corrigir e excluir.

**Tech Stack:** Electron/TypeScript, ModuleBridge, SQLite/safeStorage, Python3.11 e IPC/stdio atuais; sem serviço externo.

**Spec:** [desenho aprovado](../specs/2026-10-30-semantic-memory-design-draft.md), [contratos00](2026-10-30-semantic-memory-00-execution-map.md); Depends01–03 e gate real02/qualidade03 aprovados.

## Global Constraints

Restrições00. Somente entrega local, sem release/commit/push. Perfis reais não são fixtures. Módulo semântico desligado preserva fonte e não baixa modelo. Não enviar a memória permanente inteira em todo prompt. Fonte01 disponível para gestão com módulo desligado, mas licença/consentimento continuam necessários.

## Review Focus

1. Snapshot legado/primeiro acesso pode aplicar TTL antes da migração —T1.
2. Captura/transcrição antiga após clear/editar pode recriar fato —T2.
3. Memória já enviada ao modelo/Live não pode ser prometida como revogada remotamente —T2/T3.
4. Preparar/reconstruir pelo painel não pode vazar fatos/caminhos/vetores ou aceitar iframe —T3.
5. Modelo faltante, sidecar antigo ou worker lento não devem fingir semantic-ready —T1/T4.

## Task1 — composição, catálogo e fonte única

**Files:** criar `src/main/memory/semantic/application.ts`, `proofs.ts`; modificar `src/main/memory.ts`, `src/main/modules/application.ts`, `runtime-bridge.ts`, `resources/modules/native-capabilities.json`, `electron.vite.config.ts`; testes `test/semantic-application.test.ts`, `semantic-task-proof.test.ts`; atualizar expectativas intencionalmente antigas de `test/memory-sync.test.ts`.

**Interfaces:** `startSemanticMemoryApplication({database,source,model,client,index,authorizeAgent,authorizeManagement,moduleRevision,sessionId,changed,progress})` retorna `{service,state,prepare,cancelPreparation,rebuild,listFacts,mutate,stop,restore}`. service.execute('memory_recall',args,context,signal) retorna MemoryRecall, verify/releaseObservation seguem padrão de host proofs exatos. `getPermanentMemorySource()` é getter lazy do mesmo source usado no adaptador legado, gestão e índice; não instancia escritores por consumidor.

- [ ] RED: instanciar aplicativo/importar memória não apaga fato de2020 nem faz download; primeiro acesso autorizado migra v1 antes de qualquer filtroTTL, preserva dados e instala fonte única. Falha de migração é unavailable, sem freshDefault. MemoryStoreOptions de testes aceita proteção/HWID/clock injetados sem usar perfil real.
- [ ] RED: quatro condições bloqueiam recall/catálogo: licença, consentimento, módulo desativado, sessão/revisão antiga. Backend sem semanticMemoryRuntimeVersion1 não recebe memory_recall; demais capacidades continuam. Verify só aceita resultado observado exato sob token/autoridade atuais; score não vira prova factual.
- [ ] RED: ativar prepara modelo uma vez; reativar usa cache íntegro; abrir/desligar não baixa. Revogar/stop invalida jobs/observações e cancela preparação; restaurar não apaga fonte. Modelo ausente/corrompido/reindex pendente torna modo degradado explícito, não dados vazios com sucesso.
- [ ] RED: recall3s pode terminar/cancelar sem matar a preparação10min já autorizada pela ativação. Restauração automática/diagnóstico/status ready não inicia download; somente mudança explícita off→on, botão preparar ou primeiro recall com módulo já ativo e recurso ausente. Falha não gera retries em toda frase subsequente; erro/cancelado exige ação explícita para nova tentativa.
- [ ] Rodar `node scripts/run-tests.mjs semantic-application` e `semantic-task-proof`; RED.
- [ ] Implementar composição e migração010 no StateDatabase global depois de009. Adaptador source01 substitui implementação com TTL em memory.ts; preservar funções públicas. Não manter fonte legada escrevendo em paralelo nem resetar HWID na leitura. Atualizar testes que exigiam plaintext/expiração/reset para testar proteção/permanência/falha fechada, mantendo provas novas de preservação.
- [ ] Registrar executor semantic-memory, permissions memory.read, limite5s e gating de feature. Ligar lifecycle/disconnect/licença/shutdown; source não é apagada por stop. Notificação de fonte apenas invalida índice/recall e agenda reconstrução cancelável sob autoridade; não dispara download se módulo estiver off.
- [ ] Separar escopo da preparação do escopo de recall: application mantém controller/epoch de vida do módulo para download10min, enquanto cada consulta tem deadline3s. Ativação explícita cria operação sem aguardar10min para responder ao toggle; UI acompanha progresso. restore não baixa nada. Primeiro recall pode iniciar essa mesma operação independente e retornar text_only enquanto prepara. Cancelar/desligar/revogar interrompe a operação compartilhada; cancelar só a consulta não desfaz a ativação do usuário.
- [ ] Estado do motor e saúde da fachada são separados: serviço ativo pode oferecer text_only enquanto modelo prepara. Callbacks de autorização chamados dentro de transações SQLite usam estado operacional em memória, sem abrir nova transação de diagnóstico/índice. Módulo off não injeta automaticamente contexto novo no backend moderno; preservar fonte no painel não equivale a habilitar recuperação com switch desligado.
- [ ] GREEN: domínio semantic-, memory-sync e typecheck. Composição pronta não prova que o perfil pessoal foi migrado/testado.

## Task2 — protocolo, origem de captura e recuperação em chat/Live

**Files:** criar `src/main/memory/semantic/capture-origin.ts`, `memory-protocol.ts`, `jasper-backend/semantic_memory.py`; modificar shared/types/backend-protocol.ts, backend-framing.ts, services/python-backend.ts, ipc/register-ipc.ts, jasper-backend/protocol.py, runtime.py, live_session.py, direct_agent.py. Testes `test/semantic-capture-origin.test.ts`, `semantic-memory-protocol.test.ts`, backend-framing e Python `test_semantic_memory.py`, runtime/live/protocol.

**Interfaces:** tipos00 e complemento desta tarefa. `MemoryOrigins({now,sourceToken,currentSession}).register({requestId,sessionId,token,text?:string,kind:'chat'|'audio'|'live'}):void`; `bindTranscript(requestId,text,sessionId,token):void`; `accept(payload,eventSession):Array<{fact:string}>`; `close(requestId):void`, `invalidate():void`. Máximo30 origens,TTL5min; nunca logar/persistir texto bruto desse cache.

Contrato novo: hello_ack acrescenta semanticMemoryRuntimeVersion1. host→sidecar memory_state/memory_invalidated têm payload MemoryToken exato. chat/audio_input recebem campo opcional memoryToken inserido somente pelo Main; user IPC não fornece esse campo. memory_upsert novo contém exatamente `{requestId,token:MemoryToken,facts:[{fact:string}]}`, máximo1 fato20.000caracteres por entrada de usuário. Captura conserva a geração **e revisão** da origem; ambos devem continuar atuais. IDs/datas vêm do Main.

`pythonBackend.notify(type,payload):string|undefined` passa a retornar o envelope ID ao escrever; consumidores antigos podem ignorar retorno. Main registra origem imediatamente após envio, antes de processar próxima mensagem. Em erro de envio, não registrar. Para áudio, replyTo do user_transcript associa STT à origem host existente; para Live, evento final tem `{text,turnId,memoryToken,final:true}`, gerado pelo runtime do SDK e aceito somente em chamada/sessão Main ativa. Tool output/model output não cria origem.

- [ ] RED: protocolo moderno rejeita token float/negativo, extras, requestId desconhecido, sessão antiga, fato diferente do texto original do usuário e timestamp/ID do modelo. Decoder pode reconhecer formato legado estrito de memory_upsert para diagnóstico/compatibilidade, mas handler da fontev2 não o aceita como write moderno sem origem/token. memory_clear arbitrário emitido pelo sidecar não apaga a fonte; limpeza é ação Main autorizada. Preservar demais tipos e direções estritas.
- [ ] RED: registrar chat/áudio e emitir fato depois de clear/editar/perfil/reconnect é rejeitado mesmo se evento já estava na fila. Token completo evita recriar texto antigo depois de uma correção que não muda generation. Live parcial não persiste; final de rodada antiga/interrompida não reabre origem. Nenhum dado de página/e-mail vira fato apenas por resposta da ferramenta.
- [ ] RED Python: chat faz no máximo1 recall automático do texto do usuário antes de montar prompt se feature/capability estiverem presentes; resultado incorpora até6.144bytes de contexto, origem/revisão, como dado não confiável. Sem ferramenta/modelo pronto, funciona com fallback identificado; nenhuma chamada nova de IA só para extrair/armazenar fato. Prompt não injeta self.facts inteiro indefinidamente.
- [ ] RED Python: Live consulta por memory_recall sob o catálogo quando contexto pessoal é necessário, sem pesquisar a cada fragmento/forçar restart da chamada. Invalidar memória limpa caches locais e impede tool result antigo de ser enviado à rodada nova, preservando proteção de e-mail/recibos web/Parts assinados Gemini. Backend antigo sem feature usa somente snapshot legado limitado, não o perfil inteiro.
- [ ] Rodar testes capture-origin/protocol e Python semantic_memory/runtime/live; observar RED antes de ligar handlers novos.
- [ ] Implementar validação/coleta de origem no Main. accept exige texto de fato igual à entrada/transcrição final registrada (normalização trim/NFC) e os gatilhos explícitos de memorização atuais; não aceitar paráfrase inventada pelo modelo. Consumir origem uma vez, revalidar token e autoridade antes de source.mutate. Não tentar salvar automaticamente de novo após edição/clear que invalidou a origem.
- [ ] Áudio: origem host nasce sem texto; bindTranscript usa replyTo do pedido existente, token capturado no envio e STT final autorizado. Live: bindTranscript cria origem `live:<turnId>` apenas ao receber transcrição final em chamada Main ativa, com token completo ainda atual; parcial não cria origem gravável. Cada LiveCall captura o token no início da rodada e não o troca no meio da rodada ao receber invalidação. Resultado sem origem final não persiste.
- [ ] Implementar helper Python `SemanticMemoryContext(bridge)` com `async recall_user_text(text):MemoryRecall|None`, `invalidate(token):void` e captura do token na entrada/rodada, não no instante tardio de emitir. Fechar origens em turn_complete/interrupted/desconexão. Em Live memorizar somente input_text final correspondente à rodada, nunca output_text.
- [ ] Fonte alterada envia memory_invalidated e memória de sistema limitada do perfil quando necessária; snapshots vazios limpam self.facts, corrigindo a condição legada que só limpava quando incoming_facts não era vazio. Snapshot legado limitado: até20 fatos e6.144bytes, sem índice/vetores; não permitir writes legados sem origem no caminho moderno. Versão antiga é compatível com gestão no painel, não com novas funções de captura/recall.
- [ ] Remover o push ilimitado memory_snapshot no status ready do Main para backend moderno. Chat usa recall automático; Live usa a ferramenta e, no início, apenas perfil limitado autorizado. Conteúdo já enviado ao provedor não pode ser apagado retroativamente: invalidar contexto local e informar no painel que reiniciar chamada/conversa descarta o contexto remoto anterior. Não reiniciar chamada atual automaticamente.
- [ ] GREEN: testes TS/protocolo, `npm run test:python` e typecheck. Não chamar modelo externo nem usar microfone pessoal no teste.

## Task3 — painel de memória e recursos

**Files:** criar `src/main/ipc/semantic-memory-ipc.ts`, `src/renderer/ui/semantic-memory-settings.ts`; modificar register-ipc.ts, shared/constants/ipc-channels.ts, shared/types/agent-api.ts, preload/index.ts/index.d.ts, renderer/index.html/ui/settings-modal.ts/ui/module-settings.ts/styles; testes `test/semantic-ipc.test.ts`, `semantic-settings.test.ts`, `scripts/test-semantic-ui.cjs`, `test/fixtures/semantic-memory/acceptance-ui.ts`.

**Interfaces:** API00. Adicionar paginação `listFacts({cursor?:string,limit?:number}):Promise<{token:MemoryToken;items:MemoryItem[];nextCursor:string|null}>`, default50/max100. Cursor codifica token+offset, é limitado a160caracteres e não concede autoridade; token antigo é memory_changed. API mutate retorna novo snapshot, nunca texto/erro privado de crypto. state não faz rede.

- [ ] RED: iframe/janela diferente/frame antigo/licença negada não consulta nem prepara; módulo off permite gestão autorizada da fonte, não preparar/rebuild/recall. Payloads estritos, geração e revisão exigidas para edição/exclusão. Não ampliar LOCKED_ALLOWED_CHANNELS.
- [ ] RED Electron: ativação/progresso/cancelamento/erro/retry explícito/cache pronto; abrir painel off tem0rede; nome/preferências/fatos antigos são visíveis, editáveis e removíveis. Permanência é informada; storage unavailable não mostra “nenhuma memória”. Texto HTML/Markdown não executa. Editar/excluir/clear elimina detalhe selecionado e ignora callbacks antigos.
- [ ] Rodar testes IPC e harness UI primeiro; RED. Depois implementar seções no tab-memory existente e estado do módulo em Sistema & Automação. Remover renderização ilimitada `renderMemoryFacts(memory.facts)` em favor de paginação; manter getMemory legado para compatibilidade autorizada, sem usá-lo no novo painel para buscar32MiB toda vez.
- [ ] Gestão usa apenas texto/inputs e eventos changed/progress sem conteúdo; editar fato exige seleção/ID atual, excluir manual não aprende habilidade. Não introduzir confirmações novas por consulta/ação de IA; preservar o comportamento explícito de limpeza manual do painel sem reutilizá-lo como gate por operação.
- [ ] GREEN: Electron oculto/perfil temporário/rede bloqueada, screenshot e inspeção visual. typecheck/build dev. Model download real não ocorre por abrir a fixture.

## Task4 — aceite integrado, qualidade e handoff

**Files:** criar `test/semantic-stdio.test.ts`, `test/fixtures/semantic-memory/acceptance-host.ts`, `deterministic-sidecar.py`, `docs/semantic-memory-setup.md`; atualizar README, roadmap11 e registro de aprendizagem/progresso. Criar `2026-10-30-semantic-memory-progress.md` com status por plano e evidências portáteis.

- [ ] RED/aceite: stdio real com Main/bridge/runtime e modelo de conversa falso; lembrar preferência e recuperar por paráfrase, editar/remover e impedir resposta tardia. Perfil com fato antigo é migrado sem TTL antes do primeiro status/snapshot. Sem Planner/task_event/serviço externo/ações de e-mail ou shell.
- [ ] Cobrir origem falsa, clear durante STT/Live/embedding, preparação cancelada, proteção indisponível, índice corrompido, biblioteca indisponível e backend sem feature. Reutilizar fixtures por contrato, não retornar respostas fixas no código de produção para passar exemplos.
- [ ] Rodar `node scripts/run-tests.mjs semantic-`, gate worker/relevância real, `node scripts/test-semantic-ui.cjs`, `npm run test:python`, `npm run verify`, `npm run audit:runtime`, `node scripts/scan-secrets.mjs --include-untracked`, `git diff --check`. Registrar códigos de saída, contagens e limites. Atualizar testes só quando regra aprovada substituiu comportamento antigo, não para ocultar regressão.
- [ ] Modelo real: provar preparo com hashes e consulta totalmente offline, medir qualidade positiva/negativa PT-BR com fixture congelada e recursos da máquina. Não usar memórias reais como corpus nem anunciar mock como qualidade. Node24/CI se disponível; Node26 local não comprova engine24. Sem instalador para esse teste.
- [ ] Uma revisão independente final; corrigir Critical/Important com RED→GREEN e repetir checks afetados, registrar Minors/limitações. Não alegar segunda revisão inexistente nem segurança absoluta.
- [ ] Guia do cliente: download aproximado versus tamanho real do runtime/RAM, estados de preparação, permanência/exclusão lógica, migração/backup, modo textual degradado, limites de contexto e contexto já enviado ao provedor. Aceite manual de perfil licenciado é separado dos perfis de teste; pedir ao usuário testar após entrega local.
- [ ] Fechar evidências/pendências e manter main sem commit/push. **Próximo desenho é Habilidades aprendidas**, com política de promoção por sucesso, parâmetros, versões e exclusão. Não implementá-lo implicitamente dentro desta fase.
