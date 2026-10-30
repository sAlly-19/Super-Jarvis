# Resumo web — diferença de relógio entre Main e Python

Data30/10/2026. Estado: diagnóstico confirmado, abordagem aguardando escolha do usuário. Encontrado durante aceite geral da memória03; nenhuma mudança em produção web/Python foi feita. Método nativo/main, systematic-debugging + writing-plans + TDD. Não alterar testes para esconder a falha.

## Problema reproduzido

`ResearchNotes.consume` em jasper-backend/web_research_notes.py aceita expiresAt no máximo300001ms à frente de time.time()*1000. Main em SummaryReceipts.issue usa Date.now()+300000. A margem efetiva entre relógios é1ms. Instrumentação temporária exclusivamente na fixture sintética, removida automaticamente, reproduziu falha com diferença positiva8,290ms no search e5,666ms no read: stored0 em ambos, sessão correta, finish sem recibos, resumo fica pending. Execução anterior com diferença negativa teve stored1 e resumo disponível. Logs locais web-clock.jsonl/web-clock-run-1.log e harness diagnóstico no ledger03. Nenhum ticket, resumo pessoal ou segredo registrado. `git diff --exit-code` confirmou fixture restaurada.

Main já mantém a autoridade: ticket aleatório de32bytes, sessão, geração/handle atual, uso único, verificação de licença/consentimento e prazo absoluto original via prune. A correção proposta não modifica essas verificações nem a licença72h.

## Opção1 recomendada — margem curta só no Python

Preservar protocolo e expiração no Main. No Python, constantes RECEIPT_MAX_AGE_MS300000 e RECEIPT_CLOCK_SKEW_MS100; capturar now uma vez e aceitar somente now<expiresAt<=now+300000+100. `finish` continua recusando expirados e Main continua impondo o prazo original; não renovar ticket nem estender validade no Main. Corrige o descarte antecipado por pequena divergência sem mudar o caminho chat/Live.

1. Teste determinístico em jasper-backend/tests/test_web_research_notes.py, relógio patchado: recibo com diferença10ms deve ser armazenado e gerar nota privada; expectativa atual RED. Cobrir limite100ms, acima do limite, expirado, NaN/Infinity, sessão incorreta e turno descartado. Sem modelo/API real.
2. Alterar somente jasper-backend/web_research_notes.py conforme regra acima; GREEN. Regressões de privacidade/nonce e finish permanecem.
3. Rodar testes Python de notas, testes TS de recibos e web-stdio real sintético. Repetir o caso antes intermitente com relógios controlados, sem aumentar timeouts de testes.
4. Rodar npm run verify e suíte Python pertinente, scanner/diff; registrar resultados no progresso03 e no progresso web. Não gerar instalador, commit ou push. Só depois do aceite geral fechar03 e propor04.

## Opção2 — prazo relativo no contrato privado

Substituir a comparação de relógios de parede no consumidor por TTL relativo e deadline monotônico local; Main preserva seu prazo original no mapa de tickets e segue sendo autoridade. Exige revisar SummaryReceipt, produtor Main, consumidor Python e testes de chat/Live/privacidade. Evita depender de sincronismo entre relógios, mas amplia a mudança além da falha reproduzida. Não implementar sob autorização da opção1.

## Fora de escopo

O timeout ocasional do teste nativo module-stdio é outra intermitência: cancelamento passou no isolamento e no último verify, mas direct falhou no isolamento por chat15s. Causa não confirmada; nenhum limite/executor foi alterado. Último verify teve485/486 e somente web-summary falhou; não alegar que toda intermitência foi corrigida pelo ajuste de relógio.
