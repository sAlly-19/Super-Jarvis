# Lembretes — progresso e retomada

Atualizado em27/10/2026. Branch main. **Etapas01–04 implementadas; validações locais da05 aprovadas com pacote reconstruído. Aceite operacional do executável comercial com licença ativa permanece pendente. Módulo desativado por padrão, habilitável no painel.**

## Retomada após o teste de fechamento real

Usuário informou que ainda não ativou o pacote. Foi concluída a verificação adicional `scripts/test-packaged-restart.ps1`: dois startups normais do executável comercial, no mesmo perfil temporário e PATH sanitizado, seguidos de WM_CLOSE dirigido exclusivamente à janela Chrome do PID criado pelo teste. Ambos encerraram com código0; avatar carregado nos dois ciclos; SQLite preservado com139264 bytes e o mesmo SHA-256. Não usou flag de captura/autoquit, credencial, licença ou perfil pessoal. WM_CLOSE testa o fechamento normal da janela, não o clique no botão X via IPC.

Primeira tentativa do harness não identificou janela oculta por Process.MainWindowHandle; log comprovou que o app/avatar carregaram. Ajustado apenas o teste para enumerar HWNDs do próprio PID pela classe Chrome_WidgetWin_1. Nenhum código de produto mudou e nenhum rebuild adicional foi necessário. Evidências: `.superpowers/sdd/2026-10-27-reminders-05-acceptance/packaged-restart.log` e `packaged-restart.json`; `reminderCrudVerified:false` permanece explícito. Scanner342 arquivos sem achados; diff --check aprovado.

**Ação necessária para o próximo aceite:** abrir `release/win-unpacked/Jasper AI.exe`, ativar a licença pelo modal e validar manualmente Lembretes com dados sintéticos: habilitar o módulo, criar aviso para daqui a1minuto, minimizar, conferir o aviso e concluir/adiar a ocorrência. Testar depois fechamento pelo botão X/reabertura e .ics. Não marcar o fluxo licenciado como aprovado enquanto isso não ocorrer; não iniciar módulo novo automaticamente. Testes locais já aprovados não precisam ser repetidos sem alteração ou falha nova.

## Etapa05 — evidência local e pacote final

Executados: verify final265/265 testes TS, typecheck e build; Python84/84; rebuild completo do sidecar/manifesto e package:dir; test:package10/10, verify:package e smoke:packaged. Após correção visual abaixo, novo verify265/265 e package:dir:from-build usando o mesmo sidecar recém-reconstruído (Python de produção não mudou); repetidos10/10 artefatos, integridade e smoke no pacote final. Todos exits0. Sem API de IA/voz, calendário pessoal, commit/push ou alteração de política de licença.

Stdio com runtime Python e executor/store/broker reais comprova create→get com ID vinculado, list→update por revisão→get e importação Main manual seguida de list no orquestrador. As respostas/provas contêm dados observados, com provedor determinístico de teste; zero capability_execute de reminders no worker Python. Task events/evidence não armazenam títulos. Isso não é aceite por modelo real.

ASAR final contém worker, chunk do codec, ical.js, licença de distribuição e migrações005/006. Teste inicial de extração usava '/' com API ASAR do Windows e falhou por separador de caminho; não usar essa falha como prova de worker ausente no pacote anterior. Corrigidos teste/verificador para caminhos nativos e confirmada presença no pacote reconstruído.

`node scripts/test-reminders-ui.cjs` passou usando perfil/banco temporários, PATH sanitizado, rede bloqueada, seletores de arquivo controlados e dados sintéticos. Usa HTML/CSS/migrações e worker reais do ASAR, com host/serviços/UI/IPC do harness compilados da fonte. Comprovou criação, preview/apply de2 itens, exportação/round-trip de3, resumo de4 ocorrências, ack após apresentação, upgrade v4→v6/backups e dados/histórico preservados após fechar/reabrir SQLite. Zero toasts reais. Screenshot somente dessa janela, em `.superpowers/sdd/2026-10-27-reminders-05-acceptance/reminders-ui.png`; relatório `reminders-acceptance.json` identifica expressamente que o runtime comercial não foi desbloqueado.

