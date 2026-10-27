# Controle do computador — desenho para revisão

> **Decisão vigente:** usuário rejeitou A após testar e ordenou B. Abaixo fica o desenho histórico; [plano B em execução](../plans/2026-10-27-computer-control-plan-b.md) define o produto atual com as cinco ferramentas originais e PowerShell livre.

Data: 27/10/2026. Fase 03. **Status: alternativa A autorizada pelo usuário após a apresentação do plano em 27/10/2026.** As alternativas abaixo preservam o contexto da decisão; consultar o progresso para evidências de implementação.

## Intenção e decisões preservadas

Permitir localizar/abrir aplicativos, abrir arquivos/pastas, consultar processos e organizar arquivos numa solicitação composta. Reutilizar a fundação modular e o orquestrador; comunicar claramente o que foi observado e o que ficou desconhecido.

Confirmado pelo usuário: Total Control com consentimento geral, sem confirmação por operação; PowerShell atual mantido, sem lista fechada substituindo o shell. Main governa licença, consentimento, sessões, persistência e admissão; Python executa em workers descartáveis. Preservar texto, Live, memória, chaves independentes e comportamento do X. Sem novas chamadas ao modelo nesta rodada: usuário adiou esse aceite por limite de tokens. Não interpretar isso como autorização de exportação de dados reais.

## Estado observado no código

- Cinco capacidades existentes no manifesto: run_powershell, get_system_telemetry, gui_action, control_system_volume e capture_screen_base64. Já possuem admissão pelo Main e desligamento modular.
- TaskService.observe verifica somente telemetry_read. Processo encerrado com exit code 0 não comprova objetivo arbitrário.
- Plano contém args, dependsOn, bindings e successCriterion; validate_plan aceita apenas none/telemetry_read com expected=null. Não há revisão automática; limites atuais: 8 etapas, 120 s por tarefa, teto de 2 revisões.
- Main recebe plan_ready com stepIds, mas não recebe o plano completo. contextFor confirma tarefa/etapa/sessão; ainda não compara capacidade e argumentos com um plano registrado no Main.
- TaskRecord.evidence é never[]; referências de prova não sobrevivem ao reinício. Esse limite importa para o histórico das novas ações verificáveis.
- Consulta, classificação e workers já existem; não criar outro broker, armazenamento de switches, canal HTTP ou framework de módulos.

## Alternativas para a decisão C1

**A — recomendada: complementar com ações estruturadas e verificadores.** Preservar as cinco capacidades e somar seis ferramentas de finalidade específica. Isso permite vincular descoberta a abertura sem interpolar uma saída em PowerShell. Exige contratos adicionais, registro volátil do plano no Main e prova persistente em metadados.

**B — escopo menor: aprimorar somente as cinco ferramentas atuais.** Melhorar diagnósticos e apresentação dos resultados, mantendo abertura/organização via PowerShell/GUI. Menor alteração; tarefas com efeitos arbitrários continuam unknown quando não há prova adequada. Não apresentar essa alternativa como entrega de abertura/movimentação verificadas.

O restante deste desenho e o plano executivo descrevem a alternativa A **como proposta**, não como escolha feita pelo usuário. Se escolhida B, reduzir e revisar o plano antes de executar. Nenhuma alternativa substitui ou restringe globalmente o PowerShell livre já aprovado.

## Contrato das capacidades propostas

Todas pertencem a computer, passam pelo broker e têm inputSchema/outputSchema estritos no manifesto único. Novas permissões acompanham o consentimento do módulo conforme política atual; não inferir consentimento de documentos, títulos de janela ou saídas de ferramentas.

