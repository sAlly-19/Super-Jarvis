# E-mails05 — aceite integrado e preparação comercial

**Estado29/10/2026:** tarefas locais1–2 concluídas no escopo ajustado pelo usuário (downloads adiados), com revisão independente/fixpass e375 testes TS+89 Python aprovados. Task3 continua externa/pendente. Consulte `2026-10-28-email-progress.md` para evidências, limite de crash simulado e ambiente Node26 fora da engine24. Nenhum pacote comercial, login ou envio real foi validado.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans e verification-before-completion. Aprovação dos planos não autoriza envio a contas reais ou publicação externa.

**Goal:** comprovar integração determinística e registrar separadamente aceite real/gates de distribuição.
**Architecture:** serviços Main reais e orquestrador Python com provedores sintéticos; nenhuma licença burlada.
**Tech Stack:** suites TS/Python, Electron Chromium, SDKs com transportes fake.
**Spec:** [desenho](../specs/2026-10-28-email-design.md); [mapa00](2026-10-28-email-00-execution-map.md). Depende de04.

## Global Constraints

Sem executável por rotina, conta real, token do usuário, endereço pessoal de teste ou API de modelo nesta etapa automática. Arquivos temporários/dados sintéticos. Teste de perfil licenciado e aprovação comercial são evidências separadas; fixtures nunca provam uma conta real conectada.

## Review Focus

Resposta parcial que vira sucesso, rede perdida após POST, reinício com intenção pendente, shutdown durante refresh e e-mail com prompt injection atravessando dois módulos devem ter prova explícita. Tasks1–2 cobrem esses caminhos; Task3 não simula aceite externo.

### Task1: cenários compostos e fronteiras reais

**Files:** criar `test/email-stdio.test.ts`, `test/email-lifecycle.test.ts`, `test/fixtures/email/fake-provider.ts`, `test/fixtures/email/acceptance-host.ts`, `test/fixtures/email/acceptance-ui.ts`, `scripts/test-email-ui.cjs`; modificar `test/fixtures/module-sidecar.py` só com flags sintéticas de teste, nunca bypass no produto.

**Interfaces:** harness usa EmailService/TaskService/bridge e SDK real com transporte fake; fixtures locais têm contas fake distintas e mesmo messageId para provar isolamento. APIs fake registram contador de POST, arquivo real temporário, IDs e respostas, nunca conectam Google/Microsoft.

- [ ] **1 RED:** fluxo buscar em duas contas→ler origem→responder usa conta original e uma tentativa de send; resposta externa de texto pede enviar arquivo privado mas não cria ticket/efeito. Segundo fluxo buscar mensagem→criar lembrete somente para pedido que explicitamente exige ambos, e desativar Lembretes impede fallback oculto. Terceiro fluxo Graph202 retorna accepted e síntese precisa, sem alegar delivery. Crash entre send e receipt retorna unknown ao reabrir e contador permanece1.
- [ ] **2 Verificar RED:** `npm.cmd test -- email-stdio`; esperado FAIL para cenário não coberto, não erro de Python errado. Se runtime já satisfizer o cenário, registrar cobertura GREEN sem inventar falha; não modificar produto para fabricar RED de teste de aceite.
- [ ] **3 Completar harness:** Python fixture usa determinismo, Main real verifica provas; nenhum capability_execute email vai ao sidecar. Capture somente painel sintético em perfil temporário; artefato declara commercialRuntimeUnlocked:false. Rede de fixture restrita a loopback do teste. Separar configuração/sessão de teste da política real.
- [ ] **4 GREEN:** `npm.cmd test -- email-stdio`, `npm.cmd test -- email-lifecycle`, `node scripts/test-email-ui.cjs`; esperado PASS, shutdown sem listeners/requests pendentes, screenshot legível e sem segredos. Executar harnesses gráficos sequencialmente para evitar interferência conhecida.

### Task2: regressão e auditoria da entrega

**Files:** atualizar `docs/superpowers/plans/2026-10-28-email-progress.md`, `README.md`; criar `docs/email-provider-setup.md` e relatório local no workspace desta fase.

- [ ] **1 Rodar verificações:** `npm.cmd run verify`; esperado typecheck+testes+build exit0. `npm.cmd run test:python`; esperado suite completa sem falhas. `npm.cmd run audit:runtime`; esperado nenhuma vulnerabilidade de produção impeditiva, sem audit fix. `node scripts/scan-secrets.mjs --include-untracked`; esperado zero achados. `git -c core.safecrlf=false diff --check`; esperado sem whitespace. Registrar contagens realmente vistas, versões Node/Python e avisos; não copiar contagens antigas.
- [ ] **2 Confirmar prova de SDK:** conferir logs dos testes03 com uma tentativa por leg em429/503/reset, sem retry autenticado escondido; inspecionar store após restart e vault cifrado. Nenhuma dependência foi instalada com versão diferente sem ruling/revisão.
- [ ] **3 Revisão final:** executing-plans exige revisão independente da entrega completa; fornecer spec/planos/diff e foco de segurança sem dados reais. Corrigir Critical/Important com reprodução RED→GREEN e checks afetados. Minor fica registrado. Não alegar segunda revisão se não ocorreu.
- [ ] **4 Handoff documental:** README/setup explicam conexão, conta padrão, resposta original, pesquisa parcial, limites menores de Graph/anexos, arquivo selecionado na UI, aceitação versus entrega, unknown sem replay e desconexão local versus revogação remota. Marcar código validado localmente separado dos itens ainda externos.

### Task3: gates externos e teste real combinado

**Files:** somente `docs/email-provider-setup.md` e progresso até haver autorização adicional. Não criar projeto externo nem modificar contas para preencher checklist.

- [ ] **1 Preparar checklist do publicador:** Google projeto/Gmail API/cliente desktop/consentimento/escopos/verificação e política de uso de dados com IA; Microsoft registro público multitenant+pessoal, redirect compatível, permissões delegadas e política de consentimento organizacional. Configuração sem material real continua not_configured. Não embutir segredo confidencial em build desktop.
- [ ] **2 Combinar teste operacional:** solicitar contas e destinatários de teste e escopo exato quando o usuário quiser validar conexão/envio real. Não reutilizar chaves/licença/contas citadas em outras tarefas como autorização de e-mail. Desenvolvimento npm run dev pode comprovar OAuth e requests reais; não gerar executável só por hábito.
- [ ] **3 Executar somente se autorizado:** conectar ao menos Gmail+Outlook, definir padrão, busca entre contas, responder na conta original, anexos permitidos, desconectar/reconectar, revogar durante tarefa e reiniciar sem replay. Registrar só resultado/contagem/IDs opacos, sem conteúdo pessoal. Falha de cadastro/admin/quota é pendência, não sucesso simulado.
- [ ] **4 Artefato apenas quando necessário:** se o comportamento de callback/identidade/pacote não puder ser validado em dev, explicar necessidade concreta e usar perfil de teste. Então incluir recursos config/migração/licenças e testes de ASAR. Assinatura/VM limpa permanecem release final. Caso contrário, marcar testes de pacote como adiados por orientação do usuário, não aprovados.

## Critério de conclusão

Entrega local concluída somente com tarefas1–2 aprovadas e limitação externa clara. Aceite comercial completo requer Task3 na extensão autorizada, cadastros adequados e testes reais de ambos; não chamar integração plenamente pronta para venda se esses gates faltam. Não avançar automaticamente para Pesquisa Web ou Documentos.
