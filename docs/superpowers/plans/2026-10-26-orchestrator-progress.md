# Progresso — plano 02, orquestrador

Plano: [02 — Orquestrador](2026-10-26-modular-agent-02-orchestrator.md). Branch main, sem commit/push. Usuário autorizou avançar apesar do HTTP 503 do chat, mantido como pendência separada. Fundação modular não recebe aceite comercial retroativo.

## Decisões aprovadas nesta rodada

O1–O5: executor sequencial; máximo 8 etapas, 120 segundos por tarefa e 2 revisões; tarefas de Live canceladas ao encerrar a chamada, sem cancelar tarefas de chat independentes; histórico apenas com metadados e sem exclusão automática; ausência de prova verificável implica unknown. Nenhum retry automático novo, integração externa, serviço, paralelismo ou replay após reinício.

## Pre-flight de contratos

- T1 → T2: Main cria IDs e persiste apenas metadados; pedidos, planos com argumentos e saídas brutas permanecem voláteis.
- T2 → T3: plano validado antes do primeiro efeito; dependências acíclicas e bindings só de saída validada. Não interpolar bindings em comandos shell.
- T3 → T4: eventos sequenciados com CAS e ack Main antes de próxima etapa; sessão antiga não altera tarefa atual.
- Broker atual usa taskId/stepId derivados de requestId; integração deverá vincular chamadas a tarefa/etapa autorizadas no Main sem confiar em IDs do LLM.
- Migration correta é 003-tasks.sql. Menção a migration 002 na tarefa 1 é erro documental: 002 pertence às reservas da fundação. Não renumerar schema existente.
- Não afirmar sucesso arbitrário por texto do LLM, exit code ou resultado bruto. Verificadores determinísticos têm escopo limitado.

## Estado

Em execução: Tarefa 1, tipos, armazenamento transacional e testes de recuperação. Tarefas 2–4 ainda não implementadas. Validação e limites serão registrados por etapa.

## Integração em andamento

T1: TaskStore/TaskService e migração 003 implementados com CAS, sequenciamento, snapshots redigidos e recuperação sem replay. IDs de tarefa gerados pelo Main; invocationId estável por tarefa/etapa usa o InvocationStore existente. Consentimento/licença/sessão revalidados antes da ferramenta; prazo Main também bloqueia novos dispatches após 120 s. Ainda não declarar aceite de crash em todas as fronteiras.

T2: contratos Python, validação de plano e Planner implementados. Rejeita ciclos/ordem inválida, IDs duplicados, capacidade ausente, bindings fora das dependências, mais de 8 etapas e critérios sem verificador conhecido. Bindings nunca interpolam PowerShell. Sem reparo permissivo de JSON, retries/replanejamento automático ou execução de texto malformado. Limite de revisão 2 validado; esta primeira implementação só produz revisão 0, sem política automática de revisão.

T3: executor sequencial, cancelamento e estados conservadores integrados a ponte de tarefas com ack Main antes de avançar. Verificador telemetry_read no Main comprova somente leitura estruturada de CPU/RAM/disco, não uma condição arbitrária do sistema; sem expected não nulo. Demais ferramentas permanecem unknown sem prova. Raw outputs em memória, sem DB. Teste real do worker encontrou divergência disk/disk_c no verificador; alinhado ao contrato existente disk_c.

T4: extensão stdio negociada, eventos/acks tipados, tasks:list/get/cancel, preload e painel mínimo de progresso/cancelamento integrados. Texto detecta pedido de ferramentas pelo adaptador e solicita um plano validado; Live usa o mesmo broker e oferece execute_task para objetivos compostos. Transporte PCM/STT/TTS preservado. Sem suporte a execução renderer direta. Demais integrações não iniciadas.

Evidências intermediárias: testes inicialmente vermelhos para componentes ausentes e para negociação/roteamento/aviso; 68 testes Python aprovados após integração. TASK_PROGRESS_PASS no Electron com IPC controlado (cancelamento, revisão tardia e resultado desconhecido). Integração stdio real Main/Python/worker executou duas leituras de telemetria dependentes, persistiu ambas succeeded por prova host e bloqueou novo efeito após disable. Provedor determinístico apenas nesse teste; não é demonstração de modelo real planejando.

Revisão independente em curso; não concluir fase, commit ou pacote ainda. Achado inicial importante: substituição de chat e shutdown podem aguardar ack sem manter stdin livre; aguardar revisão final, corrigir com RED/GREEN e executar suítes novamente. Pendência HTTP 503 do provedor continua separada e não foi ocultada por mock/fallback.