Inspeção visual encontrou defeito real: resumo z-index1300 ficava atrás do modal2000, embora já recebesse ack. Reproduzido RED com hit testing no CSS empacotado. Corrigido para2100 e ack exige que elementFromPoint pertença ao resumo. Rebuild e todos os checks afetados repetidos GREEN; captura final inspecionada com resumo visível. Falhas do harness (nome de backup com UUID, RAF em janela oculta e pintura defasada) foram corrigidas nos testes, usando offscreen/espera de ack e dois frames, sem alterar gates do produto.

Revisão independente final não confirmou Critical/Important de produção ou bypass comercial. Apontou Important de evidência: harness não prova Main/preload/IPC/renderer do executável comercial com licença ativa nem o X/restart dele; essa lacuna permanece aberta. Apontou cobertura composta faltante; stdio ampliado e aprovado depois da revisão. A correção visual e os refinamentos dos testes ocorreram depois dessa leitura; não alegar segunda revisão independente. Scanner final341 arquivos rastreados e novos não ignorados sem achados; diff --check aprovado.

**Não anunciar aceite comercial completo:** o smoke do executável real comprova startup bloqueado por licença, avatar e ausência de sidecar antes da ativação; o harness comprova serviços/recursos, não execução comercial licenciada. Não foi introduzida flag/chave para contornar esse limite. IA real continua adiada; leitura efetiva de toast não é comprovada; crash antes do ack admite reapresentação. Executável local consultado com Authenticode: NotSigned; assinatura de produção e VM Windows limpa permanecem gates de release separados. Node26 local continua fora do engine24 e o aviso de bundle>500kB persiste.

**Handoff atual:** pacote local de teste em `release/win-unpacked/Jasper AI.exe`. Próximo passo é validar no executável com licença ativa: habilitar Lembretes, criar aviso de curto prazo, minimizar, concluir/adiar a ocorrência, importar/exportar .ics e fechar pelo X/reabrir. Usar dados sintéticos e manter o registro dos resultados. Não refazer builds/testes já aprovados se código não mudar. Não iniciar outro módulo automaticamente; Saúde do PC é apenas candidato do roadmap após encerrar esse aceite.

## Etapa04 — tela e calendário manual implementados

Painel Sistema & Automação permite habilitar Lembretes, criar/editar, concluir ou adiar uma ocorrência, excluir, paginar e alterar preferências. Agenda usa Main/SQLite e funciona sem conexão com modelo; CRUD reutiliza RemindersService/política existente. Dados externos são montados como textContent. Resumo dos atrasados tem ações para a ocorrência exibida, sem atingir a próxima da série; ack confirma apresentação, não leitura/conclusão. Paginação por batchId continua disponível após esse ack. Frame principal atual e total observado correlacionam a confirmação.

Importação .ics: seleção manual Main, leitura limitada2MiB, até1.000 componentes, processamento em worker com prazo15s e cancelamento. Prévia fica sob token Main ligado à sessão da janela; apply usa candidatos já selecionados, sem reabrir caminho recebido do renderer. Arquivo idêntico conserva IDs e fica unchanged mesmo após mudar preferências. SEQUENCE antigo e edição local geram conflitos; UID duplicado conflitante é rejeitado. Lotes100 são atômicos e receipts na nova migração006 preservam contagens/IDs de lotes já gravados após interrupção. Migração005 não foi reescrita.

