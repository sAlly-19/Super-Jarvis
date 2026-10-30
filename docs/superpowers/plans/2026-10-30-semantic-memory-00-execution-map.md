# Memória semântica — mapa executivo e contratos

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, método nativo/main já escolhido. Não perguntar o método novamente. Executar somente depois da revisão/aprovação destes planos; TDD e uma revisão final por entrega.

**Goal:** Transformar a memória existente em permanente e recuperável localmente por significado, preparando a futura biblioteca de habilidades.

**Architecture:** Fonte canônica JSON protegida no Main, índice SQLite derivado, modelo preparado sob demanda e inferência em utilityProcess. Chat e Live usam ModuleBridge diretamente; sem Planner obrigatório.

**Tech Stack:** Electron44, TypeScript, node:sqlite, safeStorage; Transformers.js/ONNX como candidato condicionado ao gate02.

**Spec:** [desenho aprovado](../specs/2026-10-30-semantic-memory-design-draft.md).

**Execução30/10:** usuário aprovou os planos e o início01 com “Sim”.01 concluído:14 testes de domínio, verify445/445, tipos/build dev aprovados. Sem composição no perfil real;02–04 ainda não executados. Registro: [progresso semântico](2026-10-30-semantic-memory-progress.md).

## Global Constraints

- Main, método nativo, preservar alterações existentes. Sem commit/push/instalador nesta entrega sem pedido explícito.
- Fatos, nome, preferências e futuras habilidades não expiram por idade; exclusão é manual. Não recuperar magicamente dados já apagados pelo TTL antigo.
- Sem novo provedor/chave de embeddings. Somente trechos selecionados podem integrar contexto da IA configurada.
- Pesos fora do instalador: preparar ao ativar ou no primeiro uso se o módulo já estiver ativo. Módulo desligado/abrir aplicativo não dispara download.
- Recursos íntegros são reutilizados. Preparação tem progresso/cancelamento/erro; inferência depois do preparo não faz rede.
- Licença72h, Total Control e gates por sessão/revisão/generation antes da execução, entrega e persistência. Sem confirmação por operação.
- Memória factual não é habilidade, instrução de sistema, autorização ou prova. Aprendizagem automática de habilidades é outra especificação; não iniciar aqui.
- Criptografia indisponível/corrupção/HWID divergente não permite documento vazio nem plaintext. Fonte única; índices são descartáveis/reconstruíveis.

## Ordem e arquivos responsáveis

1. [01 — fonte permanente e migração protegida](2026-10-30-semantic-memory-01-permanent-store.md).
2. [02 — preparação e worker local](2026-10-30-semantic-memory-02-model-preparation.md).
3. [03 — índice reconstruível e busca híbrida](2026-10-30-semantic-memory-03-retrieval.md).
4. [04 — Main/stdio/painel/chat/Live e aceite](2026-10-30-semantic-memory-04-integration.md).

01–03 criam componentes testáveis sem migrar perfil real ou publicar o switch.04 troca a composição legada: nenhum load antigo pode aplicar TTL antes da migração. Código antigo continua disponível até essa troca, sem dois escritores canônicos simultâneos.

## Contratos comuns — fixar antes de implementar

Tipos compartilhados em `src/shared/types/semantic-memory.ts`, exportados no shared/index, sem imports Main. Internos em `src/main/memory/semantic/contracts.ts`.

