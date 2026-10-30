# Memória03 — progresso e retomada

Data30/10/2026. Basea8fcfff + componentes01/02 não commitados, main. Usuário autorizou etapa03 com “prossiga”. Método nativo, testes sintéticos, nenhuma composição04/perfil pessoal/instalador. Estado: código deT1–T3 implementado; revisão independente única concluída e três correções verificadas por regressão; gate real repetido passou; verificação geral final em andamento.

## Entregas e evidências

- T1: migração010 somente fixture; fonte ativa do app continua até009. SemanticIndexStore e IndexCodec cifram fonte/texto/datas/termos/vetores. Builds só visíveis após finish. Token/fingerprint conferidos; invalidação durante encrypt interrompe commit. Recibo cifrado de contagem+digest detecta perda de linhas em build ready. RED módulos ausentes→GREEN3/3; regressão de token por ordem de propriedades RED→GREEN; detecção de linhas apagadas passou. Suíte finalstore4/4.
- T2: corpus com namespacefact/profile, sem reescape; chunks de96tokens, overlap até16, offsets em codepoints, IDs por fonte/posição/token/fingerprint. Usa tokenizer02 real, lotes8, rebuild consolidado na revisão mais recente; edição durante embed não publica fonte anterior. RED módulos ausentes→GREEN3/3; regressão de fim do suffix RED→GREEN; suíte finalindexer5/5.
- T3: cutoff0,55 e pesos0,75/0,25 fixos; stopwords explícitas, texto com case/acentos normalizados só para comparação, um hit por fonte. Saída até8hits/2000bytes por trecho/6144bytes JSON incluindo escapes/metadados. Modelo/index indisponível ou embedtimeout usam fonte atual com mode text_only/warning. Proteção de fonte falha: unavailable sem token inventado nem uso do índice como fonte. Autoridade e token conferidos antes de entregar; uma atualização textual e depois memory_changed se mudar novamente. RED módulos ausentes→GREEN retrieval2/2, service3/3; regressão de segunda mudança RED→GREEN; suíte finalservice6/6 incluindo stall~2,9s e revogação durante embed.

## Decisões internas

1. Recibo cifrado no registro reservado manifest da tabela chunks detecta build truncado sem coluna nova ou conteúdo em claro. Custo de falha: índice indisponível/fallback, fonte intacta.
2. MemoryRecall é união: hybrid/text_only exigem MemoryToken; unavailable tem tokennull. Plano exigia unavailable quando fonte falha mas não havia token legítimo nesse caso. Mantém coerência com state.tokennull. Consumidor04 deve tratar esse caso, sem inventar geração0.
3. Reserva100ms do prazo geral3s para fallback textual; embedding tem até2,9s em recall, sem ultrapassar prazo menor do chamador. Sem baixar cutoff ou mudar modelo para passar testes.

## Gate real de relevância

Fixture congelada antes de inferência: relevance-pt-br.json, SHA25625a3a8cedb6e9fe0825382537a9c4a758bc65fd9c58637af00b90e493ab7b700. Modelo/fingerprint ca523dbb7b42d00287f8665c8e8044ed1e1168b6cfb366ca9f0fa9c18eec41d2, ONNX Community aprovado02, CPU. Host e worker com Socket.connect/fetch bloqueados. Sem transporte de download importado; cache local verificado. Harness: node scripts/test-semantic-retrieval.cjs.

Sete consultas passaram: cinco positivos no top3 e dois negativos com hits[]. Cosines para fonte esperada: ambiente de trabalho0,452; café0,747; projeto0,674; Atlas0,613; Ana0,995. O caso ambiente de trabalho foi recuperado pela parte textual, pois0,452 está abaixo de0,55. Não alegar que todos os positivos passaram por semântica pura. Negativos tiveram máximos~0,133; política não foi alterada. Esses exemplos são aceite estreito, não avaliação geral de língua portuguesa ou garantia de verdade.

Reconstrução sintética com fakecrypto/embeddings/tokenizer:10fatos~11ms;500fatos~885ms, heapdelta~8,7MB no segundo (não pico, primeirodelta negativo por GC). Não extrapolar ao custo de modelo real ou DPAPI. Fontes permanentemente salvas não são apagadas pelo índice.