## Revisão independente — rodada de correções

Nenhum Critical; quatro Important reproduzidos e corrigidos com testes que falharam antes da correção:

1. Troca de chat/audio aguardava close inline, bloqueando acks: entradas agora são serializadas na fila de controles, sem prender stdin. Shutdown/EOF destacam a ponte de acks antes de aguardar limpeza; Main reconcilia a sessão encerrada sem replay.
2. Ack perdido após commit de step_started podia deixar running sem job: adicionado evento estrito abandoned. Main reconcilia o estado persistido real (unknown se execução começou), sem confiar na última revisão conhecida do Python e sem repetir o efeito. Ruling: abandono conservador, não retry de dispatch — consistente com a regra aprovada de não replay. Falha de transporte completa continua dependendo da reconciliação ao encerrar sessão.
3. Chat descartava valores observados: resumo determinístico agora inclui CPU/RAM/disco das observações verificadas; mantém o status objetivo e não precisa de nova chamada LLM para descrever esses números.
4. Interrupção de sessão não publicava changed: TaskStore retorna registros alterados, TaskService publica ao renderer; PythonBackendManager emite onSessionEnded uma vez por sessão em stop/exit/violação de protocolo. Sem aguardar próximo hello para reconciliar.

Evidências após correções: 72 testes Python aprovados; 17 testes do gerenciador backend aprovados. Integração stdio acrescentou cancelamento durante worker PowerShell real (Start-Sleep de teste), terminando em unknown com etapa seguinte skipped, em cerca de 1 s. Provedor determinístico permanece exclusivo da fixture. Suíte completa/pacote em validação.

Minor diferidos: TaskRecord.evidence não persiste referências de prova (estado succeeded exige prova Main, mas detalhes dessa evidência se perdem após reinício); pequenas diferenças de validação Python/TS em sequência zero e task_cancel com ID vazio. Não incluir conteúdo bruto no histórico ao tratar esses itens. Verificador atual só comprova leitura de telemetria, não objetivos arbitrários. Plano não implementa revisão automática (limite validado, zero revisões geradas).

## Regressão adicional de cancelamento — processo observado

O teste de cancelamento foi fortalecido: a ferramenta PowerShell grava somente seu PID num diretório temporário de teste antes de Start-Sleep; o teste aguarda esse marcador, cancela a tarefa e verifica ESRCH para o PID real. Primeira execução falhou: o fluxo podia finalizar antes de a árvore estar encerrada. Investigação reproduziu segunda chamada de cancel durante finally do worker, interrompendo await taskkill/process.wait. Teste Python sincronizado em cleanup_started também falhou antes da correção.

Correção: cancelamento do worker/job idempotente enquanto cancelling; espera de limpeza em ModuleBridge.invoke protegida contra cancelamento repetido do chamador. Sem mudar política ou acrescentar prompts. GREEN: 72/72 Python e três cenários stdio reais, incluindo PID PowerShell iniciado e ausente após cancelamento, tarefa unknown e etapa dependente skipped. A primeira versão do teste, sem marcador de PID, não comprovava esse requisito; esta evidência a substitui.

Antes desse ajuste, o pacote havia aprovado verify:package, smoke isolado e teste licenciado: licença unlocked, computer habilitado, connectAgent success; áudio Live em 3.900 ms. Chat permaneceu HTTP 503 ServerError em 3.480 ms, sem resposta esperada. Pacote/sidecar serão recompilados novamente para incluir a última correção; não usar evidência anterior como prova do binário atualizado.

## Estado final desta rodada — implementação local validada

Rebuild final PyInstaller exit 0 e package:dir:from-build exit 0. Manifesto regenerado; verify:package e smoke:packaged aprovados novamente no pacote que contém a correção de cancelamento repetido. Migração 003 incluída no ASAR. Nenhuma assinatura comercial/instalação em VM limpa alegada.