| ID | Entrada | Saída relevante | Permissão / timeout proposto |
| --- | --- | --- | --- |
| find_application | query: string, 1–80 caracteres | outcome: unique/ambiguous/not_found; candidates: lista limitada; path somente se unique | computer.applications.read / 5.000 ms |
| inspect_path | path: caminho local absoluto | exists, kind, identity e atributos; sem conteúdo do arquivo | computer.files.read / 5.000 ms |
| inspect_processes | name?: string; pid?: inteiro positivo | entradas pid, creationTime, name, executable; matched/truncated | computer.processes.read / 5.000 ms |
| open_application | path: .exe absoluto; args: string[] | identidade do processo realmente criado, observação e resultado da abertura | computer.applications.open / 10.000 ms |
| open_path | path: arquivo/pasta local | solicitação aceita/recusada pelo Windows e prova disponível | computer.files.open / 10.000 ms |
| move_path | source e destination absolutos e distintos | snapshots before/after e outcome | computer.files.move / 10.000 ms |

Limites propostos: até 20 candidatos de aplicativo; até 50 processos por resposta; argumentos de aplicativo até 16 itens de 1.024 caracteres cada; paths clássicos até 259 unidades UTF-16, sem NUL. Nunca truncar paths/argumentos para executá-los. inspect_processes exige exatamente um filtro name ou pid; nenhum filtro retorna invalid_input. Truncamento é explícito e impede afirmar que a lista é exaustiva.

Descoberta inicial: executáveis clássicos .exe de App Paths HKCU/HKLM (visões 32/64 bits), mais correspondência exata em Windows/System32. Deduplicar pelo caminho resolvido; múltiplos resultados não são escolhidos pela ordem. Não varrer discos, importar PATH arbitrário ou instalar aplicativos. UWP/MSIX, atalhos .lnk e URLs ficam fora desta primeira versão. Fontes App Paths estão descritas na [documentação Microsoft](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration).

open_application usa argv separado e shell=False, com ambiente mínimo; não elevar privilégios. Executável ausente, fora do formato ou sem acesso falha antes do lançamento. Processo já existente com mesmo nome não comprova novo lançamento. Aplicativo que delega a outro processo ou encerra rápido pode resultar unknown; não confundir processo criado com janela pronta ou tarefa do usuário concluída.

open_path usa ShellExecuteExW, verbo open, sem runas nem argumentos de comando. Aceitação do pedido pelo Shell não comprova janela aberta: o Windows pode reutilizar processo/DDE sem devolver um novo handle, conforme [SHELLEXECUTEINFOW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow). Sem prova específica, manter unknown e apresentar apenas que o pedido foi aceito.

## Caminhos e movimentação — proposta C2

Primeira entrega estruturada: volumes locais, mesma unidade/volume na movimentação, destino inexistente e pai já existente. move_path não sobrescreve nem cria automaticamente o diretório de destino. Não implementar exclusão, lixeira, cópia entre volumes ou rollback de operações arbitrárias nesta fase.

Rejeitar caminho relativo, drive-relative, UNC, namespace de dispositivo, ADS, curingas, segmentos .. e reparse points no alvo/ancestrais verificados. Arquivo aberto/sem acesso retorna erro real. Diretório não pode ser movido para dentro de si. Diferenças somente de caixa recebem erro específico nesta versão, não tentativa ambígua.

Usar MoveFileExW com flags=0, sem COPY_ALLOWED/REPLACE_EXISTING/DELAY_UNTIL_REBOOT. A opção COPY_ALLOWED pode copiar e deixar a origem quando sua remoção falha, conforme [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw); por isso não é tratada como movimentação simples neste escopo.

Comparar identidade de volume/arquivo antes e depois; arquivo ausente na origem, mesmo objeto no destino e destino previamente ausente formam a prova limitada. Mudança de identidade/ancestral ou cancelamento após o efeito implica unknown, sem repetição. Validação de caminho e observação posterior não constituem sandbox contra todas as corridas do sistema de arquivos. O PowerShell geral continua com o alcance já aprovado; estes limites pertencem às novas ferramentas estruturadas.

## Registro de plano e prova

Antes de qualquer nova ação estruturada, Python envia task_plan ao Main. Main valida a tarefa/sessão/revisão, DAG sequencial, schemas, limites e critérios; mantém o plano completo somente em memória. SQLite recebe IDs/estados e referências de prova, nunca comandos, argumentos, paths, nomes de processos, screenshots ou conversa.

