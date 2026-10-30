# Memória03 — índice protegido e recuperação híbrida

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, nativo/main. TDD e uma revisão final; nenhuma fonte privada real em testes.

**Goal:** Recuperar contexto relevante por significado e texto sem uma segunda fonte canônica ou ressurreição de memórias apagadas.

**Architecture:** Snapshot permanente01 → chunks/tokenizador02 → vetores locais → SQLite derivado protegido. Consulta usa apenas build íntegro correspondente ao token/fingerprint atuais; sem índice utilizável, fallback textual identificado e autorizado.

**Tech Stack:** StateDatabase/node:sqlite, proteção injetada, worker de embeddings02, TypeScript; sem servidor de vetores nem biblioteca adicional.

**Spec:** [desenho](../specs/2026-10-30-semantic-memory-design-draft.md); tipos/limites do00; Depends01+02.

**Retomada30/10:** execução autorizada após02, sem composição ativa04. ImplementaçãoT1–T3 e gate real7consultas passaram; revisão independente única e suíte geral em andamento. Contrato de recall ajustado para tokennull somente em modeunavailable quando a fonte não oferece token. Recibo cifrado de conclusão detecta linhas perdidas; reserva100ms do deadline3s para fallback. Evidências e limites em `2026-10-30-semantic-retrieval-progress.md`.

## Global Constraints

Restrições00. Index não é memória canônica. Fonte não expira e não é podada ao reindexar. Até8hits/6.144bytes JSON, texto2.000bytes/hit, query2.000caracteres, recall3s. Resultado semântico não é evidência de verdade nem autorização. Corpo de fonte/termos/vetores cifrados no índice.

## Review Focus

1. Editar/apagar enquanto embedding aguarda impede publicar texto anterior —T1/T2.
2. Queda entre commit JSON e notificação SQLite não deixa índice antigo utilizável —T1/T3.
3. Unicode/chunk overlap/JSON escapes podem estourar orçamento ou duplicar hits —T2/T3.
4. Consulta sem relação precisa retornar vazio, não a memória mais próxima a qualquer custo —T3.
5. Modelo ausente/corrompido/worker lento não apaga fonte nem finge busca semântica —T3.

## Task1 — migração010 e builds de índice protegidos

**Files:** criar `src/main/storage/migrations/010-semantic-memory.sql`, `src/main/memory/semantic/index-store.ts`, `index-codec.ts`; testes `test/semantic-index-store.test.ts`, fixture `test/fixtures/semantic-memory/database.ts`.

**Interfaces:** `SemanticIndexStore(database,protection).begin(token:MemoryToken,modelFingerprint:string):string` retorna buildId; `append(buildId,chunks:MemoryChunk[],check:()=>void):void`; `finish(buildId,token,check):void`; `read(token,fingerprint,check):MemoryChunk[]|null`; `invalidate():void`. Sem await em StateDatabase.transaction. read nunca retorna build parcial.

- [ ] RED: migração9→10 conserva dados/tabelas anteriores e snapshot de migração; SQLite contém só IDs/tokens/fingerprint/estado e ciphertext, sem sentinelas do texto, termos ou floats de vetores em colunas claras.
- [ ] RED: begin/append não tornam build disponível; finish exige token atual; geração/revisão antiga, modelo diferente, blob corrupto e proteção falsa levam a índice indisponível sem mexer na fonte01. Teste queda antes/depois de finish.
- [ ] RED: fonte muda sem onChanged (simular crash após JSON) e read com token novo rejeita build anterior. Clear durante encrypt/append invalida resultado; alteração de autoridade dentro de encrypt impede INSERT/commit.
- [ ] Rodar `node scripts/run-tests.mjs semantic-index-store`; RED.
- [ ] Implementar tabelas `semantic_index_builds(id TEXT PRIMARY KEY,generation INTEGER,source_revision INTEGER,model_fingerprint TEXT,state TEXT CHECK(state IN('building','ready','obsolete')))` e `semantic_index_chunks(build_id TEXT REFERENCES semantic_index_builds(id) ON DELETE CASCADE,id TEXT,sealed_chunk BLOB,PRIMARY KEY(build_id,id))`. Colunas numéricas não negativas; índices para token/fingerprint/state. Append e finish conferem check dentro da mesma transação, depois da cifragem e antes de publicar.
- [ ] Token global no build vem de MemorySource; não depende de receber notificação para detectar mudança. Builds obsoletos são dados derivados e podem ser removidos sem apagar fonte. Não converter corrupção em build ready vazio.10 fica somente na fixture até composição04.
- [ ] Rodar teste e typecheck; PASS. Cifragem fake nos testes não é prova de proteção real do Windows.

## Task2 — corpus, chunks e atualização cancelável

**Files:** criar `src/main/memory/semantic/corpus.ts`, `chunker.ts`, `indexer.ts`; testes `test/semantic-indexer.test.ts` e `test/fixtures/semantic-memory/corpus.ts`.

**Interfaces:** `memoryCorpus(snapshot:PermanentMemorySnapshot):Array<{sourceId:string,kind:'fact'|'name'|'preference',text:string,createdAt?:string}>`; fatos usam namespace `fact:<id existente>`, nome `profile:name`, preferências `profile:preference:<índice>` sob token global, evitando colisão com IDs legados. `chunkSource(source,token:MemoryToken,tokenizer:LocalTokenizer,scope:SemanticScope):Promise<ChunkInput[]>`; `SemanticIndexer(source,client,index,tokenizer).rebuild(scope:SemanticScope):Promise<void>`, `stop():Promise<void>`. Tipos LocalTokenizer/ChunkInput são do00. Tokenizer é o do modelo02, não split por espaços.

