# Controle do computador — plano de implementação

> **SUPERADO por decisão posterior do usuário:** A foi rejeitado. Consultar [execução do plano B](2026-10-27-computer-control-plan-b.md). Não reintroduzir as seis ferramentas estruturadas nem o guard A.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans após aprovação e autorização. Execução nativa em main, conforme preferência do usuário. Seguir as caixas por tarefa.

**Goal:** Compor descoberta, abertura e movimentação de arquivos com resultados verificáveis pelo orquestrador.

**Architecture:** A alternativa A preserva as cinco capacidades atuais e acrescenta seis ferramentas estruturadas. Main aceita o plano em memória e persiste somente metadados de evidência; workers Python executam e observam efeitos no Windows.

**Tech Stack:** TypeScript/Electron, Python, ctypes/Win32, psutil e SQLite existentes. Nenhuma dependência nova.

**Spec:** [Desenho para revisão](../specs/2026-10-27-computer-control-design.md).

**Status:** alternativa A autorizada pelo usuário em 27/10/2026, conforme este plano, incluindo C2/C3. Execução e evidências registradas no [progresso](2026-10-27-computer-control-progress.md).

## Global Constraints

- Total Control geral, sem confirmação por operação; preservar PowerShell livre, licenciamento, switches, texto e Live.
- Main governa admissão; reutilizar broker, workers e histórico. Nenhuma porta local ou framework novo.
- Preservar 8 etapas, 120 s por tarefa e teto de 2 revisões; sem revisão automática, retry ou fallback.
- Limites novos propostos: consultas 5.000 ms, ações 10.000 ms; 20 candidatos, 50 processos; 16 argumentos de 1.024 caracteres; caminhos até 259 unidades UTF-16.
- Movimentação estruturada local/no mesmo volume, destino ausente e pai existente; sem overwrite, cópia, exclusão ou rollback. PowerShell geral mantém alcance atual.
- Sem chamadas IA/voz, exportação de dados reais, troca de modelo, commit/push ou publicação. Aceite com modelo real permanece diferido.

## Review Focus

1. Capacidade/argumentos alterados ou sessão/revisão antiga: negar antes do efeito — tarefa 1.
2. Unicode, reparse, destino existente e corrida de identidade: nunca sobrescrever silenciosamente — tarefas 2–3.
3. Descoberta ambígua, PID antigo e processo delegado: nunca declarar sucesso falso — tarefas 2–3.
4. Cancelamento repetido/após efeito: sem replay, sem dependente, sem matar processo preexistente — tarefas 3 e 5.
5. Crash, falha SQLite ou protocolo incompatível: atomicidade, interrupção sem replay e sem fallback privilegiado — tarefas 1, 4 e 5.

## Mapa de responsabilidades

Criar `src/main/tasks/task-plan-guard.ts` para aceitação/bindings e `computer-verifier.ts` para provas; alterar `task-service.ts`, `task-store.ts`, `task-event-router.ts`, `task-protocol.ts`, `application.ts` nessa pasta e `src/main/modules/runtime-bridge.ts`. Acrescentar migração `004-task-evidence.sql` junto às migrações existentes e atualizar tipos compartilhados.

Criar `jasper-backend/computer_paths.py` (validação/identidade), `computer_discovery.py` (App Paths/processos) e `computer_actions.py` (ações Win32). Registrar funções em `tools_os.py`; integrar contratos/planner/executor/verificação em `jasper-backend/orchestration/`. Não criar facade redundante `modules/computer.py`.

Manter schemas em `resources/modules/native-capabilities.json`. Alterar somente telas existentes de módulos/progresso. Conferir imports PyInstaller e inclusão da migração no pacote.

### Tarefa 1 — Plano aceito pelo Main

**Arquivos:** novo guard e `test/computer-plan-guard.test.ts`; integração nos arquivos Main/protocolo/orchestration acima.