- `MemoryToken={generation:number;revision:number}`; inteiros seguros não negativos, incrementados monotonicamente. generation muda em clear; revision em toda edição/remoção/inclusão/perfil, sem reset em clear.
- `PermanentMemorySnapshot={token:MemoryToken;memory:JasperMemory}`. Nome/preferências continuam nos campos existentes. Fonte interna schemaVersion2 tem instalação, token e profile; não replicar fatos em outra tabela canônica.
- `MemoryProtection={available():boolean;encrypt(text:string):Uint8Array;decrypt(bytes:Uint8Array):string}`.
- `ProtectedMemoryEnvelope={schemaVersion:2;sealed:string}`; sealed é base64 canônico dos bytes de proteção, sem campos pessoais claros.
- `MemorySource.snapshot():PermanentMemorySnapshot`, `mutate(change:MemoryChange,expected:MemoryToken):PermanentMemorySnapshot`, `onChanged(fn:(token:MemoryToken)=>void):()=>void`. Métodos síncronos; conflitos lançam `memory_changed`, falhas `memory_unavailable`; não publicar snapshot vazio por erro.
- Complemento interno01: `MemorySource.replace(memory:JasperMemory,expected:MemoryToken):PermanentMemorySnapshot` permite save legado atômico. Não integra MemoryChange nem API de IA/painel; evita full replace por múltiplas mutações parciais. Novos fatos recebem ID/data do Main; fatos existentes inalterados não são sanitizados novamente.
- `MemoryChange`: união estrita `{kind:'upsert_fact',id?:string,text:string}`; `{kind:'remove_fact',id:string}`; `{kind:'profile',userName:string,userPreferences:string[]}`; `{kind:'clear'}`. IDs existentes válidos são preservados; IDs novos gerados no Main. Datas/revisões não vêm da IA. Remoção ausente não recria item.
- Adaptador legado04 mantém `MemoryStore.load/save/addFact/upsertFacts/clear/getSummary` e funções exportadas. load associa o objeto retornado ao token de origem em WeakMap interno; save de um objeto carregado exige esse token ainda atual. save de objeto não rastreado exige expectedToken explícito como parâmetro opcional novo; sem ele rejeita memory_changed, não autoriza full replace cego. Callbacks assíncronos devem usar mutate com token capturado.
- `SemanticScope={signal:AbortSignal;deadline:number;check():void}`; deadline absoluto em ms. Todos os awaits e publicações revalidam scope.
- `ModelState={phase:'not_prepared'|'downloading'|'verifying'|'ready'|'cancelled'|'error';downloadedBytes:number;totalBytes:number;errorCode?:string}`. Eventos sem URLs assinadas, caminhos pessoais, fatos ou vetores.
- `ModelAsset={path:string;bytes:number;sha256:string}`; `ModelManifest={schemaVersion:1;modelId:string;revision:string;dtype:'int8';dimensions:384;pooling:'mean';normalization:'l2';maxTokens:128;assets:ModelAsset[]}`. revision é commit completo imutável, não main. `fingerprint` é SHA256 do manifesto canônico completo (sem incluir o próprio fingerprint); algoritmo de pooling/normalização/tokenização integra essa identidade.
- `ModelPreparation.state():ModelState`, `prepare(scope:SemanticScope):Promise<void>`, `cancel():Promise<void>`, `verifyLocal():Promise<ModelState>`, `stop():Promise<void>`. prepare concorrente compartilha uma operação interna, mas cada consumidor respeita seu cancelamento; cancelar preparação explícita cancela todos e invalida a geração. verifyLocal não faz rede.
- `EmbeddingClient.embed(texts:string[],scope:SemanticScope):Promise<number[][]>`, `stop():Promise<void>`; rejeitar dimensão diferente de384, NaN/Infinity, norma zero e resposta de job antigo.
- `LocalTokenizer.count(texts:string[],scope:SemanticScope):Promise<number[]>` usa o mesmo tokenizador no worker02; resultado é só contagem, não texto nem vetor para UI. `ChunkInput=Omit<MemoryChunk,'vector'>`.
- `MemoryChunk={id:string;sourceId:string;sourceRevision:number;generation:number;modelFingerprint:string;kind:'fact'|'name'|'preference';createdAt?:string;text:string;vector:number[]}` é interno; não chega ao renderer/log. EmbeddingClient02 também fornece a interface LocalTokenizer.
- `MemoryRecallHit={sourceId:string;sourceRevision:number;kind:'fact'|'name'|'preference';text:string;createdAt?:string;score:number}`; score não é confiança factual.
- `MemoryRecall={mode:'hybrid'|'text_only';token:MemoryToken;hits:MemoryRecallHit[];warningCode?:string}|{mode:'unavailable';token:null;hits:MemoryRecallHit[];warningCode?:string}`. Ajuste interno03: fonte protegida indisponível não oferece token legítimo; não inventar geração0 nem reaproveitar token do índice. Consumidor04 deve tratar a união/null.
- `SemanticMemoryService.recall(query:string,scope:SemanticScope):Promise<MemoryRecall>`, `reindex(scope:SemanticScope):Promise<void>`, `stop():Promise<void>`. Retorno exige token ainda atual e revalidação de autoridade. Índice obsoleto não autoriza usar texto antigo.

## Limites propostos para revisão destes planos

- Fonte: texto novo até20.000 caracteres por fato; consultas2.000; nome256; até256 preferências de2.000 caracteres. Migração preserva dados legados válidos maiores sem cortar; novos limites são admissão, não limpeza de registros antigos.
- Orçamento de plaintext canônico32MiB; envelope JSON cifrado64MiB. Ultrapassar limite rejeita nova gravação e preserva o anterior, sem apagar a memória mais antiga. Arquivo legado acima do limite é preservado e reportado, não truncado.
- Recall: até8 hits; cada texto no máximo2.000bytes UTF-8; JSON serializado do retorno até6.144bytes. Limites menores no pedido não são necessários inicialmente.
- Embeddings:1 worker, até4 jobs aguardando, batch de8,20s por job incluindo fila; deadline de recall3s. Ao estourar prazo, descartar job e usar somente fallback textual autorizado, com modo explícito.
- Chunks até96 tokens do tokenizer efetivamente selecionado, sobreposição de até16, sem ultrapassar limite do modelo; manter mapeamento para fonte e offsets. Preservar substrings originais por fronteiras Unicode, validando contagem do trecho no tokenizer; não exigir que decode(encode(text)) reconstrua texto idêntico. Consulta truncada pelo tokenizer, nunca por bytes inválidos.
- Preparação: arquivos individuais até160MiB e total aprovado até192MiB; uma operação, até5 redirects por arquivo, até10min total,30s sem progresso. Bytes exatos e hash vêm do manifesto pinado, com tetos adicionais. Sem retry automático; retomar não é prometido, pode reiniciar arquivo parcial sob comando explícito.
- Busca textual é modo degradado visível, não semântica fictícia; fatos continuam permanentes se modelo não estiver pronto. Off não liga preparação. Sem limpeza automática de fonte/índice para economizar espaço sem preservar/reconstruir dados.