Codec usa ical.js2.2.1 já autorizado/instalado, sem nova dependência. Eventos DTSTART, tarefas DUE, dia inteiro09h configurável, zonas IANA/UTC, DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT/UNTIL e EXDATE do subset suportado. Hash canônico ignora DTSTAMP volátil e preferências derivadas. Biblioteca ignora BYSETPOS com BYMONTHDAY isolado; seletor das três regras clamp geradas foi corrigido com testes fevereiro/março/bissexto, sem alterar regra RFC para clamp nativo. UNTIL DATE também corrigido.

Exportação gera bytes completos em worker antes do diálogo de destino e escrita por temporário/rename, conferindo versão do lembrete e alteração concorrente do destino. Mantém UID e tipo importado, usa VTODO para itens Jasper. Limites explícitos: VTIMEZONE embutido sem equivalência certificada é rejeitado na importação; recorrência nativa em fuso não UTC e conclusão/snooze/exceções sem equivalência rejeitam exportação antes de gravar. Não há CalDAV, URL de calendário ou execução de anexos/alarmes.

Expansão longa usa cursores computacionais com fatias16ms no Main, yield e reconferência de acesso/signal entre tentativas, mantendo teto50k. Worker também valida expansão inicial; orçamento excedido não vira término falso de série. Avanço de ocorrência já entregue pode ser retomado por checkpoint persistido, sem outro aviso. Disable, revogação, navegação/destruição da janela e teardown abortam jobs e aguardam worker terminar.

Evidências: verify final passou typecheck,264/264 testes TS e build; suíte reminders34/34. Chromium oculto com perfil temporário validou texto HTML literal, formulário com fuso/data, preview/apply/import, export por revisão, revogação e ação sobre ocorrência atrasada. Worker real validou parse, timeout e abort. Após ampliar asserts de round-trip/bissexto/DOM, testes direcionados e typecheck passaram; build final repetido GREEN com worker e chunk compartilhado. Python não mudou nesta etapa, não foi repetido. Aviso bundle>500kB e Node26 fora do engine24 continuam registrados.

Revisão independente encontrou4 Important (relatório parcial, expansão Main, UNTIL DATE e ack de versão); corrigidos e cobertos. Não alegar segunda revisão após correções/refinamentos. Sem API real, notificação do perfil real, commit/push ou novo pacote comercial. Fixture manual em `test/fixtures/reminders/sample-calendar.ics`. Logs locais: `.superpowers/sdd/2026-10-27-reminders-04-ui-ical/`.

**Retomada atual: plano05 — aceite integrado, notificação em perfil isolado, rebuild do sidecar/pacote e verificação do worker/licença/migrações no artefato.** Não refazer01–04. Aprovação, execução nativa e main preservadas. Aceite com provedor real continua adiado por instrução do usuário.

## Etapa03 — scheduler e recuperação validados

Claims persistidos em SQLite impedem duas conexões de avisar a mesma ocorrência. Cada lote de entrega tem token próprio, callbacks conferem autorização, preferência, geração e agenda antes do efeito; stop invalida callbacks e libera entregas como incertas. Editar título não repete aviso; snooze explícito permite o próximo aviso da mesma ocorrência. Notificador Electron silencioso aguarda evento show e usa timeout30s; show não significa leitura.

Recuperação processa até100 ocorrências por transação, cede execução entre checkpoints e preserva o avanço da série junto do estado missed. Não dispara toasts antigos. Resumo persistente reapresenta o mesmo batch após reabertura sem ack, preservando estado funcional dos lembretes. Apresentador fake comprova correlação com sessão de janela; total do lote é conferido atomicamente no ack e mudanças reapresentam o resumo. Sem presenter real nesta etapa, batches ficam pendentes para04.

Claims têm lease60s para não tomar entrega viva de outra conexão. Expiração vira resultado incerto e recuperação, sem repetir individualmente a ocorrência; um processo interrompido pode deixar até60s de espera antes dessa recuperação. Notificações bloqueadas alimentam o resumo na sessão corrente. A aplicação instala supervisor e powerMonitor suspend/resume apenas enquanto o processo existe; fechamento remove timers/listeners antes do SQLite. Gate independe da conexão com modelo. Sem bandeja, serviço, autostart ou mudança no X.

