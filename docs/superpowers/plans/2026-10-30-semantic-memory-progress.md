# Memória semântica — progresso e retomada

**Data:**30/10/2026. **Base:**a8fcfff na main; alterações documentais anteriores preservadas. **Estado:**01/02 concluídas;03 implementada e revisada,55/55 testes de memória e gate real7/7 passaram. Aceite geral pendente por bug web preexistente confirmado de margem1ms entre relógios Main/Python; abordagem aguardando escolha em `2026-10-30-web-summary-clock-correction.md`.04 não iniciada. Detalhes em `2026-10-30-semantic-retrieval-progress.md`.

## Decisões autorizadas

Desenho e planos aprovados pelo usuário. Execução nativa/main, testes antes do código, sem commit/push/instalador nesta retomada. Fatos/nome/preferências permanentes até exclusão manual. Busca local; pesos por download sob demanda ao ativar/primeiro uso. Habilidades aprendidas automaticamente terão especificação própria depois da memória.

## Entrega01 — componentes não publicados

- `src/shared/types/semantic-memory.ts`: tokens, snapshot, alterações e envelope, sem dependência Main.
- `src/main/memory/semantic/contracts.ts` e `source-codec.ts`: JSON protegido schema2; limites32MiB plaintext/64MiB envelope, estrutura/instalação/IDs/datas estritos, sem filtro de idade ou reescape de conteúdo persistido. Proteção injetável; erro não vira memória vazia/plaintext.
- `source-file.ts`: leitura limitada e UTF-8 estrito, detecção de arquivo inválido/link, temporários exclusivos no mesmo diretório, flush/rename sem unlink prévio do original e backup exclusivamente protegido criado por este componente. Falha preserva principal. Se principal faltar e houver backup conhecido, falha fechada em vez de restaurar automaticamente uma memória que pode ter sido excluída.
- `permanent-store.ts`: detecção legada sem chamar load com TTL; migração guarda fonte válida antiga e IDs/datas. Mutações com geração/revisão, sanitização somente na admissão, eventos após commit e comparação de fingerprint para alteração concorrente detectada. Clear não reseta revisão. Perfil/cipher inválidos, HWID diferente, crypto/disk/rename falhos não autorizam reset.
- `legacy-adapter.ts`: load/edit/save rastreado por WeakMap, rejeição de save antigo após clear e de objeto sem origem/token; upsert ignora IDs/datas recebidos, deduplica só texto idêntico normalizado e preserva fatos similares distintos. Resumo limitado6.144bytes UTF-8 sem alterar a fonte.

## Decisões internas e limites

O plano expunha save legado, mas MemoryChange não tinha full replacement atômico. Foi adicionado `MemorySource.replace(memory,expected)` somente interno ao Main/adaptador, sem nova capacidade para a IA ou endpoint de painel. Novos IDs/datas seguem atribuídos no Main. Atualizado no mapa00 para próximos executores.

Backups cifrados são recuperação lógica, não apagamento forense. O arquivo legado pode já estar plaintext antes da migração e antigos backups legados podem existir; não prometer removê-los retroativamente. O novo componente não cria cópia plaintext adicional. Nenhum backup é restaurado sem direção explícita, evitando ressuscitar dado apagado.

Não há mudança na `src/main/memory.ts` ativa ainda. A troca da composição e da regra atual de30 dias acontece na etapa04, antes do primeiro load/snapshot legado. Não anunciar permanência já aplicada ao perfil pessoal. Os componentes01 foram executados apenas com arquivos temporários sintéticos.

## Evidências observadas

- Task1: RED por codec ausente, GREEN3/3 e typecheck0. Criptografia reversível fake para contrato; não teste de DPAPI Windows real.
- Task2: RED por módulos ausentes; GREEN5/5 após corrigir somente um erro de contagem do teste (cinco mutações, não seis). Uma regressão posterior provou snapshot de migração antigo pareado com fingerprint de outro escritor; RED0!=1, corrigido lendo/decodificando a versão realmente observada após commit. Teste de encrypt quebrado também preserva a fonte.
- Task3: RED por adaptador ausente, GREEN4/4; testes preservam &amp; legado, NFC/casefold, datas antigas, IDs Main, resumo e rejeição de save obsoleto.
- Revisão independente única: nenhum Critical/Important confirmado; um Minor de autorização pós-rename. Se a autorização expira depois de uma gravação autorizada, os dados não devem ser devolvidos, mas o token de invalidação precisa ser emitido mesmo assim. Reproduzido RED e corrigido em um fixpass com finally. Domínio final **14/14**.
- Revisor tentou suíte, mas esbuild foi bloqueado pela sandbox antes dos testes. As execuções do implementador foram realizadas com escalonamento e resultados registrados; não afirmar teste independente executado nem segunda revisão.
- Verificação geral inicial: **444/444**,0falhas/skipped, tipos/build dev exit0. Verificação final após fixpass: **445/445**,0falhas/skipped, tipos e builds Main/preload/renderer exit0. Aviso de chunk renderer>500KiB preexistente permanece; sem mudança oportunista. Scanner final: **565 arquivos** sem achados; diff check sem erros.

