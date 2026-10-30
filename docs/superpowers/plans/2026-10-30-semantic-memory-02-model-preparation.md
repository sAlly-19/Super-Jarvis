# Memória02 — preparação sob demanda e worker de embeddings

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, método nativo/main. Executar gate antes de promover dependência/candidato; não ampliar rede do módulo web.

**Goal:** Preparar uma variante local verificada do modelo sob demanda e obter vetores sem rede durante inferência.

**Architecture:** Manifesto imutável distribuído com o app, downloader dedicado para arquivos grandes e um utilityProcess para inferência. UI recebe só estado/progresso. Recursos ficam no cache privado de modelos do aplicativo, não em pasta escolhida por conteúdo externo.

**Tech Stack:** Node HTTPS/crypto/fs, utilityProcess Electron; candidato Transformers.js4.3.2/ONNX CPU. Sem Torch/serviço Python adicional.

**Decisão30/10:** usuário autorizou avaliar4.3.2 após reprovação de3.8.1 na auditoria.4.3.2 instalada exata com scripts desativados; auditoria de produção0 vulnerabilidades. Gate preliminar real em Electron44.4.0/Node24.21.0: utilityProcess carregou ONNX1.30.0 e executou Identity sintético em CPU; Transformers rejeitou modelo ausente com rede bloqueada e zero tentativas. Isso não substitui o gateT3 de embeddings384 do modelo real. Harness reproduzível: `node scripts/evaluate-semantic-runtime.cjs`. Nenhum peso foi baixado nem instalador gerado nessa avaliação.

**Spec:** [desenho aprovado](../specs/2026-10-30-semantic-memory-design-draft.md); contratos/limites00. Pode ser testado independentemente do01 com entradas sintéticas.

**Retomada30/10:** implementação deT1–T3 e gate real CPU offline executados, revisão independente única tratada por regressão. Usuário autorizou avaliar a conversão ONNX Community com Apache2 explícita, resolvendo o bloqueio anterior de proveniência; manifesto e teste real atualizados. Consultar [progresso](2026-10-30-semantic-memory-progress.md) e [decisão resolvida](2026-10-30-semantic-model-provenance-gate.md). A validação geral da candidata atual está em community-verify.log. Sem commit/push/instalador.

## Global Constraints

Restrições00. Sem pesos no instalador; sem baixar ao importar/abrir app. Tetos160MiB/arquivo,192MiB total,10min total,30s sem progresso,5 redirects. Não reutilizar SafeWebHttpClient removendo seu teto2MiB; transporte de artefatos é separado. Sem modelo remoto como fallback ou download automático da biblioteca.

## Review Focus

1. Dependência/quantização pode não funcionar no Electron real —T1 antes de publicar.
2. HTTP redirect para rede privada/arquivo excessivo não chega ao disco como recurso pronto —T2.
3. Interromper/revogar/desligar durante verificação não publica arquivo parcial —T2/T3.
4. Worker pode carregar outra variante ou acessar CDN implicitamente —T1/T3.
5. Caminhos reparse/tamper/arquivo desconhecido não são promovidos a modelo validado —T2/T3.

## Task1 — manifesto e gate do candidato

**Files:** criar `src/main/memory/semantic/model-manifest.ts`, `model-manifest-validator.ts`, `model-worker.ts`, `model-client.ts`; testes `test/semantic-model-manifest.test.ts`, `semantic-model-worker.test.ts`; harness `scripts/test-semantic-worker.cjs` e `test/fixtures/semantic-memory/worker-host.cjs`. Modificar package/lock e electron.vite.config.ts somente durante a execução aprovada desta tarefa; licenças em resources/licenses.

**Interfaces:** ModelAsset/ModelManifest/EmbeddingClient/LocalTokenizer do00. `validateModelManifest(value:unknown):ModelManifest`. Worker fala exclusivamente por parentPort: pedido embed `{id,type:'embed',texts,modelFingerprint}` / resposta `{id,type:'result',vectors,modelFingerprint}`; pedido tokenize `{id,type:'count',texts,modelFingerprint}` / resposta `{id,type:'counts',counts:number[],modelFingerprint}`; ou erro com código fechado. Entry build `semantic-model-worker`; client inicia utilityProcess do arquivo compilado,1 worker,4 em fila, batch8/20s. Mensagens exatas/limitadas, sem comandos de sistema.

- [x] RED: manifesto com main/URL arbitrária/path traversal/duplicata/hash inválido/tamanho acima do teto é rejeitado. Caller não escolhe repositório, modelo ou caminho em execução. Apenas arquivos de uma variante e tokenizer/config necessários, sem scripts remotos.
- [x] Rodar `node scripts/run-tests.mjs semantic-model-manifest`; RED.
- [x] Fixar candidato a `@huggingface/transformers@4.3.2` (troca autorizada após avaliação de3.8.1) e modelo `onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX` (conversão autorizada após bloqueio de proveniência da Xenova), dtype int8,384dimensões. Commit completo/metadados oficiais e hashes conferidos; licença explícita/model card e notices preservados. Gates e limites permanecem aplicáveis a qualquer mudança futura.
- [x] Revisar metadados/scripts do pacote e instalar a dependência fixada com scripts automáticos desabilitados; preparar deliberadamente apenas os binários CPU/Windows necessários após essa revisão. Rodar `npm run audit:runtime`; registrar tamanho do runtime separado dos ~135MB estimados de pesos/tokenizer. Não usar audit fix --force, instalar variantes GPU extras ou trocar versão silenciosamente se gate falhar.
- [x] RED: client rejeita job de processo anterior, vetores fora de384, NaN/Infinity/norma zero, excesso de fila, timeout/cancelamento. Worker de teste sem arquivos retorna model_not_prepared, sem iniciar download. Rodar teste worker; RED.
- [x] Implementar manifesto/cliente/worker CPU. Configurar arquivos locais, remote models desabilitados e acesso a runtime CDN desabilitado. Não herdar chaves/proxy/ambiente do sidecar; nenhuma porta. Normalização/pooling mean e tokenizer efetivos entram no fingerprint; consulta e documentos usam o mesmo algoritmo.
- [x] Rodar testes de cliente/manifesto e typecheck; PASS. Esta tarefa fecha somente protocolo/cliente/manifesto. A prova real com arquivos depende do downloaderT2 e acontece emT3 antes de publicar qualquer engine pronto; não criar dependência circular T1→T2→T1.