- npm.cmd run verify: typecheck e build aprovados, 227/227 testes TS, zero falhas. Aviso conhecido de bundle renderer >500 kB.
- npm.cmd run test:python: 72/72 aprovados, incluindo cancelamento repetido sincronizado na limpeza, ack perdido, substituição de chat, shutdown e valores observados no resumo.
- npm.cmd run test:package: 9/9 aprovados no sidecar final. O novo teste verifica negociação, task_cancel e shutdown compilados sem API externa. Primeira tentativa concorrente ao empacotamento excedeu seu prazo inicial de hello (5 s); alinhado somente o startup a 15 s, igual ao teste de handshake existente. Reexecução sequencial passou em cerca de 0,5 s. Isso não muda timeout das tarefas/ferramentas.
- TASK_PROGRESS_PASS, MODULE_SETTINGS_PASS e WAKE_LIFECYCLE_PASS no Electron; cenários stdio legacy, duas etapas verificadas e cancelamento com PID real aprovados.
- Scanner com listagem ampliada de rastreados + novos não ignorados: 281 arquivos, zero achados. git diff --check sem erros de whitespace.

Quatro achados importantes da revisão corrigidos; dois Minor diferidos registrados acima. Não foi feita segunda revisão independente nem alegado que testes cobrem todas as fronteiras de crash. A entrega implementa os núcleos e a integração, mas o aceite integral da fase ainda exige objetivo composto planejado por provedor real; o HTTP 503 do chat permanece. A demonstração de duas etapas usa provedor determinístico de teste, com executores nativos reais. Cancelamento de tarefa longa foi comprovado no runtime Python com worker real, não no processo congelado usando um provedor real. Verificação persistente das referências de evidência e verificadores além de telemetry_read continuam limitados.

Próxima ação recomendada: validar o planejamento composto com um provedor real disponível e fechar os limites de aceite antes de iniciar novas integrações. Não trocar provedor/modelo, acrescentar retry/fallback, implementar os planos 03–14 ou publicar sem a direção correspondente. Mantida main; nenhum commit/push. Este arquivo é o ponto de retomada.

## Retomada em 27/10/2026 — diagnóstico do provedor

Continuação autorizada; base encontrada limpa no commit 7adda75. Modelo atual observado é gemini-3.1-flash-lite. Licença/consentimento/conexão passaram no aplicativo; chat recebeu 503 novamente. Sondas no SDK isolado reproduziram 503 com mensagem explícita de alta demanda, inclusive sem ferramentas/orquestrador, com sucessos intermitentes. Adaptador atual sem ferramentas respondeu; com catálogo recebeu 503. Não confundir essa diferença com prova de schema inválido, pois o pedido mínimo também falhou.

Detalhes e decisão pendente: [diagnóstico 503 de 27/10](2026-10-27-provider-503-validation.md). Aguardar escolha do usuário entre teste temporário de outro modelo do catálogo (com restauração) e manutenção do modelo aguardando normalização. Nenhuma troca de modelo/chave, retry/fallback, nova integração ou correção de produção aplicada nesta rodada. Sem commit/push; aceite composto por modelo real continua pendente.

Decisão posterior recebida: manter modelo atual e aguardar normalização do serviço, sem mudar política de tentativas. Não testar modelo alternativo nem realizar novas sondas/polling automático. Retomar o aceite real quando solicitado. Nenhuma alteração de produção nesta rodada; decisão detalhada no diagnóstico vinculado acima.

Retomada posterior por PROSSIGA: teste pontual do chat no modelo atual passou (TESTE OK, 5.591 ms). Teste composto de duas leituras foi preparado, mas a criação do processo foi rejeitada pela revisão automática por possível envio de telemetria real ao provedor sem consentimento específico. Não executado; aceite composto continua pendente. Pedido de consentimento restrito a esse teste enviado e aguardando resposta. Não contornar a rejeição; detalhes no diagnóstico de 27/10. Sem alteração de produção/configuração.

Direção posterior do usuário: PULAR a validação com o modelo por enquanto; informou esgotamento dos tokens disponíveis. Não realizar mais chamadas ou testes com API, não trocar modelo e não acrescentar tentativas. Pedido de consentimento encerrado sem autorização de exportação; não executar o teste composto bloqueado. Aceite com provedor real DIFERIDO pelo usuário, não aprovado. Preservar evidências locais e manter essa pendência separada ao apresentar próximas fases. Nenhuma integração nova autorizada por essa decisão isolada; sem commit/push.

## Fase 03 autorizada e validada localmente — 27/10/2026

Usuário escolheu A e autorizou implementação conforme o plano: ferramentas estruturadas complementares, preservando PowerShell livre. Entrega e evidências: [progresso do controle do computador](2026-10-27-computer-control-progress.md). Protocolo de tarefas v2, plano aceito no Main e migração004 com referências de prova implementados. Suítes locais: TS238/238, Python86/86 e artefato11/11; pacote/integridade/smoke aprovados. Não substitui o aceite de planejamento com provedor real, que permanece diferido. Mantida main sem commit/push. Nenhuma outra fase iniciada.
## Decisão posterior — A revertido, B implementado