## Próxima etapa

### Retomada02 — preparação parcial, alternativa autorizada e avaliada

Em30/10, a candidata exata `@huggingface/transformers@3.8.1` foi instalada com scripts desativados para avaliação. A auditoria de produção falhou com duas vulnerabilidades altas na cadeia `sharp` (GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w). A candidata foi removida, sem forçar atualização ou override. Auditoria após remoção: **zero vulnerabilidades**, exit0. Nenhum peso foi baixado e nenhum worker foi executado.

Parte independente concluída: manifesto candidato fixado no commit `2c4055b12046f11709e9df2c122e59ffbdc2f900`, com cinco arquivos e seus tamanhos/hashes, validação fechada e fingerprint determinístico. Testes do manifesto RED por módulo ausente, depois **2/2 GREEN**; typecheck exit0. Esse manifesto ainda não está publicado no runtime. O modelo original declara Apache2.0, mas a procedência/licença da conversão continua parte do gate pendente.

O usuário escolheu **avaliar Transformers.js4.3.2**, sem override. Instalação exata com scripts desativados concluída. Auditoria de produção: **zero vulnerabilidades**, exit0 (`audit-4.3.2.log`). O resumo geral do install ainda aponta vulnerabilidades de desenvolvimento; não afirmar auditoria de todas as dependências zerada. A engine do shell continua Node26 fora do suporte24; o teste Electron real rodou no Node24 embutido.

Harness `node scripts/evaluate-semantic-runtime.cjs` executou **utilityProcess no Electron44.4.0/Node24.21.0**, carregou ONNX1.30.0 nativo, verificou backendCPU e executou grafo Identity ONNX sintético, retornando42. Carregou Transformers4.3.2 e exigiu rejeição do modelo ausente com downloads/caches remotos desativados e conexões bloqueadas; **zero tentativas de rede**, exit0. Ambiente do processo limitado a variáveis Windows/temp, perfil temporário próprio. Não abriu o aplicativo Jasper nem o perfil pessoal. Esse teste prova importação/ABI/CPU e ausência de fallback remoto no caso ausente; **não prova embeddings384, qualidade PT-BR, consumo do modelo ou inferência real offline**, que permanecem no gateT3.

Tamanhos físicos observados no node_modules, separados dos pesos: Transformers9.990.867bytes; onnxruntime-node301.392.642bytes (arquivo distribuído com múltiplas plataformas), onnxruntime-web145.475.100bytes, sharp1.064.752bytes, sem somar transitivos. Binários ONNX Windowsx64 incluídos no pacote:67.075.688bytes, contendo DirectML/DX além do CPU; não foram executados scripts de download de CUDA/GPU nem selecionado provedorGPU. Não são estimativas do instalador final. Os cinco arquivos do modelo somam135.138.971bytes e ainda não foram baixados. Distribuição/licenças e seleção de arquivos do pacote comercial exigem revisão própria antes de publicação.

Próximo ponto de retomada02: cliente/worker com protocolo e fila limitados (Task1), depois downloader seguro (Task2) e gate do modelo real (Task3). Avaliação preliminar da biblioteca passou; não declarar etapa02 completa ou publicar recurso ready. Evidências locais em `.superpowers/sdd/2026-10-30-semantic-memory-02-model-preparation/`.