Contrato proposto: task_plan {requestId, sessionId, taskId, expectedRevision, plan: TaskPlan}; task_plan_ack {requestId, taskId, revision, accepted, errorCode?}. Ack de aceitação substitui plan_ready para tarefas desta versão e persiste apenas os IDs. Negociar taskRuntimeVersion=2 explicitamente; versões incompatíveis bloqueiam início de tarefas, sem fallback para execução legada privilegiada. Não alterar envelope v1 ou transporte PCM.

TaskService.authorizeInvocation(taskId, stepId, sessionId, capabilityId, args) compara a chamada ao plano aceito. Bindings são resolvidos novamente no Main usando somente outputs validados de dependências succeeded. Inputs não podem ser sobrescritos. Permanecem proibidos bindings em run_powershell; arquivo/resultado externo não vira autorização.

Critérios propostos, todos com expected=null: none, telemetry_read, application_resolved, path_observed, processes_observed, process_started, path_moved. O verificador deriva os alvos dos args já aceitos, não de strings livres do LLM. Não aceitar verified=true enviado como argumento ou como alegação de texto. O Main promove o estado só após conferir os campos observáveis da resposta do worker confiável, capacidade, contexto e precondições correspondentes.

Prova de process_started é identidade de processo/creationTime/executável compatível com o lançamento observado; não prova interface pronta. path_moved prova a transição descrita acima; não prova organização semanticamente correta de uma coleção. application_resolved requer um único candidato; ambiguidade gera esclarecimento de intenção, sem iniciar aplicativo.

Migração proposta 004-task-evidence.sql: referências opacas por tarefa/etapa/invocação, kind, observedAt e veredito. TaskRecord.evidence passa a Evidence[]. Persistir prova e avanço da etapa na mesma transação CAS. Histórico relata observação passada, não presença atual do processo/arquivo. Crash/reinício continua sem replay; perda do plano volátil interrompe a tarefa e preserva referências já gravadas.

## Execução, UI e privacidade

Workers continuam descartáveis. Cancelamento impede a próxima etapa e aguarda a limpeza do worker; lançamento ainda em curso encerra somente a árvore criada pela invocação. Não encerrar aplicativo preexistente nem desfazer etapas anteriores já observadas. Movimentação que terminou antes de cancelar pode permanecer realizada; relatar incerteza quando não reconciliada.

Sistema & Automação conserva o switch computer. Acrescentar descrições e diagnóstico das novas capacidades na tela atual, sem outro painel ou confirmações por operação. Interface distingue verificado, solicitação aceita, parcial, ambíguo e desconhecido. Dados de consulta pedidos pelo usuário podem aparecer na resposta volátil; não devem ir ao histórico SQLite. Manter erro/cancelamento distintos de mute/barge-in.

Testes desta fase não usam API de IA/voz, perfil real, arquivos pessoais, nomes de processos do usuário ou captura real de tela. Fixtures locais/temp e aplicativo auxiliar controlado permitem testar nativamente as ações. Validação com provedor real permanece diferida; executar esse teste ou exportar dados reais exigirá a direção correspondente, respeitando o bloqueio de aprovação registrado.

## Aceite, fora de escopo e decisões pendentes

Aceite local: descoberta ambígua não lança nada; descoberta única → abertura por binding sem shell; inspeção → movimento em pasta temporária → inspeção pós-movimento; cancelamento de processo auxiliar com PID observado e sem nova etapa; disable/licença/sessão antiga bloqueiam despacho; evidências sobrevivem ao reinício sem reexecução. Demonstração com modelo real e Windows limpo permanecem gates distintos, não simulados como concluídos.

Fora de escopo: OCR, UI Automation semântica, instalação, elevação, organização periódica, indexação de disco, apps empacotados, compartilhamentos, copiar entre volumes, recuperação automática e novas integrações dos planos 04–14.

Para aprovação: C1 (A complementar ou B somente atuais); C2 (escopo local conservador das novas ferramentas); C3 (plano registrado no Main + evidência redigida e migração 004). Todos os valores novos de timeout/limite são propostas acima. Aprovar desenho/plano é distinto de autorizar implementação; método nativo previamente escolhido é preservado se a execução for autorizada.