Usuário rejeitou A e ordenou B. Estado vigente: cinco ferramentas originais, PowerShell livre, sem catálogo estruturado ou guard A. Diagnósticos apresentam stdout/stderr/código, GUI/volume e erros, sem presumir objetivo verificado; respostas Chat/execute_task Live preservam observações voláteis. Mantida compatibilidade SQLite004 para não perder histórico nem bloquear instalações que abriram A. [Plano B e evidências finais](2026-10-27-computer-control-plan-b.md): TS230/230, Python76/76, artefato9/9, typecheck/build, pacote, integridade e smoke aprovados. Quatro cenários stdio reais passaram. Revisão independente sem Critical/Important. Sem IA externa, commit/push ou nova fase; main mantida. Os registros A acima são históricos e superados.
## Respostas contextuais e início do módulo04 — 27/10/2026

Usuário escolheu resposta final contextual pela IA após ferramentas e pediu avançar ao próximo módulo. Implementado compositor textual com modelo selecionado, uma chamada adicional sem ferramentas, timeout15s, fallback com observação útil e cancelamento propagado, sem repetir ações ou promover estado por texto gerado. PlanoB preservado. Python81/81, TS230/230, artefato9/9, build/typecheck, pacote/integridade/smoke aprovados sem IA real. [Registro da correção](2026-10-27-contextual-task-responses.md).

Módulo04/Lembretes em detalhamento: [desenho com decisões recebidas](../specs/2026-10-27-reminders-design-draft.md). Confirmados último dia do mês para mensal31, eventos e tarefas datados, dia inteiro09:00 ajustável e preservação de alterações locais ao reimportar. Biblioteca versus leitor próprio perguntado, aguardando resposta. Não instalar dependência nem implementar reminders silenciosamente antes de fechar desenho/planos. Main mantida, sem commit/push.
## Módulo04 — desenho aprovado, planos executivos prontos

Usuário aprovou o desenho e o conjunto final para escrever planos separados. Entrega documental: [mapa00 e cinco planos](2026-10-27-reminders-00-execution-map.md), [progresso/retomada](2026-10-27-reminders-progress.md). Ordem: store/calendário → broker Main multi-module → scheduler/retomada → tela/.ics → aceite/pacote. Auto-revisão incluiu snapshot diferencial Python para não cancelar computer ao mudar reminders, compatibilidade SQLite, recibos/leituras e cancelamento do codec. Sete arquivos/21 links locais verificados, diff sem falhas. Nenhuma implementação, migração, instalação ou API executada nesta rodada. Aguardar revisão dos novos planos antes do código; método nativo/main preservado, sem commit/push.
## Lembretes — etapa01 concluída

Planos aprovados pelo usuário. Store/calendário/tipos/migração005 implementados e ical.js2.2.1 fixado no lock, com licença distribuível incluída nos arquivos do pacote. 11 testes novos de domínio; npm run verify final passou typecheck,241 testes TS e build. Audit de produção0 vulnerabilidades. Revisão independente encontrou UNTILUTC e COUNT/DST; casos reproduzidos RED e corrigidos GREEN. Sem segunda revisão alegada. [Progresso e retomada](2026-10-27-reminders-progress.md).

Próximo ponto: plano02 (broker multi-module/ferramentas Main), seguindo aprovação já recebida e método nativo/main. Reminders ainda não anunciado nem agendando/notificando; UI/.ics/scheduler/aceite pertencem às etapas seguintes. Sem API real, commit ou push. Node do terminal26.8.2 fora do engine24 declarado; isso consta das limitações de evidência, sem mudança de engine.
## Lembretes — etapa02 concluída

Sete ferramentas reminders integradas ao Main, com schemas, gate por módulo e prova por receipt/observação; não adicionadas ao worker Python. Bridge Main/Python reconciliam catálogos diferencialmente, preservando computer em andamento. Revisões por módulo e isolamento bidirecional comprovados; planoB preservado. TaskService persiste refs/IDs/kind/horário, sem títulos/descrições. Snooze retorna ocorrência/data afetadas separadas do próximo aviso da série.

