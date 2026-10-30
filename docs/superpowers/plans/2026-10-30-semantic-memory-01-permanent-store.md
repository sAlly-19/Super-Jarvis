# Memória01 — fonte permanente e migração protegida

**Estado30/10:** concluído em componentes isolados. Domínio14/14, verify445/445, tipos/build dev aprovados, scanner565. Uma revisão independente, nenhum Critical/Important; Minor corrigido RED→GREEN. Fonte ativa/perfil real não migrados; composição só04. [Progresso](2026-10-30-semantic-memory-progress.md).

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, método nativo/main preservado. TDD por tarefa; revisão final do conjunto, sem commits automáticos.

**Goal:** Preservar fatos/preferências existentes sem expiração, com edição/exclusão versionadas e proteção local.

**Architecture:** Novo MemorySource é o único proprietário do JSON quando04 fizer a troca. Antes disso, testar componentes em arquivos sintéticos, sem apontar o novo store ao perfil real. Índice não é fonte canônica.

**Tech Stack:** TypeScript, fs, safeStorage injetável, escrita atômica existente como referência; sem pacote novo.

**Spec:** [desenho aprovado](../specs/2026-10-30-semantic-memory-design-draft.md); [contratos00](2026-10-30-semantic-memory-00-execution-map.md).

## Global Constraints

Todas as restrições/limites00. Nenhum TTL; erro não vira fonte vazia; preservar APIs legadas e instalação. Métodos síncronos, sem await entre leitura de token e commit. Não reescrever atomic-json de configuração global por conveniência. Migração real fica04, não no import do módulo.

## Review Focus

1. Fato de meses atrás não some na primeira leitura nem no save —T1/T2.
2. Documento inválido ou de outra instalação não é substituído —T1/T2.
3. Migração interrompida/falha de rename conserva fonte original utilizável —T2.
4. Escrita com token anterior ao clear não recria fato —T2.
5. Migração não cria backup plaintext nem transforma sanitização antiga em escape duplicado —T2/T3.

## Task1 — DTOs e codec protegido

**Files:** criar `src/shared/types/semantic-memory.ts`, `src/main/memory/semantic/contracts.ts`, `source-codec.ts`; testes `test/semantic-source-codec.test.ts`, fixture `test/fixtures/semantic-memory/source.ts`. Exportar shared/index. Não substituir memory.ts ainda.

**Interfaces:** tipos00. `SourceCodec(protection:MemoryProtection).encode(snapshot:PermanentMemorySnapshot,installationId:string):ProtectedMemoryEnvelope`; `decode(envelope:unknown,installationId:string):PermanentMemorySnapshot`. Envelope exato `{schemaVersion:2,sealed:string}` com bytes cifrados em base64; conteúdo cifrado exato `{installationId,token,profile}`. Arquivo em disco só envelope; IDs/datas/fatos não ficam claros nele.

- [x] Escrever teste `permanent_source_roundtrips_protected_document_without_age_filter`: fato antigo válido e preferência retornam idênticos, incluindo createdAt; cipher fake reversível não equivale a plaintext; chaves extras/tokens inválidos/ID duplicado/cipher corrupto rejeitados com memory_unavailable.
- [x] Escrever teste de bytes: plaintext32MiB/envelope64MiB, Unicode/aspas entram em bytes reais; proteção falsa ou encrypt/decrypt que lança não produz envelope vazio nem expõe mensagem privada. Preservar strings legadas já escapadas, sem chamar sanitizeFact novamente no decode.
- [x] Rodar `node scripts/run-tests.mjs semantic-source-codec`; observar RED por módulo ausente.
- [x] Implementar codec e validação estrita. Memória vazia só é válida quando documento real é vazio ou clear explícito; ausência de arquivo é tratada pelo store, não por catch genérico do codec.
- [x] Repetir teste e `npm run typecheck`; PASS. Registrar fake crypto como teste de contrato, não prova de DPAPI Windows.

## Task2 — migração atômica e mutações com token

**Files:** criar `src/main/memory/semantic/permanent-store.ts`, `source-file.ts`; testes `test/semantic-permanent-store.test.ts`. Reutilizar tipos memory.ts sem executar seu load.

**Interfaces:** `PermanentMemoryStore({filePath,installationId,protection,authorize,now,id,onChanged}) implements MemorySource`; `initialize():void`, snapshot/mutate/onChanged do00. `source-file.ts` fornece leitura com teto e `commitProtected(filePath,envelope,expectedFingerprint):void`, sem fallback de caminho ou documento em caso de erro.