Verificação desta avaliação: typecheck passou; suíte inicial446/447 por `recurrence_checkpoint_pending` no teste existente de UNTIL UTC (limite16ms). O mesmo caso passou isolado (6/6 na suíte de calendário), sem alteração de código, e a repetição geral passou **447/447**, zero falhas/skipped (`tests-4.3.2-repeat.log`). Registrar como intermitência observada do orçamento de tempo, sem afirmar que foi corrigida. Build de desenvolvimento Main/preload/renderer passou separadamente, sem instalador; aviso preexistente de chunk renderer>500KiB permanece. Scanner incluindo não rastreados não ignorados: **569 arquivos**, sem achados. `git diff --check` passou. Não houve commit/push.

### Continuação02 — worker, transporte e cache implementados; revisão em andamento

Cliente de utilityProcess com um processo, quatro posições de espera, batch8,20s incluindo fila, correlação/fingerprint, validação384/L2/NaN/Infinity, cancelamento/stop e rejeição após morte sem recuperação automática. Protocolo fechado somente embed/count, sem paths/URLs/comandos na mensagem. Worker verifica os cinco arquivos e hashes antes de importar o runtime; bloqueia Socket.connect/fetch, CDN e caches implícitos, CPU explícito. Tokenização128 explícita, forward, mean pooling e L2; contagem usa o mesmo tokenizer sem truncar o texto.

Transporte dedicado de artefatos usa WebNetworkPolicy.approve e IP fixado com TLS do hostname original, HTTPS, Accept-Encoding identity, sem cookies/proxy/retry. Allowlist observada: huggingface.co e us.aws.cdn.hf.co. Tetos por manifesto,160MiB/arquivo,5 redirects,30s sem progresso,10min global; hash e bytes reais obrigatórios. O limite2MiB da pesquisa web permanece intacto. Preparo coalescido com autorização por consumidor, progresso até4eventos/s, verificação/probe antes de ready e descarte de resultado de epoch antiga.

ModelFiles mantém staging privado e ponteiro active.json atômico para diretório imutável. Modelo anterior é preservado; revogação antes do ponteiro impede promoção. Cancelamento depois do rename do diretório pode deixar um candidato sem referência no cache: não é recurso pronto e não é carregado pelo ponteiro. Não há exclusão recursiva de destinos externos nem promessa de resistência a atacante com controle completo do mesmo usuário/OS. Testes sintéticos permitem assets pequenos via helper ModelFileTransaction Main-only; ModelFiles de produção exige manifesto fechado.

Download real de teste em build/semantic-gate/models pelo transporte implementado: **135.138.971bytes**, hashes conferidos. Probe real de embed/count passou. Harness real Electron44.4.0/CPU offline produziu384dimensões finitas normalizadas, cold1985ms/warm131ms para batch6; memória amostrada a20ms:441.237.504bytes (~421MiB), não pico garantido. Dois pares PT-BR: positivo0,870 vs negativo-0,004; positivo0,613 vs negativo0,090. São exemplos de aceite, não benchmark geral de qualidade. Cache íntegro foi reutilizado com transporte de download proibido e inferência ainda offline. Logs real-preparation.log, real-worker-gate.log e cache-only-gate.log.

Licenças do SDK e ONNX/ThirdPartyNotices preservadas em resources/licenses. Proveniência da conversão, metadados sem licença própria, origem Apache2 e limites de redistribuição futura estão explicitados em semantic-model-NOTICE.md; não afirmar liberação comercial completa. Nenhum instalador ou perfil pessoal usado. Fatos permanentes e busca semântica ainda não estão integrados ao agente (etapa04). Revisão independente única de02 e verificação geral em andamento; não marcar02 concluída antes do resultado e dos gates pendentes.

### Revisão final02 e ponto de retomada

Uma revisão independente de todo02 não encontrou Critical e identificou dois Important: verifyLocal não tinha cancelamento/cleanup rastreado; e a permissão da conversão deve bloquear03/04 também, não somente release. O primeiro foi reproduzido por teste RED em hash/probe concorrentes (signal não abortado), corrigido rastreando/coalescendo a verificação e fazendo stop abortar/aguardar ambas as operações; GREEN3/3 de lifecycle. O segundo permanece gate aberto, com alternativa concreta e decisão pendente em `2026-10-30-semantic-model-provenance-gate.md`. Não houve segunda revisão: o fixpass usa regressão e verificação geral.