**Interfaces:** `TaskPlanGuard.accept(taskId, sessionId, expectedRevision, plan)`; `TaskService.authorizeInvocation(taskId, stepId, sessionId, capabilityId, args)`. Reutilizar tipos TaskPlan existentes. Contratos `task_plan`/`task_plan_ack` exatos no desenho.

- [x] Criar testes `rejects_changed_args_before_dispatch`, `rejects_stale_revision`, `rejects_binding_from_unsucceeded_step`, `rejects_shell_bindings`, `rejects_incompatible_runtime`; executor não chamado, estado não promovido.
- [x] Rodar `npm.cmd test` e `npm.cmd run test:python`; confirmar RED nas novas asserções.
- [x] Implementar validação de schemas/DAG/limites/critérios e plano volátil antes do ack. Negociar `taskRuntimeVersion=2`; substituir plan_ready nessa versão, sem alterar envelope v1/PCM. Incompatibilidade bloqueia tarefas sem fallback privilegiado.
- [x] Resolver bindings também no Main a partir de outputs validados de dependências succeeded; não sobrescrever args fixos nem permitir binding em PowerShell. Comparar chamada efetiva com plano aceito antes do despacho; invalidar plano ao encerrar tarefa/sessão.
- [x] Rodar ambas as suítes e `npm.cmd run typecheck`; registrar GREEN e limitações, sem commit automático.

### Tarefa 2 — Consultas e manifesto

**Arquivos:** novos computer_paths/discovery e `jasper-backend/tests/test_computer_paths.py`, `test_computer_discovery.py`; manifesto e testes existentes de registro/broker.

**Interfaces:** `inspect_path(path: str) -> dict`, `find_application(query: str) -> dict`, `inspect_processes(name: str | None = None, pid: int | None = None) -> dict`. Saídas estritas conforme desenho; snapshot interno inclui identidade volume/arquivo e atributos.

- [x] Criar testes RED para relativo/UNC/device/ADS/NUL/`..`/reparse; limite UTF-16 com caracteres suplementares; exatamente um filtro de processo; limites e truncamento explícitos.
- [x] Testar App Paths HKCU/HKLM32/64 por backend injetado: duplicatas, único, ambíguo e ausente; ambiguidade não seleciona path. Não consultar registro/perfil real.
- [x] Rodar `npm.cmd run test:python` e confirmar falha dos novos comportamentos.
- [x] Implementar consultas sem conteúdo de arquivo, varredura de disco/PATH, UWP, atalhos ou URLs. Descoberta usa App Paths e correspondência exata Windows/System32.
- [x] Registrar seis schemas/permissões/timeouts do desenho, mas anunciar somente funções suportadas pelo executor. Atualizar casos válidos/inválidos de cada capacidade no broker. Rodar `npm.cmd test` e `npm.cmd run test:python`; registrar GREEN.

### Tarefa 3 — Abertura e movimentação

**Arquivos:** novo computer_actions e `jasper-backend/tests/test_computer_actions.py`; registro em tools_os. Reutilizar ambiente mínimo e lifecycle dos workers.

**Interfaces:** `open_application(path: str, args: list[str]) -> dict`, `open_path(path: str) -> dict`, `move_path(source: str, destination: str) -> dict`. Backend Win32/fábrica de ambiente injetáveis; evitar import circular com tools_os.

- [x] Criar testes RED para argv separado, executável ausente, processo preexistente/delegado/rápido, Shell aceito sem handle, destino existente, cross-volume, diretório dentro de si, troca de identidade e mudança somente de caixa.
- [x] Implementar lançamento `shell=False`, sem elevação; observar PID+creationTime+executável criados. ShellExecuteExW/open aceita arquivo/pasta; pedido aceito sem prova específica permanece unknown.
- [x] Implementar MoveFileExW flags=0 com snapshots antes/depois: origem ausente e mesma identidade no destino antes ausente. Sem copiar/apagar como fallback; rejeitar caminhos fora de C2.
- [x] Testar cancelamento antes/após efeito e repetido: sem replay/dependente, sem matar app preexistente; limpar somente árvore pertencente à invocação em curso. Não prometer desfazer etapa concluída.
- [x] Rodar `npm.cmd run test:python`; registrar GREEN. Corridas simuladas não substituem aceite nativo da tarefa 5.

