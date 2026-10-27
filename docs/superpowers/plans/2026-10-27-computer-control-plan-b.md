# Controle do computador — execução do plano B

> **For agentic workers:** usar superpowers:executing-plans e test-driven-development. Usuário ordenou desfazer A e implementar B; execução em main, sem commit/push.

**Goal:** Retomar as cinco ferramentas livres existentes e melhorar os resultados apresentados, retirando o catálogo estruturado de A.

**Architecture:** Restaurar runtime/protocolo e orquestrador anteriores à alternativa A; abertura e organização via PowerShell/GUI. Manter somente compatibilidade de leitura do SQLite v4 já criado, sem apagar dados nem retornar banco a versão anterior. Diagnósticos ficam voláteis; exit code zero não vira prova de objetivo arbitrário.

**Tech Stack:** stack atual, sem dependências novas.

**Spec:** alternativa B em [desenho original](../specs/2026-10-27-computer-control-design.md), agora escolhida expressamente pelo usuário.

## Restrições

Sem seis capacidades estruturadas, guard de argumentos do plano A ou seus limites de caminho/movimentação. Preservar licença, consentimento geral, switches, broker, cancelamento e limites de runtime anteriores (15 s para PowerShell; 8 etapas/120 s por tarefa). Não criar allowlist de comandos, novas confirmações, retry ou mudança de modelo. Não chamar API de IA/voz nem usar dados pessoais nos novos testes.

## Tarefas

- [x] Guardar reversão recuperável de A em .superpowers, comparar com base 7adda75 e preservar documentos/dados anteriores.
- [x] Escrever teste RED do catálogo de cinco capacidades e liberdade dos comandos PowerShell. Restaurar somente arquivos de A; remover seus novos executores/verificadores/testes e fixtures específicos. Preservar migração004/leitura de referências históricas para instalações que já abriram A. Testar protocolo original e acesso ao banco v4.
- [x] Escrever testes RED dos diagnósticos: stdout/stderr/exit code, GUI/volume, erros do broker e resultado desconhecido. Acrescentar capabilityId confiável aos resultados internos do executor; formatar dados limitados sem base64, comandos brutos ou sucesso inventado. Expor resumo também em execute_task Live. Ajustar instrução do planner para PowerShell/GUI livres sem prometer objetivos verificados.
- [x] Atualizar descrição da tela e regressões locais Python/TS, typecheck/build. Compilar e testar pacote final, integridade e smoke com perfil isolado. Revisar e registrar resultados; sem commit/push.

## Foco de revisão

Remoção efetiva das seis capacidades; nenhuma restrição de caminho A remanescente no despacho; compatibilidade SQLite v4; erro de comando distinguido de objetivo não comprovado; nenhum screenshot/base64/argumento persistido ou falha declarada como sucesso.

## Decisões e retomada

B foi explicitamente escolhido como substituição de A. Compatibilidade SQLite é manutenção de dados, não continuação do catálogo A. A e seus aceites ficam históricos/superados; não restaurar silenciosamente suas ferramentas. Próxima ação: executar as tarefas acima e acrescentar evidências neste arquivo.

## Progresso

Reversão seletiva realizada: 31 arquivos rastreados retornaram à base 7adda75; 11 arquivos novos exclusivos de A removidos com cópia recuperável em .superpowers/sdd/2026-10-27-computer-control-plan-b/rollback-a. Sem reset geral, limpeza de diretórios, commit ou push. Documentos anteriores preservados e marcados históricos.

Teste de catálogo falhou com 11 ferramentas antes da reversão e passou com as cinco originais. Scripts PowerShell com operações gerais, UNC e destino em outra unidade são aceitos pelo schema, sem serem executados por esse teste. Limites de caminho e ações estruturadas A retirados junto com o guard e protocolo v2.

Quatro testes novos de diagnóstico falharam antes e passaram depois: stdout/stderr/código, GUI/volume/erro, omissão de base64 e vínculo do nome da ferramenta ao plano. Python76/76. Typecheck/build e suíte TS inicial aprovados. Compatibilidade com SQLite v4 e referências históricas preservada; não apagar ou rebaixar dados.

Checkpoint superado: quatro cenários stdio nativos passaram (legacy, duas etapas, cancelamento com PID e diagnóstico com saída/erro/código7). Revisão independente estática não encontrou Critical/Important no escopo B; não substitui os testes. Suíte TS final230/230; Python76/76; artefato9/9, incluindo handshake que exige exatamente as cinco ferramentas originais. Typecheck/build e package:dir aprovados. verify:package e smoke:packaged finais aprovados. Scanner ampliado:291 arquivos, zero achados; diff sem falhas de whitespace. API/modelo real continuam adiados; nenhuma chamada externa de IA/voz nesta rodada.

## Encerramento

B implementado e validado localmente. A retirado do código e do pacote; histórico/documentos preservados. Executável local: release/win-unpacked/Jasper AI.exe. Sem commit/push; main mantida. Restrições específicas de ações/caminhos de A removidas; limites de execução anteriores e controles de licença/consentimento/cancelamento preservados. Modelo real, assinatura comercial e VM limpa não validados nesta entrega. Não avançar outra fase automaticamente.