Minor adiado: DNS pode consumir até o prazo global10min antes de começar o timer de inatividade30s da conexão. Não há conexão ou aceitação de endereço privado enquanto a aprovação está pendente. Manter para correção futura delimitada; nenhum retry automático. O comentário documental da revisão foi atendido pelos registros exigidos pelo usuário, que estavam sendo atualizados em paralelo; o suposto problema de cache-only foi retirado pelo revisor após reler a mudança já feita no harness.

Verificação geral antes do fixpass:464/464, tipos e build passaram. Após o fixpass: **npm run verify exit0,465/465 testes, zero falhas/skipped, tipos e builds Main/preload/renderer aprovados** (`verify-after-review.log`). Scanner incluindo arquivos novos:589arquivos sem achados; diff check passou. Não declarar etapa02 completa nem iniciar03/04 enquanto o gate de proveniência permanecer aberto. Usuário recebeu a escolha entre avaliar a conversão ONNX Community com Apache2 declarada ou aguardar esclarecimento da conversão atual; nenhuma troca foi executada.

### Gate resolvido — conversão ONNX Community autorizada

O usuário escolheu avaliar a conversão ONNX Community mantendo Transformers4.3.2. Manifesto atualizado para `onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX`, commit `d4c06bf0d7680171ac30042a1387e1fdb7a90021`, cinco arquivos **135.135.340bytes**; hashes oficiais de LFS e hashes calculados dos pequenos JSON conferidos. Teste de aceitação/rejeição da candidata antiga foi RED antes da troca e GREEN3/3 depois. Fingerprint muda; o cache anterior foi preservado e não é aceito como nova candidata. Biblioteca/provedor/limites não mudaram.

Proveniência agora explícita: model card declara `license: apache-2.0` e base original. Card pinado preservado em `resources/licenses/semantic-model-card.md` (4479bytes, SHA25685bba6e4bf6a155fdf16c7d7f43cb1321c27672e0d29e9d5f0e881feeb6de588), texto Apache em semantic-model-Apache-2.0.txt e NOTICE atualizado. Isso resolve o bloqueio específico que impedia03/04; não equivale ao aceite completo de distribuição comercial de todos os componentes transitivos.

Teste real da nova candidata: Electron44.4.0/Node24.21.0, CPU, worker com Socket.connect/fetch bloqueados. Vetores384 finitos normalizados, cold2019ms/warm136ms para batch6; memória amostrada20ms:451.821.568bytes (~431MiB). PT-BR positivos0,858/0,609 contra negativos-0,007/0,084. Cache-only real passou com downloader que lança erro. Logs `community-preparation.log`, `community-worker-gate.log`, `community-cache-gate.log`; o teste anterior Xenova permanece apenas histórico.

Verificação final desta avaliação: `npm run verify` exit0 (**466/466 testes**, zero falhas/skipped, tipos e builds de desenvolvimento), `npm run audit:runtime` zero vulnerabilidades de produção, scanner591arquivos incluindo novos sem achados, diff check0. Evidência em `community-verify.log`. Sem nova revisão do mesmo diff: a revisão única de02 e seu fixpass já estavam registrados; esta troca autorizada alterou manifesto/dados de licença e adicionou a regressão correspondente, com gate real repetido. MinorDNS continua adiado e o aviso preexistente de chunk renderer>500KiB permanece. Nenhum perfil pessoal, índice real, commit/push ou instalador gerado.

Retomada:03 pode consumir ModelFiles/ModelPreparation/SemanticModelClient com o novo fingerprint; não reutilizar embeddings de outro modelo. Implementar índice cifrado reconstruível, chunks e recuperação híbrida conforme plano03. A memória ativa ainda usa composição legada até04; não anunciar busca semântica já publicada no agente nem migração pessoal concluída. Habilidades aprendidas automaticamente continuam especificação futura separada.

02: manifesto pinado, preparação por download sob demanda, worker local e gate real de compatibilidade/qualidade. Nenhum pacote ou modelo foi instalado/baixado em01.03 adicionará índice derivado e04 publicará integração, captura/painel/chat/Live. Não aplicar migração ou baixar modelo no computador real como atalho de teste.

Node local26.8.2 continua fora da engine24; não alegar CI/Node24 testado. Sem mudanças Python, endpoints, licença, Gmail, pesquisa web ou funcionalidades ativas nesta etapa. Logs/ledger locais em `.superpowers/sdd/2026-10-30-semantic-memory-01-permanent-store/` são ignorados pelo Git; este registro e os testes de fonte preservam as conclusões para outra máquina.
