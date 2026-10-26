# Grafo de conhecimento — roteiro de implementação

> **For agentic workers:** REQUIRED SUB-SKILL após aprovação: superpowers:executing-plans ou superpowers:subagent-driven-development. Não iniciar código a partir deste rascunho.

**Goal:** Entregar o módulo 10 da proposta: Grafo de conhecimento.
**Architecture:** Capacidade registrada no núcleo; executor e persistência a confirmar após D1/D2.
**Tech Stack:** Reutilizar stack atual; nenhuma dependência nova aprovada.
**Spec:** [Desenho preliminar](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** BLOQUEADO PARA IMPLEMENTAÇÃO — escopo preliminar.
**Depends on:** 11 + 01 + 02.

## Global Constraints
Aplicam-se todas as restrições e o procedimento TDD do [roadmap](2026-10-26-modular-agent-00-roadmap.md). Configuração por Sistema & Automação, persistência do switch, permissões verificadas na execução, dados preservados ao desligar e nenhuma nova tarefa automática após desativação.

## Arquivos e reuso a confirmar
- Reutilizar: src/main/memory.ts; plano 11-semantic-memory.
- Caminho proposto: `src/main/memory/knowledge-graph.ts` (não criado; responsabilidade/contrato final dependem das decisões).
- Testes propostos: `test/knowledge-graph.test.ts`.
- Interfaces: consumir registro/estado/política de 01 e execução/resultados de 02; contratos exatos serão definidos somente após aprovação dos núcleos.

## Escopo funcional
Entidades pessoas/projetos/documentos/eventos/tarefas/organizações, relações tipadas, proveniência e confiança; consulta contextual e edição/exclusão.

## Decisão a perguntar antes de detalhar
Tabelas relacionais/adjacência versus biblioteca de grafo; regras de resolução de entidades (D2/D8). Não adotar servidor externo obrigatório.

## Review Focus e testes de aceite
Homônimos não unidos sem evidência; relação inferida identificada; fonte apagada remove derivados; deduplicação idempotente; correção preserva rastreabilidade sem reter dado excluído.

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

