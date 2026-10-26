# Briefings proativos — roteiro de implementação

> **For agentic workers:** REQUIRED SUB-SKILL após aprovação: superpowers:executing-plans ou superpowers:subagent-driven-development. Não iniciar código a partir deste rascunho.

**Goal:** Entregar o módulo 05 da proposta: Briefings proativos.
**Architecture:** Capacidade registrada no núcleo; executor e persistência a confirmar após D1/D2.
**Tech Stack:** Reutilizar stack atual; nenhuma dependência nova aprovada.
**Spec:** [Desenho preliminar](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** BLOQUEADO PARA IMPLEMENTAÇÃO — escopo preliminar.
**Depends on:** 01 + 02 + scheduler + fontes habilitadas.

## Global Constraints
Aplicam-se todas as restrições e o procedimento TDD do [roadmap](2026-10-26-modular-agent-00-roadmap.md). Configuração por Sistema & Automação, persistência do switch, permissões verificadas na execução, dados preservados ao desligar e nenhuma nova tarefa automática após desativação.

## Arquivos e reuso a confirmar
- Reutilizar: src/main/index.ts; src/main/memory.ts; src/renderer/main.ts.
- Caminho proposto: `src/main/modules/briefings.ts` (não criado; responsabilidade/contrato final dependem das decisões).
- Testes propostos: `test/briefings-module.test.ts`.
- Interfaces: consumir registro/estado/política de 01 e execução/resultados de 02; contratos exatos serão definidos somente após aprovação dos núcleos.

## Escopo funcional
Primeira abertura elegível do dia/período, manhã 06:00–11:59 e noite 18:00–23:59 configuráveis; manual, interface e voz opcional; integrar apenas fontes disponíveis.

## Decisão a perguntar antes de detalhar
D4 já escolhida: proatividade apenas com o processo do app aberto, sem serviço/tarefa Windows independente nem nova bandeja; preservar o X atual. Recuperação de lembretes será resumo sem replay, separada dos briefings. Perguntar sobre apresentação silenciosa versus narração e fontes iniciais. Preservar a regra de primeira abertura elegível; não converter cada retomada em novo briefing.

## Review Focus e testes de aceite
Reserva concorrente sem duplicar; só concluir após confirmação de apresentação; crash entre reserva/apresentação; fuso/DST e troca de data; não bloquear boot; módulos desligados não consultados; período perdido com regra explícita.

## Entregas separáveis
- [ ] Apresentar alternativas e obter decisão; pesquisar API oficial vigente ao detalhar integração externa.
- [ ] Especificar ferramentas com entradas/saídas, permissões, efeitos, timeout, cancelamento e verificações observáveis.
- [ ] Escrever teste vermelho para cada comportamento citado acima; fixar limites e mensagens no plano executivo.
- [ ] Implementar capacidade real e configuração/diagnóstico na tela existente; passar testes e regressões de chat/Live.
- [ ] Testar desligamento durante execução, reinício, licença revogada, configuração incompleta e falha parcial; sem expor segredo ou dado pessoal em auditoria.
- [ ] Demonstrar fluxo composto pelo orquestrador com evidência; testar aplicativo Windows empacotado.
- [ ] Registrar dependências, resultados reais e limitações; solicitar autorização antes de avançar para outra fase.

## Critério de conclusão
Não basta ferramenta funcionar isoladamente: switch persistente, configuração segura, estado operacional verdadeiro, descoberta pelo orquestrador, validação de permissão, cancelamento e artefato empacotado devem ser comprovados. Conta/serviço ainda não configurado é pendência, nunca sucesso simulado.

