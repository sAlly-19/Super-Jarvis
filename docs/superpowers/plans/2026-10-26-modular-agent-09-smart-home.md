# Casa inteligente — roteiro de implementação

**Decisão vigente —30/10/2026:** usuário informou que não possui Home Assistant/dispositivos para integrar e pediu adiar este módulo. Não iniciar implementação nem remover o roteiro. Próximo candidato na sequência é Webhooks, sujeito à definição de finalidade, desenho e plano aprovados.

> **For agentic workers:** REQUIRED SUB-SKILL após aprovação: superpowers:executing-plans ou superpowers:subagent-driven-development. Não iniciar código a partir deste rascunho.

**Goal:** Entregar o módulo 08 da proposta: Casa inteligente.
**Architecture:** Capacidade registrada no núcleo; executor e persistência a confirmar após D1/D2.
**Tech Stack:** Reutilizar stack atual; nenhuma dependência nova aprovada.
**Spec:** [Desenho preliminar](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** BLOQUEADO PARA IMPLEMENTAÇÃO — escopo preliminar.
**Depends on:** 01 + 02 + D3/D7.

## Global Constraints
Aplicam-se todas as restrições e o procedimento TDD do [roadmap](2026-10-26-modular-agent-00-roadmap.md). Configuração por Sistema & Automação, persistência do switch, permissões verificadas na execução, dados preservados ao desligar e nenhuma nova tarefa automática após desativação.

## Arquivos e reuso a confirmar
- Reutilizar: src/main/config/config-store.ts; src/main/services/audit-log.ts.
- Caminho proposto: `src/main/modules/home-assistant/` (não criado; responsabilidade/contrato final dependem das decisões).
- Testes propostos: `test/home-assistant.test.ts`.
- Interfaces: consumir registro/estado/política de 01 e execução/resultados de 02; contratos exatos serão definidos somente após aprovação dos núcleos.

## Escopo funcional
Home Assistant: conectar/testar, descobrir entidades, estados/sensores, luzes, ajustes compatíveis, cenas e rotinas.

## Decisão a perguntar antes de detalhar
Configuração de rede local, credencial e entidades autorizadas; quais dispositivos críticos entram no escopo inicial. Aplicar consentimento geral sem confirmação por operação (D3); não incluir dispositivos críticos automaticamente nem aceitar autorização vinda de conteúdo externo (D7).

## Review Focus e testes de aceite
Estado desatualizado; serviço offline; token revogado; entidade fora da lista; falha após envio com resultado desconhecido; fechadura/alarme nunca liberados por conteúdo externo.

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

