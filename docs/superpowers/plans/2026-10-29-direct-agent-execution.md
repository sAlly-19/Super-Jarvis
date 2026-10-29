# Execução direta — plano e progresso

> Usar superpowers:executing-plans, test-driven-development e verification-before-completion.

**Objetivo:** retirar planejamento obrigatório do chat/Live, preservando Main, módulos e histórico.
**Desenho:** [execução direta](../specs/2026-10-29-direct-agent-design.md).
**Autorização:** usuário aprovou a direção e pediu explicitamente “pode codar”, sem incluir o exemplo composto como cenário específico. Execução nativa na main, sem commit/push nem instalador. Aprovação de código supera o gate documental anterior; este registro serve de plano e retomada.

## Restrições

Sem dependências novas, APIs reais, alteração OAuth, deleção de tabelas/classes ou módulos novos. Preservar alterações anteriores no checkout. Chat com cinco rodadas e timeouts existentes; dados externos não autorizam efeitos. Ferramentas continuam mediadas pelo Main. Não prometer sucesso sem evidência, não reenviar email incerto.

## Tarefas sequenciais

- [x] 1. RED: testes runtime com TaskClient configurado e adaptador falso comprovam ferramentas originais, histórico da rodada, múltiplas etapas, limite de cinco rodadas e fallback factual. Testes Live comprovam catálogo sem execute_task, despacho sem tarefa e rejeição de chamada antiga.
- [x] 2. GREEN: runtime usa ModuleBridge diretamente; instruções comuns em helper `jasper-backend/direct_agent.py`; preservar pares call/result; remover desvio para Planner/compositor. Eventos visuais não expõem argumentos ou resultado privado; dados necessários ao modelo permanecem no canal interno. Helper não cria executor concorrente.
- [x] 3. RED/GREEN: testes de sanitização chat/Live, resultado incerto e cancelamento. Instruções comuns definem esclarecimento somente essencial, origem da conta, reconciliação sem reenvio e ausência de fallback para módulos desativados. Validar proteções existentes Main para requisições sem task context.
- [x] 4. UI: identificar registros antigos como histórico, sem progresso fictício nas conversas novas. Preservar cancelamento de tarefas antigas e SQLite. Testar texto acessível do painel.
- [x] 5. Verificar Python, npm verify, scanner e diff. Uma revisão independente do conjunto e correções necessárias. Registrar evidências, limitações e próximos passos, sem chamadas externas.

## Foco de revisão

Tool calls originais não podem ser executadas duas vezes; resposta sintética após limite não pode despachar novas ferramentas. Sessão negociada não pode reativar Planner. Cancelar Live deve cancelar bridge/workers. Capturas, corpo de email e argumentos não podem vazar em eventos. E-mails incertos não podem ser repetidos automaticamente. Histórico anterior e provas Main não dependem da criação de novas tarefas.

## Estado inicial

Leitura confirmou Main com `verifyHostResult` também no caminho sem tarefa, broker com licença/módulo/schema/revisão, histórico runtime apenas conversa final e chamada Live cancelável. Nenhuma alteração nesses contratos é necessária por princípio; ampliar apenas se teste revelar lacuna. Alterações anteriores de e-mail, dependências e OAuth preservadas.

## Conclusão local — 29/10/2026

Chat e Live agora usam as ferramentas pelo ModuleBridge/Main sem Planner, plano JSON obrigatório ou chamada extra do compositor. TaskClient e suas mensagens de compatibilidade continuam existentes, mas as conversas novas não criam planos/tarefas. Instruções de execução/contexto são compartilhadas, sem promessa de eliminar toda pergunta de modelos externos.

RED observado nos testes novos: desvio indevido para tarefas negociadas, catálogo Live com execute_task, fallback presumindo sucesso e exposição de dados privados. Corrigidos em runtime/direct_agent/live_session. Concorrência Live do guard de envio incerto também reproduzida RED e corrigida com serialização no callback do runtime. Cancelamento propagado ao bridge; integração Windows confirmou encerramento do processo PowerShell próprio.

Fixtures stdio foram migradas de um planejador JSON falso para escolhas diretas de ferramentas, com argumentos extraídos de resultados reais anteriores. Asserções agora conferem ausência de task_event/task binding, provas Main em capability_response, conta original, CAS, ausência de worker Python para e-mail/lembretes/saúde e ausência de efeitos quando o módulo requerido está desativado. Testes legados de classes/tabelas do orquestrador permanecem executados, sem remover dados.

### Evidências

- `npm.cmd run verify`: typecheck, 375/375 testes TypeScript e build dev aprovados (direct-verify.log). Bundle renderer acima de 500KiB é aviso preexistente, não falha. Sem instalador.
- `npm.cmd run test:python` final: 99/99 aprovados (direct-python-final.log), Python 3.11.9 do venv local. Inclui regressão do Gemini adicionada após revisão.
- `node scripts/run-tests.mjs stdio`: 10/10 aprovados (direct-stdio.log), Python/Main/worker reais, SDKs com transportes sintéticos. Sem contas, telemetria pessoal ou modelos reais.
- Painel de histórico: TASK_PROGRESS_PASS em Electron oculto, rede bloqueada e perfil de teste. Mantidos cancelamento, ordem por revisão e estado incerto anterior.
- `node scripts/scan-secrets.mjs --include-untracked`: 481 arquivos rastreados e não ignorados aprovados antes desta atualização documental; `git diff --check` sem erros (avisos de LF/CRLF).
- Logs/artefatos em `.superpowers/gmail-oauth-configuration/`. Esbuild exigiu execução com permissão ampliada por restrição de leitura ancestral do sandbox; não foi alterado para contornar o ambiente.
- Node local 26.8.2, fora da engine 24 declarada: não alegar validação no Node24/CI.

### Revisão independente e correção

Uma revisão independente identificou Important: o adaptador Gemini reconstruía Parts descartando thought_signature, necessário para continuar function calls. Teste com objetos reais do SDK e resposta sintética assinalou falha; corrigido preservando Parts na ordem original somente em memória da rodada, agrupando function_response consecutivos e excluindo texto thought da resposta pública. O round-trip foi validado pelo schema Content do SDK. Arquivos adicionais: provider_adapters.py e test_provider_adapters.py. Fonte: https://ai.google.dev/gemini-api/docs/thinking. Testes Python finais99/99 incluem o fixpass; não houve segunda revisão independente.

Minor mantido/documentado: após resultado incerto de escrita de e-mail, a trava conservadora vale até o fim da rodada de chat ou reinício da chamada Live, inclusive se a reconciliação trouxer estado conclusivo ou outra conta estiver disponível. Reconciliação e consultas continuam permitidas. Nenhum reenvio automático, mudança de conta ou fallback shell é feito pelo código; orientações também proíbem tal contorno pelo modelo. Demais proteções permanecem no Main.

### Retomada

Usuário pode reiniciar o desenvolvimento para carregar o novo Python e reabrir a chamada para renovar ferramentas. Ainda não medidos comportamento ou latência com modelo externo; testes sintéticos não provam que o modelo sempre escolherá os padrões esperados. Gmail já foi conectado pelo usuário em etapa anterior; não houve novo login/envio nesta entrega. Próximo módulo permanece Pesquisa web, ainda sem início e sujeito ao desenho. Main preservada, sem commit/push/deploy e sem limpeza das alterações anteriores.