- [ ] RED: fatos/nome/preferências recuperáveis com origem e textos separados; strings legadas já escapadas não são regravadas/re-escapadas. Chunks respeitam96tokens/sobreposição de até16, preservam spans originais e nenhum caractere Unicode é cortado. Vários chunks da mesma fonte não viram múltiplas cópias da mesma memória no resultado.
- [ ] RED: remover/editar/clear enquanto embed aguarda impede append/finish antigo; worker de sessão anterior não publica no build novo. Interromper/revogar não altera fonte. Mesmo conteúdo em fontes distintas preserva proveniência, não funde fatos por similaridade.
- [ ] Rodar `node scripts/run-tests.mjs semantic-indexer`; RED.
- [ ] Implementar IDs determinísticos por sourceId/offset/token/fingerprint e vetor384 finito normalizado. Usar batch8 e fila02; checks antes/depois de tokenização/embedding, cifrar somente depois de revalidar token da fonte. Build atual só publica inteiro; nenhuma leitura mistura revisões.
- [ ] Mudanças durante reconstrução invalidam build; consolidar notificações pendentes numa reconstrução da revisão mais recente, sem fila infinita de versões. Não iniciar serviço externo. Reconstrução pode reaproveitar vetor do mesmo texto+fingerprint já validado, mas nunca texto antigo para responder sobre fonte editada.
- [ ] Repetir testes + typecheck; PASS, registrando consumo/tempo com corpus sintético pequeno e grande. Não gerar instalador nem índices de fatos reais.

## Task3 — ranking, orçamento e serviço de recall

**Files:** criar `src/main/memory/semantic/retrieval-policy.ts`, `retrieval.ts`, `service.ts`; testes `test/semantic-retrieval.test.ts`, `semantic-service.test.ts`; fixture `test/fixtures/semantic-memory/relevance-pt-br.json`.

**Interfaces:** `SemanticMemoryService({source,index,indexer,client,modelState,authorize,now}).recall(query:string,scope:SemanticScope):Promise<MemoryRecall>`; reindex/stop do00. `RetrievalPolicy={minCosine:number;semanticWeight:number;textWeight:number}` em retrieval-policy.ts; `rankMemories(query:string,chunks:MemoryChunk[],queryVector:number[]|null,policy:RetrievalPolicy):MemoryRecallHit[]` puro. `fitRecall(result:MemoryRecall):MemoryRecall` impõe orçamento real incluindo metadados.

- [ ] RED: fixture congelada contém paráfrases PT-BR (ambiente de trabalho/programas; preferência alimentar; projeto/nome próprio) e consultas sem relação; fonte esperada entra no top3, e pergunta sem relação retorna hits[]. Consultar índice não atualiza createdAt nem apaga menos relevantes.
- [ ] RED: texto exato de nome/caminho ajuda a localizar mesmo quando consulta é curta; stopwords isoladas não retornam todo corpus. Corrigir um fato com fonte nova substitui a recuperação anterior pelo ID/revisão; fato contraditório distinto não é apagado por ranking.
- [ ] RED: saída com emoji/aspas/controles tem no máximo8hits e6.144bytes serializados; trechos até2.000bytes em fronteira UTF-8. Não devolver texto de snapshot anterior depois de await/clear. Falha de fonte protegida retorna mode unavailable sem usar índice como autoridade alternativa.
- [ ] RED: modelo/index faltante ou worker excedendo3s usa apenas busca textual da fonte atual, mode text_only/warning; módulo desligado não prepara nem consulta embedding. Resultado degradado é visível. Bloquear rede no teste e assert zero downloads.
- [ ] Rodar `node scripts/run-tests.mjs semantic-retrieval` e `semantic-service`; RED.
- [ ] Implementar política inicial explícita: cosine mínimo0,55 para entrada semântica; score de ordenação0,75*cosine+0,25*cobertura de tokens informativos. Correspondência literal de nome/caminho/frase pode produzir hit textual independente do cutoff semântico. Normalizar case/acentos na busca textual, preservar texto original na entrega; lista fixa de stopwords em retrieval-policy.ts. Deduplicar por sourceId mantendo melhor chunk; score não é confiança factual.
- [ ] Qualidade é gate: não baixar cutoff silenciosamente só para passar exemplos. Se o candidato não distinguir positivos/negativos da fixture predefinida, reportar resultados e alternativas antes de alterar modelo/política. Primeiro testar ranking com vetores sintéticos conhecidos; depois repetir fixture no worker real02 para avaliar semântica, sem alegar que mocks medem qualidade em português.
- [ ] Contexto só usa build correspondente ao snapshot atual. Revalidar token e autoridade antes de entregar; uma mudança permite no máximo uma nova leitura textual do snapshot atual, depois memory_changed em vez de loop. Reindex não bloqueia a UI; recall pode degradar enquanto build estiver indisponível.
- [ ] Rodar domínio semantic-, typecheck, scanner e gate de relevância real. Atualizar progresso com scores observados, tamanhos, ausência de rede e limitações, não com promessa de aprendizagem de habilidades já implementada.

## Conclusão

03 produz recuperação local testável, ainda sem exposição no agente.04 liga o catálogo, contexto de conversa e painel, preservando compatibilidade e o protocolo estrito.