Evidências: RED de APIs ausentes e snooze após aviso; testes finais reminders22/22. Verify final passou typecheck,252/252 testes TS e build. Após acrescentar asserts de lease, título e callback após revogação, reminders22/22 passou novamente; código de produção não mudou depois do verify final. Aviso de bundle>500kB persiste. Python não mudou nesta etapa, portanto não foi repetido. Node26 local permanece fora do engine24 declarado.

Revisão independente encontrou3 Important (batch acrescido/ack, claim vivo e resumo de bloqueios); corrigidos com regressões. Segunda revisão estática não confirmou Critical/Important; corrigido também guard defensivo de catch após close. Essa revisão não executou testes e precedeu os últimos refinamentos de token individual/callback. Sem API, notificação real, commit/push ou novo pacote comercial. A apresentação Electron real e o rebuild do sidecar/pacote continuam como gates05.

**Próxima retomada: plano04 — tela, IPC/preload e importação/exportação manual .ics.** Não refazer01–03; aprovação e execução nativa/main já recebidas. Logs locais em `.superpowers/sdd/2026-10-27-reminders-03-scheduler/`.

## Retomada

Ler o [mapa executivo00](2026-10-27-reminders-00-execution-map.md), depois os planos01–05 vinculados nele e o [desenho aprovado](../specs/2026-10-27-reminders-design-draft.md). Após aprovar o desenho, o usuário também confirmou os planos e o início da etapa01. Aprovação e método nativo/main persistem; não solicitar novamente a revisão já recebida. Método nativo/main já escolhido. Sem commit/push automático.

- [x] Registrar decisões: SQLiteMain, .ics manual com ical.js, app aberto/X preservado, resumo de vencidos, mensal clamp, fuso original, lacuna para primeiro horário válido, repetição única, preferências só para novos itens e reimportação preservando edições locais.
- [x] Inspecionar store/policy/bridge/task service, IPC/preload real e build. Dividir entregas e mapear arquivos/interfaces/casos RED→GREEN.
- [x] Revisar contratos entre planos: distinguir NativeSchedule/ImportedSchedule; instalar ical.js na01 pois Calendar usa RRULE; sem transações aninhadas no lote; tabelas deliveries/membros de batch previstas na005; tipos ElectronAPI reais em preload/index.d.ts.
- [x] Identificar fronteira adicional: Python ModuleBridge.snapshot também cancela todos os workers. Plano02 cobre reconciliação diferencial para não encerrar computer ao mudar reminders; não basta corrigir só Main.
- [x] Receber revisão/aprovação dos planos e limites técnicos destacados no mapa00.
- [x] Executar01: store/calendário/migração/dependência, com TDD e revisão final.
- [x] Executar02: roteamento multi-module, ferramentas Main, provas e integração Python.
- [x] Executar03: scheduler, notificador, recuperação e testes sintéticos de apresentação.
- [x] Executar04: tela, IPC/preload, codec/worker e importação/exportação manual.
- [x] Executar validações locais05: stdio/host/UI isolados, recursos ASAR, rebuild e smoke comercial bloqueado.
- [ ] Fechar aceite operacional05 no executável comercial com licença ativa, incluindo X/restart real. Assinatura/VM limpa são gates de release separados.

## Evidência da rodada documental anterior

Skill writing-plans aplicada. Auto-revisão conferiu cobertura do desenho, consistência de nomes e cinco riscos com testes atribuídos. Sem subagente para essa auto-revisão. Validação restrita a links locais, limites de arquivos futuros e whitespace; nenhum teste de produto/build/instalação/API executado ou alegado como aprovado nesta rodada.

Fonte oficial consultada: package.json do repositório ical.js mostra2.2.1 e APIs Time/RecurExpansion documentadas. Consulta de publicação pelo navegador não foi conclusiva; plano01 manda confirmar versão no registro antes de instalar --save-exact e não trocar silenciosamente se indisponível. Nenhuma instalação feita.

