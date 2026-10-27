# Lembretes05 — aceite integrado e pacote

**Estado27/10/2026:** validações locais aprovadas (verify265, Python84, artefato10, integridade, smoke comercial bloqueado e harness de recursos/UI). Pacote reconstruído após correção visual e checks afetados repetidos. **Aceite operacional comercial licenciado/X/restart ainda pendente; não marcar módulo como integralmente aceito.** [Evidência e handoff](2026-10-27-reminders-progress.md). Checklists abaixo preservam o roteiro original; o progresso registra exatamente o que foi demonstrado. Sem commit/push.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, verification-before-completion e requesting-code-review após autorização. Depende de01–04; não mudar método nativo/main nem fazer commit/push automaticamente.

**Goal:** Demonstrar lembretes compostos, retomada e .ics no produto empacotado sem consumir API real.

**Architecture:** Fixtures determinísticas usam os executores/store reais. Perfil Electron isolado e banco temporário comprovam a integração; resultado simulado de provedor não é apresentado como aceite por modelo real.

**Tech Stack:** ferramentas atuais de testes, build e Electron, com artefatos produzidos nas entregas anteriores.

**Spec:** [Desenho](../specs/2026-10-27-reminders-design-draft.md); [contratos00](2026-10-27-reminders-00-execution-map.md).

## Global Constraints

Todas as restrições00. Não usar calendário pessoal, chaves, áudio, screenshots reais do usuário ou notificações no perfil dele. Não restaurar A, alterar modelo/retries, publicar ou implementar próxima fase. Assinatura/VM limpa continuam gates separados.

## Review Focus

Worker/biblioteca ausentes do ASAR; ferramentas anunciadas mas indisponíveis no Main; shutdown com callback SQLite aberto; resumo duplicado após restart; respostas voltando a ser genéricas ou sucesso inventado. Cobrir esses cinco casos e revisar o diff final.

### Tarefa1 — Integração ponta a ponta

**Arquivos:** criar `test/reminders-stdio.test.ts`, `test/reminders-lifecycle.test.ts`, `test-artifact/reminders.test.ts`, `scripts/test-reminders-ui.cjs`; estender `test/fixtures/module-sidecar.py` apenas como provedor/worker de teste. Não adicionar flags de fixture ao produto.

**Interfaces:** usar serviços/clock/store reais dos planos01–04. Provedor determinístico retorna plano create→get com binding do ID comprovado; mutação única apesar de retry/ack perdido. Segunda fixture lista→edita por revisão→get e .ics importa→lista, sem tools_os executar lembretes.

- [ ] Criar testes RED para criação verificada com título/data/fuso observados e resposta contextual específica; evento do broker mostra execução Main e zero capability_execute no sidecar para reminders. Computer continua com cinco capacidades e scripts livres.
- [ ] Exercitar disable/revoke com tick pendente e alternância de módulos independente; reabrir arquivo SQLite e recuperar o mesmo resumo sem executar avisos antigos; completar/adiar uma instância não apaga série. Repetir ack perdido não repete mutação/efeito.
- [ ] No Electron de teste com userData isolado, montar a tela, importar/exportar fixture por diálogo fake controlado, renderizar resumo e confirmar ack após exibição. Capturar screenshot só dessa janela. Toast real, se necessário, usa título sintético e notifier de teste isolado; não notificar perfil real do usuário.
- [ ] Rodar `npm.cmd test -- reminders` e `npm.cmd run test:python`; esperar zero falhas. Novo verificador/reminder diagnóstico não pode alterar os testes de unknown de computer ou cancelamento Live.

### Tarefa2 — Pacote, revisão e handoff

**Arquivos:** testes de artefato acima; `scripts/verify-package.mjs` e `scripts/smoke-packaged.ps1` apenas para verificar recursos novos; atualizar progresso e os planos/documentos de retomada.

- [ ] Rodar sequencialmente `npm.cmd run verify`, `npm.cmd run test:python`, `npm.cmd run package:dir`, `npm.cmd run test:package`, `npm.cmd run verify:package`, `npm.cmd run smoke:packaged`. Esperado: exits0, zero falhas, migração005/worker/licença/biblioteca encontrados e integridade consistente. Guardar logs no workspace próprio desta fase.
- [ ] Executar `node scripts/test-reminders-ui.cjs` no pacote final com perfil temporário e PATH sanitizado; provar startup sem Python global para funções Main, encerramento pelo X e dados recuperáveis no próximo startup. Não usar um build anterior às últimas correções como prova final.
- [ ] Reabrir banco v4 sintético com pacote novo, verificar upgrade005/backup e histórico preservado. Não carregar banco real para demonstrar migração. Conferir que nenhum título/descrição foi gravado em task_events/audit logs; ficam apenas no banco do domínio e resposta volátil autorizada.
- [ ] Aplicar revisão independente final prevista pela skill; corrigir Critical/Important com RED→GREEN e regressões relevantes. Documentar Minor diferidos e limites de entrega/interop. Se código mudar após pacote, reconstruir e repetir checks afetados; não ampliar testes sem mudança/risco novo.
- [ ] Rodar scanner de segredos incluindo novos não ignorados e `git diff --check`; confirmar somente alterações autorizadas. Atualizar [progresso](2026-10-27-reminders-progress.md), apontar próximo módulo apenas como sugestão e encerrar sem commit/push.

## Contrato de conclusão

Lembretes só podem ser anunciados como entregues quando CRUD, prova Main, switch/licença, recorrência/fuso, resumo, .ics, cancelamento e artefato final tiverem evidências locais. Declarar separadamente o que não foi coberto: IA real adiada, leitura efetiva do toast não garantida, janela de crash antes do ack admite reapresentação do resumo, interoperabilidade limitada ao subset testado, assinatura/VM limpa fora deste aceite local.
