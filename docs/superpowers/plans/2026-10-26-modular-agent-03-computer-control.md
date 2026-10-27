# Controle do computador — roteiro de implementação

> **Estado vigente:** A rejeitado pelo usuário; B implementado com as cinco ferramentas originais e PowerShell livre. [Plano B e evidências](2026-10-27-computer-control-plan-b.md). Atualizações A abaixo são históricas.

> Atualização 27/10/2026: alternativa A autorizada e implementada com validação local. [Desenho](../specs/2026-10-27-computer-control-design.md), [plano detalhado](2026-10-27-computer-control-implementation.md) e [progresso/evidências](2026-10-27-computer-control-progress.md). Este roteiro é histórico; o caminho modules/computer.py e o status preliminar abaixo foram substituídos pelo plano detalhado. Aceite com provedor real continua diferido.

> **For agentic workers:** REQUIRED SUB-SKILL após aprovação: superpowers:executing-plans ou superpowers:subagent-driven-development. Não iniciar código a partir deste rascunho.

**Goal:** Entregar o módulo 01 da proposta: Controle do computador.
**Architecture:** Capacidade registrada no núcleo; executor e persistência a confirmar após D1/D2.
**Tech Stack:** Reutilizar stack atual; nenhuma dependência nova aprovada.
**Spec:** [Desenho preliminar](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** BLOQUEADO PARA IMPLEMENTAÇÃO — escopo preliminar.
**Depends on:** 01 + 02.

## Global Constraints
Aplicam-se todas as restrições e o procedimento TDD do [roadmap](2026-10-26-modular-agent-00-roadmap.md). Configuração por Sistema & Automação, persistência do switch, permissões verificadas na execução, dados preservados ao desligar e nenhuma nova tarefa automática após desativação.

## Arquivos e reuso a confirmar
- Reutilizar: jasper-backend/tools_os.py; jasper-backend/live_tools.py.
- Caminho proposto: `jasper-backend/modules/computer.py` (não criado; responsabilidade/contrato final dependem das decisões).
- Testes propostos: `jasper-backend/tests/test_computer_module.py`.
- Interfaces: consumir registro/estado/política de 01 e execução/resultados de 02; contratos exatos serão definidos somente após aprovação dos núcleos.

## Escopo funcional
Abrir e localizar aplicativos; abrir arquivos/pastas; organizar arquivos autorizados; consultar processos; automação desktop em sequência.

## Decisão a perguntar antes de detalhar
D3 escolhida: manter o PowerShell atual sob consentimento geral, sem confirmação por operação e sem lista fechada de ações tipadas nesta fase. Preservar controles atuais, integrar o shell ao bloqueio do módulo/licença e não tratar conteúdo externo como autorização. A decisão é temporária/revisável. Novas alternativas de automação deverão ser apresentadas antes de implementar.

## Review Focus e testes de aceite
Parâmetros inválidos; caminho fora do escopo; app ausente; reparse point; cancelamento de árvore; ação sem permissão; verificação do resultado sem confundir processo aberto com objetivo concluído.

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