## Task2 — downloader seguro e publicação atômica

**Files:** criar `artifact-transport.ts`, `model-files.ts`, `model-preparation.ts`; testes `test/semantic-artifact-transport.test.ts`, `semantic-model-preparation.test.ts` e fixtures próprias.

**Interfaces:** `ArtifactTransport.download(asset:ModelAsset,revision:string,destination:Writable,scope:SemanticScope,onBytes:(n:number)=>void):Promise<void>`; `ModelPreparation` do00. `ModelFiles(root,manifest).verify(scope):Promise<boolean>` e `publish(staging,scope):Promise<void>`. Paths/URLs vêm só do manifesto local aprovado; renderer não passa path/destination.

- [x] RED: DNS com endereço privado/misto, redirects privados, HTTP sem TLS, credenciais,5+redirects, conexão diferente do IP aprovado, encoding compactado e tamanho/hash incorretos interrompem stream, removem apenas staging próprio e não deixam phase ready. Fake HTTPS prova TLS hostname original e conexão fixada, reaproveitando WebNetworkPolicy.approve sem afrouxar regra web.
- [x] RED: servidor sem Content-Length também é limitado por bytes reais; fechar conexão cedo não conta como download completo. Arquivos extras/variantes não solicitadas nunca são baixados. Erros não expõem URL assinada ou token de redirect ao painel/log.
- [x] RED: cancelar/desligar/revogar entre download e rename impede publicação; duas prepare não duplicam rede. verifyLocal e segundo prepare de cache íntegro não fazem rede. Staging parcial não é lido pelo worker; pasta apontando para symlink/junction antes da operação é recusada, assim como escape do root e troca detectada de diretório na publicação.
- [x] Rodar `node scripts/run-tests.mjs semantic-artifact` e `semantic-model-preparation`; RED.
- [x] Implementar GET HTTPS streaming, Accept-Encoding identity, sem cookies/proxy ambiente/retry; validar todos os DNS e pin à conexão. Allowlist de origens da distribuição é estática no manifest/transport (Hub/CDNs oficiais realmente observadas no gate), não wildcard recebido da resposta. Novo host legítimo não previsto resulta em erro explícito para revisão, não allow-all.
- [x] staging é subdiretório aleatório dentro de root fixo; nomes de arquivo vêm do manifesto fechado. Abrir sem seguir links onde suportado, verificar diretórios/caminhos resolvidos antes da escrita/publicação. Não extrair ZIP nem aceitar paths externos. Verificar bytes/hash de cada arquivo antes de trocar o diretório ativo, preservando versão íntegra anterior; estado só fica ready após teste local de carregamentoT1.
- [x] Encerrar streams/sockets/handles no abort/timeout, descartar operações antigas por epoch, emitir progresso limitado (máximo4eventos/s) e erros fechados. Falha de limpeza não deve mascarar que o recurso permanece indisponível. Não declarar proteção contra atacante com controle completo do mesmo usuário/OS apenas por checar path.
- [x] GREEN: repetir testes e typecheck. Registrar bytes exatos, revision/hashes, hosts utilizados e licenças; passar recurso ao gate realT3, ainda sem publicar o módulo no agente.

## Task3 — estado local e ciclo de vida

**Files:** ampliar model-client/model-preparation; teste `test/semantic-model-lifecycle.test.ts`. Integração com Main/UI só04.

**Interfaces:** prepare/state/verifyLocal/cancel do00; `stop():Promise<void>` encerra worker/fila e download; não exclui automaticamente pesos íntegros ao desligar.

- [x] RED: not_prepared→downloading→verifying→ready; falha/cancelamento com código e sem publicação tardia. Ativar novamente reutiliza íntegros. Worker morto não responde como pronto; novos jobs recebem erro até recuperação explícita, sem tentativas infinitas.
- [x] RED: fila maior que4 rejeita novo job, deadline inclui espera; stop encerra processo e rejeita todos. Progresso de epoch anterior é ignorado. Recurso tampered falha verificação antes de uso e não dispara novo download silencioso durante inferência.
- [x] Rodar teste lifecycle; RED. Implementar máquina de estados e completar testes; PASS. Atualizar progresso: recurso preparado não é módulo publicado; não tocar memória real.
- [x] Preparar somente a variante candidata em diretório de teste pelo transporteT2. `node scripts/test-semantic-worker.cjs` exige relatório de384dimensões/norma/latência fria+quente/picoRAM e rede bloqueada após preparo. Comparar pares PT-BR relevantes e negativos, sem garantir desempenho antes da medição. Teste em Electron instalado, sem instalador.
- [x] Gate final02: se biblioteca/quantização/licenças/binários ou inferência offline falhar, parar promoção e apresentar alternativas ao usuário. Não substituir por embedding remoto, Python/Torch ou outro modelo automaticamente. Sucesso de mocks ou existência do arquivo não aprova o gate. Só depois do teste real publicar phase ready ao consumidor03/04.
