# Jasper — execução direta de ferramentas no chat e na voz

**Data:** 29/10/2026. **Estado:** aprovado pelo usuário e implementado com validação local. [Plano e evidências](../plans/2026-10-29-direct-agent-execution.md).

## Objetivo e autorização

O usuário prefere retirar o orquestrador do fluxo das conversas por excesso de esclarecimentos e rigidez. Aprovou a substituição para chat e voz e posteriormente autorizou explicitamente codificar, preservando controles de acesso e a implementação histórica. O exemplo composto discutido não foi incluído como cenário específico, por solicitação do usuário.

## Situação verificada

- `jasper-backend/runtime.py`: o chat envia histórico ao modelo, mas, quando recebe tool calls e há sessão de tarefas, descarta esse caminho direto e chama Planner com somente o texto atual. Depois usa compose_task_response.
- `orchestration/planner.py`: impõe plano JSON, até oito etapas, pergunta quando considera a intenção ambígua e não recebe histórico da conversa.
- `runtime.py:live_task_tools/invoke_live_task`: anuncia execute_task e envolve chamadas individuais Live em tarefas de uma etapa.
- `module_bridge.py:ModuleBridge.invoke(capability_id, args, task=None)`: já aceita chamada sem tarefa, mediada pelo Main. É o ponto de reutilização, não acesso direto do renderer ao sidecar ou aos provedores.
- `src/main/modules/runtime-bridge.ts` e `execution-broker.ts`: fronteira existente de despacho; preservar controles e conferir equivalência das provas sem contexto de tarefa.

## Desenho proposto

### Chat

Usar as tool calls que o modelo já produziu. Acrescentar a mensagem do assistente e os resultados correspondentes à conversa da rodada e consultar novamente o mesmo modelo. Chamadas de ferramentas sequenciais, inclusive quando o modelo devolver várias na mesma resposta; nenhuma execução paralela nova. Não chamar Planner, Executor de planos ou compositor adicional como etapa obrigatória.

Preservar o limite existente de cinco rodadas de ferramentas do chat e os timeouts por ferramenta. Ao esgotar o limite, sintetizar somente observações disponíveis, sem ferramentas e sem assumir sucesso. Não aumentar limites nesta entrega. Remover o fallback textual incondicional “Ação concluída” caso não haja comprovação.

O histórico da rodada mantém pares de tool call/result íntegros. Ao encerrar a rodada, conservar o histórico conversacional já adotado pelo runtime; não introduzir persistência de corpos de e-mail, argumentos de comandos ou capturas. Dados externos são observações, nunca instruções nem concessões de autoridade.

### Voz

Anunciar apenas ferramentas dos módulos autorizados. Não anunciar execute_task nem encaminhar chamadas ao planejador. `invoke_live_task` pode manter o nome por compatibilidade interna, passando a despachar pelo ModuleBridge sem TaskClient. O modelo Live usa os resultados na própria sessão para decidir a continuação e responder em áudio.

Preservar cancelamento existente ao encerrar a chamada e a política de renovação da sessão: ferramentas novas exigem reiniciar a chamada; desativação bloqueia imediatamente novas execuções. Uma chamada execute_task antiga deve falhar explicitamente, nunca gerar efeitos ou cair em shell.

### Comportamento conversacional

Compartilhar orientações entre texto e Live: executar pedidos claros; usar histórico e preferências confiáveis; escolher padrões de apresentação de baixo impacto quando opcionais; não exigir que o usuário descreva a implementação.

Exemplos: “veja meus e-mails” pode consultar até cinco mensagens recentes na caixa de entrada das contas conectadas, identificando contas/falhas parciais. “Como está meu PC?” usa as ferramentas de saúde disponíveis sem perguntar quais métricas primeiro. Um destinatário não identificável ou horário indispensável de lembrete continua exigindo esclarecimento; não inventar esses valores. Se o usuário já informou o dado no contexto, não pedir novamente. Não prometer que prompts eliminam toda pergunta ou garantem qualidade do modelo.

### Controles preservados

Licença de 72h, consentimento Total Control, estado dos módulos, schema dos argumentos, sessão, revisão da conta, cancelamento e autorização antes dos efeitos permanecem no Main. Sem confirmação adicional por operação. Preservar prova dos executores Main e diário idempotente de e-mails; ausência de tarefa não pode enfraquecer esses contratos.

Não repetir envio com resultado desconhecido nem trocar conta ou usar PowerShell/SMTP para contornar indisponibilidade de e-mail. Downloads continuam adiados. Capturas não podem vazar base64 em tool_result, histórico ou logs. Não encaminhar resultados privados completos ao renderer apenas porque o caminho direto antigo fazia isso; reutilizar sanitização/diagnósticos limitados e manter dados necessários à IA somente no canal apropriado.

### Histórico e compatibilidade

Preservar diretório orchestration, classes Main de tarefas, tabelas/migrações e histórico SQLite. Não criar novas tarefas de plano nas conversas diretas. Não apresentar progresso fictício de etapas; a interface usa eventos de ferramenta existentes e identifica o painel de tarefas como histórico de execuções anteriores, sem anunciar que toda conversa será registrada ali. Sem migração destrutiva, seletor entre modos ou restauração automática do planejador.

## Entregas a detalhar após revisão

1. Chat direto e política conversacional compartilhada: runtime, helper de orientações e testes Python com adaptador falso, incluindo cinco rodadas e fallback factual.
2. Live direto e ciclo de vida: catálogo, callback, cancelamento, desativação de módulo, chamada antiga execute_task e testes de sessão.
3. Integração Main/UI e regressões: ferramentas sem task context, provas de e-mail/lembretes, sanitização e histórico anterior; documentação/progresso.

## Aceite necessário

- Com sessão TaskClient negociada, o chat executa as tool calls originais sem chamar Planner ou compose_task_response.
- Pedido de continuação usa o histórico; resultados encadeiam leitura e escrita sem plano JSON intermediário.
- Fixtures determinísticas cobrem esclarecimento essencial e ausência de contrapergunta quando há dados suficientes. Testes de prompt não comprovam comportamento real de modelos.
- Live não anuncia execute_task; chamadas individuais não abrem tarefas e encerramento cancela trabalho pendente.
- Licença/módulo revogado bloqueia novas ações; resultado desconhecido de envio não causa segundo POST.
- Provas Main, CAS de contas, isolamento entre contas e bloqueio de downloads mantidos em chamada direta.
- Não há base64 de captura, tokens ou corpos completos de e-mail em eventos visuais/logs; histórico SQLite anterior intacto.
- Executar testes direcionados, `npm.cmd run test:python`, `npm.cmd run verify` e scanner; sem instalador. Registrar Node local versus engine do projeto.
- Teste com provedor/conta real somente em etapa separada com escopo autorizado; não prometer redução de latência medida sem medir.

## Fora de escopo e retomada

Não iniciar Pesquisa web, Documentos, Outlook, novos provedores ou dependências. Não alterar cadastro OAuth real. Trabalhar na main por preferência do usuário, preservar alterações existentes e não fazer commit/push/deploy. A autorização posterior de código substituiu o gate de planejamento. Validação real de comportamento/latência do modelo permanece separada das evidências locais.