### Tarefa 4 — Provas e histórico atômico

**Arquivos:** novo computer-verifier, `test/computer-verifier.test.ts`, `test/task-evidence.test.ts`, migração 004; TaskService/TaskStore, tipos e verificadores Python.

**Interfaces:** `verifyComputerResult(capabilityId, args, result)` retorna veredito/metadados; `TaskRecord.evidence: Evidence[]` contém referência opaca, task/step/invocation IDs, kind, observedAt e veredito. Persistência da prova e avanço CAS na mesma transação.

- [x] Testar RED dos critérios application_resolved/path_observed/processes_observed/process_started/path_moved e existentes: expected=null, args/contexto/capacidade correspondentes. Não aceitar alegação verified do modelo.
- [x] Testar falha de transação sem avanço parcial, refs após reinício e ausência de paths/args/comandos/process names no SQLite. Perda do plano volátil interrompe tarefa sem replay.
- [x] Implementar verificadores Main sobre resposta validada do worker confiável. Outputs completos ficam voláteis para bindings; histórico guarda metadados. Processo iniciado não prova janela pronta; open_path sem prova não recebe verificado.
- [x] Integrar critérios Python e confirmação Main; schema inválido não promove sucesso. Rodar `npm.cmd test`, `npm.cmd run test:python`, `npm.cmd run typecheck`; registrar resultados e limites de crash ainda não exercitados.

### Tarefa 5 — Interface, fluxo composto e artefato

**Arquivos:** telas/testes existentes de module-settings/task-progress; novo `test/fixtures/computer-app.cs`; testes stdio, `test-artifact/python-package.test.ts`; configuração PyInstaller se necessária.

**Interfaces:** consumir eventos/estados existentes de TaskService. Preservar aviso de reiniciar chamada ao habilitar ferramenta durante Live, conforme decisão anterior.

- [x] Testar apresentação distinta de verificado, pedido aceito, ambíguo e desconhecido; atualizar descrições na tela atual. Sem nova confirmação ou dados brutos no histórico.
- [x] Testar fluxo determinístico exclusivo de teste `inspect_path → move_path → inspect_path` em temp com executor nativo, identidade e estado final reais.
- [x] Compilar auxiliar controlado apenas em temp e injetar descoberta de teste para `find_application → open_application` com binding. Sem instalar App Paths global ou enviar auxiliar no produto. Cleanup somente PID+creationTime próprios.
- [x] Testar disable/licença/sessão antiga antes do despacho; cancelamento com PID observado e nenhuma dependente; restart preserva refs sem replay. Sem enumerar processos pessoais/capturar tela real.
- [x] Rodar sequencialmente `npm.cmd run verify`, `npm.cmd run test:python`, `npm.cmd run package:dir`, `npm.cmd run test:package`, `npm.cmd run verify:package`, `npm.cmd run smoke:packaged`. Teste compilado cobre v2, rejeição antiga e fixture temporária. Nenhuma API. Estes comandos são futuros, não executados neste planejamento.
- [x] Atualizar progresso, revisar diff e `git diff --check`. Separar aceite nativo de modelo real, assinatura e VM limpa; apresentar próximo passo sem iniciar planos 04–14.

## Revisão e ponto de parada

Cobertura: admissão na tarefa 1; consultas na 2; efeitos na 3; provas/histórico na 4; interface/artefato na 5. Cinco riscos têm testes atribuídos; nomes/interfaces acima são os contratos propostos, não código existente.

Execução autorizada da alternativa A. Consultar o progresso para etapas comprovadas e gates pendentes; não declarar concluído o aceite com provedor real.