## Integração por capacidades e protocolo

Catálogo adiciona somente `memory_recall`, módulo `semantic-memory`, permissão `memory.read`, entrada estrita `{query:string}`1–2.000 caracteres, timeout5s; executor Main retorna MemoryRecall. Feature hello_ack `semanticMemoryRuntimeVersion:1` condiciona anúncio, como o gate de web.

Chat novo faz no máximo uma recuperação automática por pedido antes de montar prompt, usando texto do usuário limitado2.000, se capability estiver negociada. Sem recuperação automática com consulta derivada de resposta de ferramenta. Live recebe a mesma ferramenta e instrução para usá-la quando contexto pessoal for relevante; não disparar uma busca a cada fragmento de transcrição nem reiniciar chamada automaticamente.

Adicionar host→sidecar `memory_state` com MemoryToken e `memory_invalidated` com MemoryToken; eventos sem fatos. memory_upsert novo exige `{token:MemoryToken,requestId,facts:[{fact:string}]}` e valida origem da rodada; Main atribui IDs/datas. Main carimba o token completo nos pedidos chat/audio; Live captura-o na rodada. Revisão além da geração impede ressuscitar texto após edição/remoção individual.04 define mensagens estritas preservando as demais, sem aceitar evento antigo sem versão como write moderno.

Índice e captura não concedem autoridade a conteúdo externo. O runtime preserva capture de fatos explícitos do usuário; em Live somente transcrição final da rodada, nunca output_transcription/modelo/e-mail/página. Sem extração de fatos por outra chamada paga de IA nesta entrega.

## APIs do painel propostas

`SemanticMemoryAPI.state():Promise<{model:ModelState;storage:'ready'|'unavailable';token:MemoryToken|null;mode:MemoryRecall['mode']}>`, `prepare():Promise<void>`, `cancelPreparation():Promise<void>`, `rebuild():Promise<void>`, `listFacts(query:{cursor?:string;limit?:number}):Promise<{token:MemoryToken;items:MemoryItem[];nextCursor:string|null}>`, `mutate(change:MemoryChange,expected:MemoryToken):Promise<PermanentMemorySnapshot>`, `onChanged(fn:()=>void):()=>void`, `onProgress(fn:(state:ModelState)=>void):()=>void`. token é null quando a fonte protegida estiver indisponível; não inventar generation0.

Canais `semantic-memory:state|prepare|cancel-preparation|rebuild|list-facts|mutate|changed|progress`. Guard existente + mainFrame confiável; não ampliar LOCKED_ALLOWED_CHANNELS. memory:get/clear atuais permanecem para compatibilidade, agora ligados à fonte protegida. Gestão de fatos funciona com módulo semântico desligado e exige licença/consentimento; preparar/reindexar/recall exigem módulo ligado.

## Review Focus

1. Primeiro snapshot não pode apagar fatos antigos antes da migração —01/04.
2. Clear/edição no meio de embedding/download/transcrição não ressuscita dado —02/03/04.
3. Falha DPAPI/arquivo inválido/HWID diferente preserva ciphertext e falha explicitamente —01.
4. Modelo pronto não pode fazer downloads implícitos ou carregar arquivo parcial/variantes extras —02.
5. Contexto ilimitado, injeção de página ou Live já aberta não contorna autorização/exclusão —03/04.

## Gates de viabilidade e continuidade

Atualização30/10:3.8.1 foi reprovada na auditoria e removida. Usuário autorizou4.3.2 e, depois, a conversão ONNX Community com declaração Apache2. O manifesto atual fixa onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX@d4c06bf0d7680171ac30042a1387e1fdb7a90021;135.135.340bytes em cinco arquivos. Auditoria de produção, download verificado, teste real384/L2/CPU offline e cache-only passaram. A evidência de proveniência está preservada; a candidata Xenova anterior foi retirada do manifesto. Consultar progresso02 para verificação geral e limites; não há integração ao agente antes de04.

Gate02 valida Transformers.js4.3.2/ONNX Community no Electron/Windows, CPU, licença/proveniência e dependências de produção. As mudanças de candidata foram autorizadas explicitamente e registradas. Se outro gate falhar, reportar opções ao usuário; não trocar biblioteca, provedor ou modelo silenciosamente. Memória e índice canônicos não dependem de escolher outra arquitetura para continuar legíveis.

Planos aprovados não significam modelo escolhido sem teste nem sucesso de benchmarks não executados. Usuário aprovou o mapa/planos e autorizou iniciar01; demais etapas seguem os gates descritos, sem download/instalação antecipados. Preservar ledgers, método nativo e trabalho na main. Habilidades automáticas e grafo são próximos desenhos, não funcionalidades escondidas destes planos.
