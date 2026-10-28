# Super-Jarvis modular — roadmap e controle de decisões

> **For agentic workers:** Antes de executar, obter aprovação do desenho e do plano da fase; depois usar superpowers:executing-plans ou superpowers:subagent-driven-development, conforme método escolhido pelo usuário.

**Goal:** Separar a evolução modular sem reescrever o produto.
**Architecture:** Opção A escolhida em 26/10/2026: coordenação Python e governança Electron Main. Demais decisões e autorização de implementação pendentes.
**Tech Stack:** Electron 44, TypeScript, Python, IPC tipado, stdio privado.
**Spec:** [Desenho preliminar](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** Planos 01 e 02 consolidados com contratos, arquivos, tarefas TDD e critérios de aceite para revisão. Demais módulos continuam roteiros preliminares. Nenhum plano está autorizado para execução; propostas técnicas ainda precisam de aprovação. Nenhum teste de produto ou implementação foi executado nesta atividade.

## Inventário verificado no código
- jasper-backend/runtime.py:JasperRuntime: loop LLM/ferramentas com limite de cinco iterações; não é ainda um coordenador persistente de planos verificáveis.
- jasper-backend/tools_os.py: TOOLS_SCHEMA e AVAILABLE_FUNCTIONS, PowerShell, GUI, volume, telemetria e captura.
- jasper-backend/live_tools.py: workers descartáveis com timeout de 25 segundos e término de processo; runtime de texto usa asyncio.to_thread, cuja interrupção não encerra uma função já em execução.
- jasper-backend/live_session.py: caminho Live distinto; ambos precisam da mesma política modular.
- src/main/services/operational-access.ts: licença e consentimento vinculados à instalação; sem matriz granular de módulos neste serviço.
- src/main/services/license-gate.ts, backend-integrity.ts, python-backend.ts e audit-log.ts: preservar e estender, não substituir.
- src/main/config/config-store.ts e src/main/utils/atomic-json.ts: configurações/segredos e escrita atômica reutilizáveis.
- src/main/memory.ts: MemoryStore e retenção de 30 dias; não criar outra fonte canônica concorrente.
- src/shared/types/backend-protocol.ts e jasper-backend/protocol.py: contratos estritos e limite de quadro de 16 MiB; novas mensagens exigem validação dos dois lados.
- src/renderer/index.html:tab-system e src/renderer/ui/settings-modal.ts: área existente para os cartões.
- package.json: docx/exceljs/systeminformation presentes. Dependência não comprova implementação de módulo.

## Ordem e dependências
1. 01 — fundação modular: registro, estado, permissões, ciclo de vida e painel.
2. 02 — orquestrador: planejar, executar, verificar, cancelar e registrar tarefas compostas.
3. 03/04/05/06 — controle do PC, lembretes, saúde e documentos.
4. 07/08/09/10 — e-mails, web, casa e webhooks (depois dos dois núcleos).
5. 11/12 — memória semântica e grafo, sem destruir memória atual.
6. 13 — briefings com scheduler e fontes autorizadas.
7. 14 — aceite integrado e release. Verificação de pacote também em cada fase, não só no fim.

Cada documento tem o mesmo prefixo deste arquivo, seguido do número/nome. Não executar módulos “em paralelo” antes de estabilizar os contratos dos núcleos.

## Decisões e gates

Atualização de continuidade em27/10/2026: usuário confirmou o reteste bem-sucedido do aviso visual de Lembretes e autorizou o próximo módulo. Saúde do PC implementado com validações locais e pacote atualizado; usuário escolheu painel30s e alertas configuráveis. [Evidências e aceite manual pendente](2026-10-27-pc-health-progress.md). Nenhum início automático de Documentos ou publicação.

Decisão posterior vigente: usuário rejeitou A e ordenou B. Catálogo estruturado A e guard retirados; cinco ferramentas originais/PowerShell livre restaurados, com melhores diagnósticos. [Estado atual do plano B](2026-10-27-computer-control-plan-b.md). Referências à entrega A abaixo são históricas, não instrução para restaurá-la.

Atualização de 27/10/2026: fase03 alternativa A autorizada e implementada, preservando PowerShell livre; [evidências e retomada](2026-10-27-computer-control-progress.md). Novas ferramentas estruturadas, protocolo de tarefas v2, plano aceito no Main e migração004 validados localmente. Provedor real permanece diferido; fases04–14 não iniciadas nesta entrega.

Atualização de execução em 26/10/2026: usuário autorizou 01 e depois avançou explicitamente ao 02 apesar da pendência HTTP 503. O1–O5 aprovados e núcleo do orquestrador implementado com validação local. Registro atual: [progresso 02](2026-10-26-orchestrator-progress.md). Aceite com objetivo composto por provedor real ainda pendente; não iniciar integrações futuras ou publicar automaticamente. As restrições de somente planejamento abaixo descrevem a rodada original e são superadas somente para as fases posteriormente autorizadas.
- T1 — SQLite integrado verificado e adotado no plano após autorização do usuário: node:sqlite no Electron Main, sem dependência nova. Probe local passou; validação de produção/empacotamento permanece pendente.
- D1 — RESOLVIDA: opção A, núcleo Python + governança Main, escolhida pelo usuário em 26/10/2026.
- D2 — DIREÇÃO APROVADA: SQLite local para tarefas/agendas; configurações e segredos permanecem no armazenamento atual. iCal aprovado como importação/exportação manual de arquivos .ics (opção 1), sem assinatura por URL nem sincronização automática. Driver, schema, migração, backup e regras de intercâmbio ainda não aprovados.
- D3 — RESOLVIDA PARA ESTA FASE: consentimento geral do Total Control sem confirmação por operação; manter run_powershell como está (opção 1), por enquanto. Não impor lista fechada de operações nem remover controles existentes. Preservar licença, módulos, escopos, validação, cancelamento e auditoria. Registrar risco de comandos destrutivos e rever a política se solicitado.
- D4 — DIREÇÃO RESOLVIDA: automações com aplicativo em funcionamento; preservar comportamento atual do X (fecha a janela e, no Windows, encerra ao fechar todas). Não adicionar bandeja/close-to-tray nesta fase. Minimizar normalmente mantém o processo aberto. Sem serviço/tarefa Windows independente. Startup e recuperação de ocorrências vencidas/suspensão ainda precisam de decisão.
- D5–D8: escolher ao detalhar cada integração; nenhuma biblioteca/serviço contratado por este roteiro.

## Global Constraints
Complemento aprovado de D4: ao reabrir/retomar, apresentar resumo dos lembretes atrasados, sem disparar todos individualmente, executar ações retroativas ou repetir tarefas interrompidas. Apresentação não altera automaticamente o estado dos lembretes. Recuperação deve evitar duplicatas e só registrar apresentação efetiva. Referências anteriores à decisão sobre recuperação ficam resolvidas por esta regra; startup com Windows continua separado.

Somente planejamento nesta rodada. Preservar dados, controles comerciais, APIs públicas e funcionalidades atuais. Não alterar .gitignore, caches, código, dependências ou arquivos anteriores. Não fazer commit/push. Não remover ferramentas sem aprovação. Conteúdo externo não concede permissão; segredos não chegam ao renderer/LLM/logs. Em toda execução, revalidar autoridade antes de produzir efeitos; resultado ambíguo não é sucesso nem autorização para repetir.

## Review Focus
- Callback de módulo desativado/licença revogada: bloquear commit de efeitos e devolução tardia (01/02).
- Crash após efeito remoto: registrar resultado desconhecido e reconciliar, não repetir envio (02/07/10).
- Cancelar thread Python não cancela trabalho nativo: teste de processo/worker e corrida (02/03).
- Troca de fuso, DST e concorrência: agenda não duplica nem perde confirmação de apresentação (04/13).
- Apagar fonte de memória: remover índice e relações derivadas sem apagar demais dados (11/12).

## Procedimento de detalhamento após decisões
- [x] Escolher D1: opção A.
- [x] Registrar escolhas de D2 (SQLite + .ics manual), D3 (Total Control + shell atual) e D4 (processo aberto, X preservado, resumo de lembretes atrasados).
- [x] Consolidar 01 e 02 para revisão: arquivos, assinaturas propostas, fluxos de mensagens, tarefas TDD e critérios de aceite.
- [ ] Aprovar desenho completo e propostas técnicas T1–T4 de 01 e O1–O5 de 02; escolher driver/validação/negociação antes de implementar. Não confundir sugestão de contrato com decisão do usuário.
- [ ] Apresentar planos para revisão; perguntar método nativo ou subagentes (não escolhido).
- [ ] Implementar somente após autorização explícita da fase, com teste vermelho → implementação mínima → teste verde → suíte completa → revisão.
- [ ] No fim de cada fase registrar arquivos, testes/saídas, dependências/justificativa, limitações, decisões e próximo gate.
- [ ] Perguntar ao usuário antes de escolher uma alternativa nova durante correção ou execução; não ampliar escopo.

## Validação prevista, não executada
Na rodada de consolidação, validar somente consistência documental, links locais e ausência de alterações em código. Comandos de teste abaixo pertencem à execução futura.

npm.cmd run verify; npm.cmd run test:python; npm.cmd run scan:secrets; npm.cmd run test:package; npm.cmd run verify:package e smoke:packaged quando houver ambiente/artefato apropriado. OAuth, serviços e VM Windows limpa precisam de configuração real; fixtures ajudam nos testes mas não comprovam integração real.

