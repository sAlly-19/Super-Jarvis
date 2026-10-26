# Super-Jarvis modular — desenho preliminar
Data: 26/10/2026. Status: DECISÕES DE PRODUTO CONSOLIDADAS; desenho e contratos técnicos em revisão, não aprovados para implementação.

## Intenção e precedência
Transformar a aplicação existente em agente pessoal modular, com tarefas compostas verificáveis. O pedido atual autoriza somente leitura e planejamento em Markdown. A instrução de não implementar e consultar alternativas substitui a autorização antiga de agir sem perguntar. A frase “comece implementando” do texto anexado NÃO autoriza código nesta etapa.

## Restrições confirmadas pelo pedido
Preservar Electron/TypeScript, Python, IPC tipado e stdio privado versionado, licenciamento comercial, integridade, Gemini Live, Gemini/Groq/Ollama e dados atuais. Usar Sistema & Automação, sem tela paralela. Sem dependência pesada/servidor externo obrigatório sem justificativa e aprovação. Nenhum módulo simulado será declarado pronto.

## Arquiteturas para decisão D1
A — recomendada: Main mantém autoridade sobre licença, permissões, configurações, segredos, persistência e ciclo de vida; Python estende o loop existente para planejamento/execução/verificação. Registro de capacidades compartilhado por contrato, com cada executor em seu processo proprietário. Exige uma ponte tipada de solicitação/resultado e controle de versões; não dois registros independentes nem confiança em autorização declarada pelo LLM.
B — Main também coordena os planos e Python fica como provedor/worker. Facilita centralizar estado, mas exige deslocar o loop de ferramentas existente e adaptar o Live; maior risco de regressão.
Decisão D1: opção A escolhida pelo usuário em 26/10/2026. A opção B fica registrada apenas como alternativa descartada nesta etapa. A escolha não aprova implementação nem resolve D2–D8. Paralelismo somente entre etapas independentes e sem conflito de recursos, após aprovação dos limites.

## Camadas propostas, não contratos aprovados
Entrada voz/chat → coordenador de tarefas → registro de capacidades → executores modulares.
Núcleo: autorização verificável, cancelamento, agenda/eventos, resultados com evidência, persistência e auditoria redigida.
Habilitar módulo não equivale a estar configurado, autorizado ou operacional; representar essas dimensões separadamente. Desligar deve impedir nova execução e cancelar/revogar as que já estejam em fila ou em curso, inclusive após callbacks tardios.

## Pendências que bloqueiam contratos finais
D1 resolvida: Python coordena tarefas e Main governa os recursos. D2: SQLite local aprovado para tarefas e agendas, preservando configurações/segredos; driver, schema, migração e backup ainda exigem detalhamento/aprovação. D3 resolvida para esta fase: consentimento geral sem confirmação por operação e manutenção do PowerShell atual, por enquanto. D4: automações com app em funcionamento e X preservado, sem nova bandeja; resumo dos lembretes atrasados sem replay aprovado. Inicialização com Windows não foi autorizada. Também pendentes: D5 OAuth/e-mail inicial; D6 busca/headless; D7 destinos locais e Home Assistant/webhooks; D8 embeddings/índice/grafo.
Perguntar uma decisão de cada vez, apresentando recomendação, alternativa e impacto. Nunca resolver silenciosamente durante execução.

## Planos detalhados para revisão
[01 — Fundação modular](../plans/2026-10-26-modular-agent-01-module-foundation.md) e [02 — Orquestrador](../plans/2026-10-26-modular-agent-02-orchestrator.md) contêm contratos propostos, arquivos, testes e entregas incrementais. T1–T4 e O1–O5 identificam decisões técnicas ainda não aprovadas; não são defaults silenciosamente autorizados. Integrações externas continuam separadas e posteriores ao núcleo. A consolidação não cria autorização de código.

