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