Verificação documental executada: sete arquivos (mapa00, planos01–05 e este progresso),21 links locais válidos, sem whitespace final; git diff --check sem falhas. Auto-revisão também fixou AbortSignal explícito entre codec/import-service, limite de lote contado por alvos totais e observação temporária de leitura Main distinta do receipt de mutação. Os comandos de teste nos planos são instruções futuras, não evidência de testes rodados nesta atividade.

## Limites preservados

PlanoB continua ativo; não restaurar ferramentas/guardA. Correção de resposta contextual já concluída em rodada anterior: [registro](2026-10-27-contextual-task-responses.md); não refazer. Modelo/voz reais continuam adiados e não há autorização de exportação de calendário pessoal. Somente fixtures sintéticas no aceite local. Assinatura e VM limpa permanecem release-only.

Pontos técnicos para revisão explícita: subset .ics e falha de exportação sem equivalência; worker de parser15s/50.000 passos; versão candidata2.2.1. Aceitar biblioteca não significa suportar todo RFC sem limites nem usar timezone ausente como se fosse local.

## Início da execução autorizada — etapa01

Usuário confirmou os planos. Método nativo/main preservado; sem commit/push. Criados tipos, store SQLite e migração005 aditiva, calendário Intl/ical.js e testes sintéticos. ical.js2.2.1 confirmado no registro e instalado --save-exact --ignore-scripts, com licença copiada para resources/licenses e inclusão no pacote configurada. Nenhuma agenda/notificação/ferramenta reminders habilitada nesta etapa.

Ruling: calendário implementado antes do store após testes RED de ambos, pois a criação persistida precisa calcular nextDue. Ruling: scripts de instalação não rodados para não baixar/reconfigurar assets desnecessariamente. npm avisou Node26.8.2 fora do engine declarado Node24 e vulnerabilidades em dev; auditoria de produção separada retornou0 vulnerabilidades. Nenhum npm audit fix aplicado.

GREEN inicial8/8; cobertura ampliada para paginação/delete/preferências e segunda conexão real. Typecheck detectou assinatura Time.fromString com parâmetro obrigatório; tipos instalados inspecionados e usada Time.fromDateTimeString; typecheck passou. Revisão independente encontrou dois Important: UNTIL UTC comparado como floating e COUNT consumindo horário DST inexistente. Ambos reproduzidos RED; correção aplica limites após resolução do fuso, mantendo EXDATE na contagem RFC. Domínio final11/11 GREEN. Suíte verify final em andamento; não usar run anterior como evidência pós-correção.
## Etapa01 concluída — evidência final

- 11 testes novos de domínio passaram: calendário/clamp/DST/fuso/RRULE, limites UTC/COUNT, idempotência, CAS, rollback de lote, snooze/conclusão individual, paginação/tombstone/preferences, duas conexões e upgrade v4→v5 com reabertura e histórico preservado.
- npm.cmd run verify final: typecheck0 erros,241/241 testes TS e build aprovado. Aviso existente de bundle renderer>500kB. Nenhum teste Python foi repetido porque o backend Python não mudou nesta etapa.
- npm.cmd run audit:runtime:0 vulnerabilidades de produção. Install avisou6 vulnerabilidades de desenvolvimento e engine Node26.8.2 fora do Node24 declarado; não usar esta execução como prova de ambiente Node24. Sem correção automática de dependências.
- Migração005 carregada no Main, ical.js2.2.1 fixado no lock, licença original copiada e incluída no padrão de arquivos do pacote. Reminders continua desativado e sem executor/scheduler/notificação até as entregas seguintes.
- Revisão independente: dois Important confirmados, ambos reproduzidos e corrigidos RED→GREEN. Nenhum Critical ou Minor separado reportado; não alegar segunda revisão independente após correções.