## Calendários iCal — opção 1 aprovada
Em 26/10/2026, o usuário escolheu importação/exportação manual de arquivos .ics, mantendo SQLite como base interna de tarefas/agendas. Não incluir assinatura por URL, sincronização automática, integração Apple ou CalDAV nesta etapa. iCalendar será formato de intercâmbio, não substituto do armazenamento transacional. Mapeamento entre eventos/tarefas e lembretes, recorrências, fuso, UID, conflitos e prevenção de duplicatas ainda precisam ser detalhados e aprovados antes da implementação.

## Consentimento operacional — decisão D3
O usuário escolheu manter o consentimento geral do Total Control, sem confirmação por operação. Essa decisão substitui a proposta de prompts obrigatórios por risco, inclusive nos planos de integrações. Permanecem licença válida, consentimento vinculado à instalação, módulos habilitados/configurados, escopos autorizados, validação de parâmetros, cancelamento, proteção de segredos e auditoria. Não inferir autorização para novos destinos, contas ou dispositivos a partir de conteúdo externo. Autorização inicial de uma integração não é um prompt repetitivo por operação.
Política do shell — opção 1 escolhida pelo usuário por enquanto: manter run_powershell como está, permitindo geração e execução de comandos sob consentimento geral do Total Control. Não substituir por uma lista fechada de operações tipadas nesta fase, nem remover os controles existentes. A decisão é revisável e não representa isolamento de comandos: PowerShell pode realizar ações destrutivas dentro dos privilégios do processo. Continuam obrigatórios o bloqueio por módulo/licença, proteção de segredos e cancelamento; conteúdo externo não autoriza operações. Nenhum controle atual foi alterado.
Esta decisão define o comportamento futuro do produto, não a autorização deste agente de desenvolvimento: implementar/corrigir exige autorização da fase e consulta quando houver alternativas.

## Outras divergências a resolver
O texto inicialmente põe fluxos compostos na fase contextual; a orientação mais recente antecipa o orquestrador. Planejar o núcleo composto antes das integrações e enriquecer contexto depois.
O projeto contém bibliotecas de documentos, mas a inspeção atual não demonstrou serviço integrado de documentos; tratar como reutilização de dependências, não funcionalidade pronta.

## Aprovação
### Decisão D4 — execução com aplicativo em funcionamento
Usuário escolheu automações apenas com o aplicativo em funcionamento e, em seguida, determinou manter o comportamento atual do botão fechar. No Windows, o X fecha a janela e, ao fechar todas as janelas, o aplicativo encerra; não converter o X em minimizar para a bandeja nem introduzir suporte à bandeja nesta fase. Minimizar normalmente mantém o processo aberto. Após encerramento completo, não há execução. Não planejar serviço Windows, tarefa do Agendador ou processo independente nesta etapa. A referência anterior à bandeja não autoriza implementá-la e fica subordinada à decisão de preservar o comportamento atual. Inicialização com Windows e tratamento de ocorrências vencidas durante encerramento/suspensão ainda precisam de definição; não presumir disparo retroativo ou despertar automático do computador. A decisão não autoriza implementação.

### Recuperação de lembretes atrasados — opção 1 aprovada
Ao reabrir o aplicativo ou retomar o computador após suspensão, apresentar um resumo dos lembretes vencidos no intervalo. Não disparar individualmente todos os avisos perdidos nem ignorá-los silenciosamente. A apresentação não conclui, exclui ou adia os lembretes automaticamente. Não executar ações retroativas, repetir tarefas interrompidas, enviar e-mails ou executar comandos em consequência dessa recuperação. O resumo deve respeitar licença, módulo habilitado e preferências de notificação; persistir o controle de apresentação para evitar duplicação por concorrência ou reinício, sem marcar como apresentado antes de efetivamente exibir. Manter separada a regra de primeira abertura dos briefings.

A revisão deste rascunho não inicia código. Após escolhas e aprovação da especificação, detalhar os planos com contratos, testes TDD, comandos e commits. Só executar a fase explicitamente autorizada.