- [x] Escrever `legacy_migration_keeps_facts_older_than_30_days`: criar JSONv1 sintético com nome/preferências/fato de2020; initialize/snapshot não removem nada; v2 cifra tudo e mantém IDs válidos. source fingerprint/token impede sobrescrever uma alteração externa detectada antes do commit.
- [x] Escrever `migration_failure_preserves_original`: proteção falsa, arquivo malformado, data inválida/ID duplicado, HWID diferente, disco cheio/rename negado e principal ausente com backup legado. Assert hash do original não muda em falha; não chamar load antigo nem gravar freshDefault.
- [x] Escrever `clear_and_edit_reject_stale_writes`: mutate upsert, editar pelo ID, remover, perfil e clear incrementam revision; clear incrementa generation. Uma atualização com token antigo lança memory_changed e não recria fato. Limite de tamanho rejeita só a nova escrita, sem podar fatos antigos.
- [x] Escrever `protected_migration_backup_and_sanitization_are_lossless`: backup recuperável da migração contém envelope cifrado do original, não cópia plaintext. A fonte original preexistente pode estar plaintext até migração; não prometer apagamento forense. `&amp;` armazenado pelo legado não vira `&amp;amp;`; sanitização só na admissão de texto novo.
- [x] Rodar `node scripts/run-tests.mjs semantic-permanent-store`; RED.
- [x] Implementar detecção v1/v2 antes de qualquer rotina com TTL. Ausência verdadeira de fonte e backups permite criar vazia sob autoridade. Principal/backup presente e inválido exige erro explícito, não reset automático. Não apagar JSONs/configurações externas.
- [x] Migração: validar v1 sem filtros por idade; produzir envelope/backup cifrados antes de substituir original; revalidar autoridade e fingerprint; temp no mesmo diretório, flush+fechar, rename com substituição atômica. Não unlink original antes do rename; se Windows não permitir substituição, preservar original e falhar. Não usar a primeira migração para criar `.bak` plaintext via atomic-json genérico. Escritas v2 preservam recuperação de versão íntegra.
- [x] Publicar mudanças somente depois do commit; callback não pode transformar sucesso de commit em falso rollback. Revalidar autoridade depois de encrypt e antes de rename. Clear é exclusão lógica e preserva backups cifrados para recuperação conforme política documentada; não promete apagar WAL/backups.
- [x] Repetir testes + typecheck; PASS. Testes usam mkdtemp; sem perfil real ou inferência.

## Task3 — adaptador legado e orçamento de apresentação

**Files:** criar `src/main/memory/semantic/legacy-adapter.ts`; testes `test/semantic-legacy-adapter.test.ts`; consultar `test/memory-sync.test.ts` para contratos existentes. A composição de src/main/memory.ts muda só04.

**Interfaces:** `LegacyMemoryAdapter(source:MemorySource,now:()=>string)` fornece load/save/addFact/upsertFacts/clear/getSummary. load associa o objeto ao token via WeakMap; `save(memory:JasperMemory,expectedToken?:MemoryToken):void` valida token rastreado ou explícito, rejeitando objeto sem origem. Isso conserva a chamada load→editar→save e impede substituir tudo por snapshot obsoleto. `upsertFacts` não aceita timestamp/ID do sidecar como autoridade nova; preservar assinatura externa onde necessário, atribuindo metadados no Main. Escritores assíncronos04 usam token capturado em vez de save cego.

- [x] RED: load antigo continua retornando JasperMemory, mas snapshot suporta token; add/upsert deduplica somente texto normalizado idêntico, não por aproximação semântica; perfil e fatos antigos permanecem em todas as gravações.
- [x] RED: erro de proteção propaga estado indisponível; load→clear→save(objeto antigo) rejeita mesmo sem await; objeto externo sem token também rejeita. getSummary é limitado para não transformar memória permanente em prompt ilimitado. Não mutar fonte ao montar resumo.
- [x] Rodar `node scripts/run-tests.mjs semantic-legacy-adapter`; RED.
- [x] Implementar adaptador compatível e usar o mesmo sanitizador de admissão, sem duplicar fonte. IDs de fatos existentes são preservados; não atualizar datas ao consultar. Documentar diferenças intencionais nos testes antigos que esperavam expiração/reset por HWID — essas expectativas serão substituídas na composição04, não afrouxadas em silêncio.
- [x] Rodar `node scripts/run-tests.mjs semantic-`, typecheck e scanner. Atualizar progresso/ledger com arquivos, RED/GREEN, limites e migração ainda não ligada ao perfil.

## Conclusão e handoff

01 pronto significa fonte/adaptador testados em arquivos sintéticos. Não significa mudança já publicada no aplicativo, modelo baixado ou skill aprendida. Próximo02 prepara o recurso em isolamento;04 liga a fonte única antes de qualquer snapshot legado.