Contratos/rulings de implementação: receipts mantêm metadados da mutação original; replay retorna leitura atual dos IDs afetados sem reaplicar efeito. Snooze precisa realmente postergar o instante e ser futuro. Edição de agenda não reativa implicitamente item completed; esse fluxo exigiria intenção explícita fora do patch atual. Transações são síncronas, sem aninhamento. Arquivos públicos e imports não instalam agenda em background.

Próximo ponto de retomada: plano02/host-tools. Não refazer01, instalar outra versão de ical ou iniciar04 antes de integrar revisão por módulo/execução Main. Nenhum pacote comercial novo de reminders ou smoke de notificações foi alegado nesta etapa; pertencem05. Main mantida, sem commit/push, sem APIs reais de IA/voz.

## Etapa02 — ferramentas Main e isolamento por módulo

Implementados: sete capacidades reminder_create/list/get/update/delete/complete/snooze com schemas estritos; executor Main, autorização/revisão do módulo e receipts/observações confiáveis. Nenhuma função reminder adicionada ao worker Python. Computer mantém suas cinco ferramentas e PowerShell livre; teste do planoB agora filtra seu próprio módulo.

Bridge usa revisão por moduleId, mapa explícito de executores e catálogos diferenciais. Stop de reminders não fecha computer e stop de computer não impede reminders. Python conserva pedido/grant de capacidade inalterada durante troca de snapshot e rejeita grant sem correlação/args/definição; metadata é limpa no fim da invocação. Reminders sem executor Main não cai em Python.

TaskService promove etapa somente por callback Main com contexto original e observação correspondente; proofs novas persistem apenas refs/IDs/kind/horário de observação, sem títulos ou descrições. Leitura tem snapshot volátil; escrita confere receipt persistido. Callback limpa observações no fim e sessão, e metadados voláteis da tarefa são descartados no término/abandono. Cancelamento antes do commit não grava; invalidação após commit não desfaz nem repete efeito.

Planner Python/Live reconhecem reminder_read/reminder_write; compositor contextual recebe dados limitados e datas específicas da ocorrência adiada. Resultado de snooze aponta a ocorrência afetada, separado da próxima ocorrência da série; caso observado em testeRED e corrigidoGREEN. Prompt não substitui módulo indisponível por serviços ou tarefas Windows e pede esclarecimento quando faltar referência temporal confiável. Não foram adicionadas novas confirmações por operação.

Evidências: RED→GREEN de routing, serviço ausente, promoção/prova, critérios/diagnóstico Python e ocorrência alvo de snooze. npm run verify passou typecheck,246/246 testes TS e build; Python84/84. Após refinamento de consultas pontuais em vez de carregar todo histórico,16/16 testes do domínio e typecheck passaram; build final aprovado depois desse refinamento. Quatro casos stdio de computer existentes passaram na suíte completa; fluxo stdio completo de reminders pertence ao aceite05, não foi alegado aqui.

Revisão independente estática não confirmou Critical/Important. Não alegar segunda revisão após refinamentos de retorno/cleanup/consulta. Um teste Live preexistente esperava20ms e falhou antes de live_closed chegar; substituída espera fixa por Event do status com deadline2s, sem alterar LiveCall de produção. Falha e causa registradas nos logs, não atribuídas à API real. Scanner ampliado314 arquivos sem achados; diff sem falhas de whitespace.

Sem API real, conta/calendário pessoal, commit/push ou alteração de modelo/retries. Reminders continua desativado por padrão; UI ainda não habilita seu switch e não existe scheduler/notificador nesta etapa. Próxima etapa03: scheduler/recuperação;04: tela/.ics;05: rebuild completo do sidecar/pacote/aceite. Binário comercial final de reminders ainda não gerado; backend Python mudou, então não usar pacote anterior como prova desta etapa. Método nativo/main e aprovação dos planos preservados.
