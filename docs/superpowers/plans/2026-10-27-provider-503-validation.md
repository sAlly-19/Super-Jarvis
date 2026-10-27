# Aceite do orquestrador — diagnóstico HTTP 503

Data: 27/10/2026, America/Sao_Paulo. Continuação autorizada pelo usuário. Referência: [progresso 02](2026-10-26-orchestrator-progress.md).

## Escopo e estado de entrada

Investigar o erro antes de corrigir. Base atual: commit 7adda75, criado antes desta rodada; working tree inicialmente limpo. Não repetir implementação da fase 02, trocar provedor/modelo ou alterar retry/fallback silenciosamente. Configuração observada: Gemini, gemini/gemini-3.1-flash-lite. Essa observação substitui suposições sobre o modelo da rodada anterior.

## Evidências executadas

1. Aplicativo empacotado com perfil existente: licença unlocked, computer autorizado/habilitado, connectAgent success. Teste de texto exigindo TESTE OK reprovado: HTTP 503 ServerError, cerca de 6.629 ms. Mensagem de erro não foi considerada resposta válida.
2. SDK google-genai diretamente, mesmo modelo e chave, sem orquestrador, histórico ou ferramentas: metadados do modelo disponíveis; uma geração mínima respondeu TESTE OK. Em outras duas execuções, a mesma geração mínima recebeu HTTP 503.
3. Erro sanitizado do SDK informa explicitamente alta demanda temporária do modelo. Chave válida/metadados acessíveis não garantem disponibilidade de inferência.
4. Adaptador de produção com cliente SDK atual e prompt mínimo: sem ferramentas respondeu TESTE OK; com as cinco declarações canônicas projetadas para Gemini recebeu HTTP 503 com a mesma mensagem de alta demanda. Nenhuma ferramenta foi executada na sonda SDK (automatic function calling desabilitado).
5. A primeira sonda chamada adapter_flags acrescentava thinking_level=low independentemente do modelo; essa NÃO reproduzia exatamente o payload atual para 3.1-flash-lite e não é usada como prova causal. Foi substituída pela chamada ao GeminiAdapter real nas comparações acima.

Scripts temporários ignorados pelo Git em .superpowers/provider-diagnostic.cjs e provider-diagnostic.py. Credencial descriptografada em memória com safeStorage no contexto criptográfico do perfil original e enviada por stdin privado ao SDK. Não impressa, escrita em arquivo ou passada em argumentos. Não foram copiadas chaves de criptografia. O perfil original foi necessário porque um perfil temporário novo não consegue abrir sua criptografia; a tentativa inicial falhou fechada. Nenhuma nova ativação/liberação de máquina.

## Conclusão e limites

HTTP 503 reproduzido fora do loop do agente e até com pedido mínimo. Evidência confirma resposta de indisponibilidade/alta demanda do provedor; não demonstra defeito novo no orquestrador. A diferença com/sem ferramentas não prova erro de schema: requisições mínimas também alternaram entre sucesso e 503. Não atribuir a causa a quotas, cobrança, bloqueio de conta ou configurações sem evidência. Não prometer correção local de capacidade do serviço.

Referência primária: [Google — troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting): 503 UNAVAILABLE é compatível com serviço temporariamente sobrecarregado/indisponível. Retry com backoff é uma alternativa, mas modifica a regra aprovada de não acrescentar tentativas nesta fase; não foi implementado.

## Próxima decisão pendente

Pergunta enviada: testar outro modelo Gemini do catálogo temporariamente e restaurar o atual ao terminar (recomendado), ou manter o modelo e aguardar normalização. Aguardar resposta antes do teste com outro modelo ou qualquer nova implementação. Se escolhido o teste: validar metadados, usar prompt sem efeitos primeiro e, havendo resposta, executar somente duas leituras de telemetria para o aceite composto; restaurar seleção mesmo se falhar. Não alterar chave, consentimento ou licença. Se não houver provedor disponível, manter aceite real pendente.

Nenhum código de produção, política de retry ou configuração de provedor/modelo foi alterado nesta rodada. Sem commit/push. As suítes anteriores não foram repetidas porque não houve mudança de produção; os resultados deste documento são sondas reais específicas, não aceite integral.

## Decisão final do usuário

Usuário escolheu manter o modelo atual e aguardar a normalização, sem mudar a política de tentativas. A pergunta acima está resolvida: não testar outro modelo, trocar provedor/chave ou acrescentar retry/fallback. Encerradas as sondas desta rodada; não há monitoramento ou polling automático. Aceite com provedor real permanece pendente para retomada solicitada pelo usuário. Código/configuração preservados; apenas documentação atualizada.

## Retomada posterior solicitada — teste mínimo passou

Usuário solicitou PROSSIGA. Executado um teste pontual no mesmo modelo/configuração: licença unlocked, computer autorizado/habilitado, connectAgent success e resposta TESTE OK recebida em 5.591 ms (9 caracteres). Isso comprova essa requisição, não normalização permanente do serviço.

Preparado no driver temporário --compound um pedido de exatamente duas consultas get_system_telemetry em sequência, exigindo tarefa persistida succeeded e duas etapas succeeded, além da resposta. A execução desse comando foi REJEITADA pela revisão automática de aprovação antes de criar o processo. Motivo declarado: possível exportação de telemetria real potencialmente sensível ao provedor, sem consentimento específico identificado pela revisão. Não executar por alternativa indireta nem marcar como testado. Não houve tarefa composta executada nesta tentativa.

Solicitado ao usuário consentimento restrito ao teste de duas consultas com telemetria real (CPU, memória, disco e nomes de processos) e processamento pelos serviços de IA/voz configurados. Aguardar resposta antes de executar. Alternativa oferecida: preservar somente validação local sem envio. Modelo, chave, política de tentativas e código de produção permanecem inalterados.

## Direção final — pular o teste do modelo por enquanto

Usuário respondeu para pular essa parte por enquanto e informou ter consumido todos os tokens do modelo. Registrar essa causa como informação do usuário, sem substituir os resultados observados (o SDK retornou 503 com mensagem de alta demanda; não foi feita auditoria de consumo/cobrança).

Pedido de consentimento encerrado sem autorização para o teste: a resposta NÃO autoriza exportação de telemetria nem contorno da rejeição automática. Não executar --compound, novas sondas de API, polling ou retries. Nenhuma troca de modelo/provedor/chave. Teste de objetivo composto com provedor real diferido por decisão do usuário; manter a implementação e as evidências locais já verificadas, sem declarar esse aceite aprovado. Retomar somente quando solicitado e dentro da autorização disponível.
