# Lembretes — roteiro de implementação

> **For agentic workers:** REQUIRED SUB-SKILL após aprovação: superpowers:executing-plans ou superpowers:subagent-driven-development. Não iniciar código a partir deste rascunho.

**Goal:** Entregar o módulo 02 da proposta: Lembretes.
**Architecture:** Opção A; SQLite local aprovado para tarefas/agendas, sob governança Main. iCal aprovado como importação/exportação manual de arquivos .ics, sem assinatura por URL nem sincronização automática.
**Tech Stack:** Reutilizar stack atual; nenhuma dependência nova aprovada.
**Spec:** [Desenho preliminar](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** BLOQUEADO PARA IMPLEMENTAÇÃO — escopo preliminar.
**Depends on:** 01 + 02 + detalhamento do scheduler. D4: execução apenas com o processo do app em funcionamento; preservar X e minimização atuais, sem nova bandeja.

## Global Constraints
Aplicam-se todas as restrições e o procedimento TDD do [roadmap](2026-10-26-modular-agent-00-roadmap.md). Configuração por Sistema & Automação, persistência do switch, permissões verificadas na execução, dados preservados ao desligar e nenhuma nova tarefa automática após desativação.

## Arquivos e reuso a confirmar
- Reutilizar: src/main/utils/atomic-json.ts; src/main/ipc/register-ipc.ts.
- Caminho proposto: `src/main/modules/reminders.ts` (não criado; responsabilidade/contrato final dependem das decisões).
- Testes propostos: `test/reminders.test.ts`.
- Interfaces: consumir registro/estado/política de 01 e execução/resultados de 02; contratos exatos serão definidos somente após aprovação dos núcleos.

## Escopo funcional
Criar, listar, consultar, editar título/descrição/data/hora, excluir individual/lote, concluir, adiar, recorrência diária/semanal/mensal, vencidos/futuros e notificações locais. Importar/exportar manualmente arquivos .ics, sem sincronização automática.

## Decisão a perguntar antes de detalhar
SQLite local e importação/exportação manual .ics já escolhidos. Definir mapeamento entre eventos/tarefas e lembretes, recorrências, fuso, UID, conflitos e duplicatas antes de implementar. D4 escolhida: executar apenas com processo aberto; X preservado e sem nova bandeja. Recuperação escolhida: resumo dos lembretes atrasados, sem replay de ações. Não prometer execução com app encerrado nem sincronização bidirecional apenas com arquivos .ics.

## Review Focus e testes de aceite
Aplicar D4: encerramento completo interrompe agenda; não introduzir serviço Windows nem bandeja/close-to-tray nesta fase. Testar minimização normal, encerramento pela janela e resumo de ocorrências vencidas na reabertura/retomada, sem executar ações retroativas.

Datas relativas com contexto de fuso; mês sem dia 31; horário inexistente/duplicado; reinício; dois disparadores simultâneos; recorrência sem duplicata; módulo desativado não notifica. Para .ics: arquivo malformado ou excessivo, UID repetido, reimportação, evento de dia inteiro, fuso e exceções de recorrência; validar exportação com releitura e informar dados não suportados sem perda silenciosa.

## Entregas separáveis
- [ ] Apresentar alternativas e obter decisão; pesquisar API oficial vigente ao detalhar integração externa.
- [ ] Especificar ferramentas com entradas/saídas, permissões, efeitos, timeout, cancelamento e verificações observáveis.
- [ ] Escrever teste vermelho para cada comportamento citado acima; fixar limites e mensagens no plano executivo.
- [ ] Implementar capacidade real e configuração/diagnóstico na tela existente; passar testes e regressões de chat/Live.
- [ ] Testar desligamento durante execução, reinício, licença revogada, configuração incompleta e falha parcial; sem expor segredo ou dado pessoal em auditoria.
- [ ] Demonstrar fluxo composto pelo orquestrador com evidência; testar aplicativo Windows empacotado.
- [ ] Registrar dependências, resultados reais e limitações; solicitar autorização antes de avançar para outra fase.

## Critério de conclusão
Recuperação aprovada (opção 1): mostrar resumo dos lembretes atrasados ao reabrir/retomar, sem executar ações retroativas nem repetir tarefas interrompidas. Exibir não equivale a concluir/adiar/excluir. Testar concorrência, reinício e falha antes da apresentação para evitar duplicação ou perda do resumo; respeitar licença, módulo e preferências de notificação. Essa decisão resolve as perguntas anteriores deste roteiro sobre descarte versus execução retroativa.

Não basta ferramenta funcionar isoladamente: switch persistente, configuração segura, estado operacional verdadeiro, descoberta pelo orquestrador, validação de permissão, cancelamento e artefato empacotado devem ser comprovados. Conta/serviço ainda não configurado é pendência, nunca sucesso simulado.