## Pendências antes do fechamento

Revisão única:0Critical,3Important confirmados por reprodução sintética independente, nenhum Minor adicional. Fixpass único:

1. Ana casava com banana, até com score0. Teste RED e correção por fronteiras Unicode na frase literal; casos textual e vetor ortogonal GREEN. Não afrouxar cutoff.
2. Fallback de fonte longa descartava o termo relevante no fim ao truncar prefixo. Teste Abacaxi RED; trecho começa no termo encontrado antes de aplicar orçamento, preservando fonte original; GREEN.
3. Builds antigos acumulavam ciphertext mesmo após rebuild/clear. Teste3builds RED (3!=1); begin remove somente derivados anteriores, invalidate remove builds/chunks com cascade. Invalidação reentrante durante encrypt sinaliza imediatamente e limpeza ocorre após rollback/commit da transação atual. Se SQLite indisponível impede limpeza, índice permanece logicamente indisponível e a remoção é tentada no próximo acesso, sem bloquear mutações canônicas. Isso não é apagamento forense de WAL/backups. GREEN.

Domínio após fixpass:store+indexer10/10, retrieval3/3, service7/7; tipos passados. Gate real repetido em real-relevance-after-review.log:mesmafixture/hash/política,7/7, mesmos scores observados. Não houve segunda revisão do mesmo diff: regressões e suíte geral verificam as correções. Verificação geral final está em verify-final.log; ainda confirmar resultado antes de marcar concluída. Scanner610arquivos incluindo não rastreados sem achados; diffcheck0.

Nenhum commit/push. Ledger local ignorado pelo Git em .superpowers/sdd/2026-10-30-semantic-memory-03-retrieval/. Depois04 publicará painel/chat/Live e migrará a composição legada antes do primeiro load com TTL. Habilidades procedurais seguem outra especificação. A revisão deixou fora de escopo a composição04, qualidade geral em português e desempenho máximo/DPAPI; não há essas garantias nesta entrega.

## Verificação geral e intermitências observadas

Antes do fixpass: npm run verify exit0,483/483, tipos/build aprovados. Depois do fixpass:486testes,484passaram e dois testes existentes falharam (verify-final.log): cancelamento stdio não observou início do PowerShell dentro de8s; web stdio observou summaryStatepending em vez deavailable. Todos os20testes novos de03 passaram. Isolamento sem alterar código/prazos: web-stdio1/1; module-stdio3/4, agora com cancelamento passando e outra falha Timeoutchat15s no modo direct. Isso evidencia intermitência/tempo em casos existentes, não estabelece sua causa final. Nenhum arquivo de src/main/modules, module-stdio/web-stdio ou scripts/run-tests foi modificado por03. O runner já usa concorrência1; não atribuir a falha a paralelismo da suíte sem prova. Node do shell26 continua fora da engine24. Última execução geral em verify-repeat.log; verificar resultado antes de concluir.

Handoff04: manter invalidação/limpeza de derivados em alterações da fonte mesmo quando o runtime semântico estiver desligado; não depender apenas da assinatura do indexer, removida em stop. Fonte01 é única autoridade e gestão de fatos funciona com o módulo semântico desligado.

Última verificação geral:485/486, somente web-summary pendente. Diagnóstico confirmado: Python aceita no máximo300001ms de futuro, Main emite300000ms; diferença entre relógios de5–8ms descartou ambos os recibos. Instrumentação sintética temporária foi restaurada e não registrou tickets. Plano separado `2026-10-30-web-summary-clock-correction.md`, aguardando escolha entre margem100ms só no consumidor ou protocolo relativo/monotônico. Nenhuma implementação dessa correção foi feita. Não repetir verify indefinidamente nem aumentar timeouts para obter verde.

Fechamento técnico03: **55/55 testes de memória passaram**, gate real7/7 repetido após fixpass passou, tipos passaram, build de desenvolvimento separado exit0. Scanner610arquivos sem achados, diffcheck0. `domain-final.log`, `build-final.log`, `real-relevance-after-review.log`. Aceite geral de03 permanece pendente da correção web escolhida e nova verificação; não publicar04 nem anunciar migração do perfil ativo. Sem commit/push/instalador.