Validação: verify com246/246 testes TS, typecheck/build; Python84/84. Após refinamento final de consultas pontuais, domínio16/16, typecheck e build passaram. Revisão independente sem Critical/Important confirmados; não alegar segunda revisão após os refinamentos. Scanner314 arquivos, zero achados, diff sem falhas. Nenhuma API real, mudança de modelo, commit/push ou notificação real.

Retomar no plano03/scheduler;04/ui-ical e05/aceite ainda pendentes. Reminders continua desativado por padrão, sem agenda/avisos até etapas seguintes. [Registro completo](2026-10-27-reminders-progress.md). Aprovação dos planos e método nativo/main permanecem.
## Lembretes — etapa03 concluída em testes de fonte

Scheduler Main com claims SQLite, epoch/token de entrega, gate antes do efeito e retomada por resumo persistente. Notificador silencioso com timeout30s e lease60s; expiração incerta não repete toast. Suspend/resume e teardown ligados ao processo, sem serviço/bandeja/autostart. Resumo e ack testados com presenter fake; UI/preload reais pertencem04.

Verify final:252/252 testes TS, typecheck e build. Domínio reminders22/22 passou novamente após asserts adicionais. Revisão independente:3 Important corrigidos e segunda leitura sem Critical/Important confirmados; limites e refinamentos posteriores registrados no progresso. Sem API/notificação real, commit/push ou pacote novo. Retomar pelo plano04/ui-ical, depois05/aceite; planos já aprovados, execução nativa/main preservada. Fonte de retomada: docs/superpowers/plans/2026-10-27-reminders-progress.md.
## Lembretes — etapa04 implementada

Tela/IPC/preload e iCalendar manual com ical.js2.2.1/worker integrados. CRUD reutiliza o executor Main; switch reminders habilitável, preferências, prévia por token de janela, importação idempotente em lotes100 com migração006, relatório parcial/IDs, exportação atômica com checagem de revisão e resumo com ações por ocorrência. Sem APIs/notificações reais ou commit/push. Limites de VTIMEZONE/exportação sem equivalência explícitos no progresso.

Verify final264/264 testes TS, typecheck/build; reminders34/34; Chromium oculto e worker reais em perfil/arquivos temporários. Revisão independente encontrou4 Important, corrigidos e cobertos; não houve segunda revisão após correções. Após ampliar assertions do DOM/codec, testes direcionados/typecheck e build final passaram. Node26 fora do engine24 e bundle>500kB continuam. Retomar plano05/aceite e pacote, sem refazer etapas anteriores: docs/superpowers/plans/2026-10-27-reminders-progress.md.
## Lembretes — validações locais05 e pacote final

Verify265/265 testes TS, Python84/84, artefato10/10, verify:package e smoke comercial bloqueado aprovados. Sidecar/manifesto/pacote reconstruídos; após descobrir resumo atrás do modal, corrigidos z-index e ack por hit testing, repetidos verify/rebuild/checks afetados e harness final. Stdio cobre create→get, list→update CAS→get e import Main→list, com zero worker Python para lembretes. Scanner341 arquivos sem achados; diff sem falhas; sem commit/push ou APIs reais.

Harness usa Electron dev/serviços/UI de teste e recursos reais ASAR, perfil temporário e rede bloqueada; NÃO prova executável comercial desbloqueado/X/restart. Essa pendência foi apontada pela revisão final e permanece expressa. Pacote local release/win-unpacked/Jasper AI.exe pronto para teste licenciado; Authenticode local NotSigned. Assinatura/VM limpa e IA real são gates separados. Não anunciar aceite integral nem iniciar novo módulo automaticamente. Retomada: docs/superpowers/plans/2026-10-27-reminders-progress.md, seção05 mais recente.
### Fechamento real adicional — pacote ainda sem ativação

Usuário informou que ainda não ativou. Teste scripts/test-packaged-restart.ps1 aprovado: dois startups reais e WM_CLOSE da janela do PID próprio, perfil temporário/PATH sanitizado, exits0, SQLite com SHA256 idêntico. Sem autoquit, credenciais ou perfil pessoal. Só teste/documentação mudaram; não foi necessário rebuild. Scanner342 arquivos sem achados e diff check GREEN. Gate restante: ativação normal do pacote e teste manual de lembretes/X/.ics com dados sintéticos. WM_CLOSE não prova clique do X via IPC ou CRUD licenciado. Não iniciar outro módulo automaticamente; fonte oficial docs/superpowers/plans/2026-10-27-reminders-progress.md.