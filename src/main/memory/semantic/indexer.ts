import type { MemorySource, EmbeddingClient, LocalTokenizer, SemanticScope, MemoryToken, MemoryChunk } from './contracts'
import { memoryCorpus, sameMemoryToken } from './corpus'
import { chunkSource } from './chunker'
import { SemanticIndexStore } from './index-store'
import { MODEL_FINGERPRINT, validVectors } from './model-protocol'
import { checkModelScope } from './model-files'
export class SemanticIndexer {
  private work?: Promise<void>
  private controller?: AbortController
  private stopped = false
  private dirty = false
  private readonly unsubscribe: () => void
  constructor(private readonly source: MemorySource, private readonly client: EmbeddingClient, private readonly index: SemanticIndexStore, private readonly tokenizer: LocalTokenizer) {
    this.unsubscribe = source.onChanged(() => { this.dirty = true; this.index.invalidate() })
  }
  rebuild(outer: SemanticScope): Promise<void> {
    try { checkModelScope(outer); if (this.stopped) throw new Error('indexer_stopped') } catch (cause) { return Promise.reject(cause) }
    if (this.work) return this.work.then(() => { checkModelScope(outer) })
    const controller = new AbortController(), abort = () => controller.abort()
    this.controller = controller
    outer.signal.addEventListener('abort', abort, { once: true })
    const scope: SemanticScope = { signal: controller.signal, deadline: outer.deadline, check: () => { outer.check(); if (this.stopped) throw new Error('indexer_stopped') } }
    const work = Promise.resolve().then(async () => {
      for (;;) {
        checkModelScope(scope); this.dirty = false
        const snapshot = this.source.snapshot(), token = snapshot.token
        const check = () => { checkModelScope(scope); if (!sameMemoryToken(this.source.snapshot().token, token)) throw new Error('memory_changed') }
        try {
          check(); const build = this.index.begin(token, MODEL_FINGERPRINT); check()
          let batch: Omit<MemoryChunk, 'vector'>[] = []
          const flush = async () => {
            if (!batch.length) return
            check(); const vectors = await this.client.embed(batch.map(chunk => chunk.text), scope); check()
            if (!validVectors(vectors, batch.length)) throw new Error('index_unavailable')
            this.index.append(build, batch.map((chunk, i) => ({ ...chunk, vector: vectors[i] })), check)
            batch = []
          }
          for (const source of memoryCorpus(snapshot)) {
            const chunks = await chunkSource(source, token, this.tokenizer, scope); check()
            for (const chunk of chunks) { batch.push(chunk); if (batch.length === 8) await flush() }
          }
          await flush(); check(); this.index.finish(build, token, check)
          if (!this.dirty) return
        } catch (cause) {
          this.index.invalidate(); checkModelScope(scope)
          if (!(cause instanceof Error) || cause.message !== 'memory_changed') throw cause
        }
        // All notifications collapse into the latest snapshot; no queue of old revisions.
      }
    }).finally(() => { outer.signal.removeEventListener('abort', abort); if (this.work === work) { this.work = undefined; this.controller = undefined } })
    this.work = work
    if (outer.signal.aborted) abort()
    return work
  }
  async stop(): Promise<void> {
    this.stopped = true; this.unsubscribe(); this.controller?.abort()
    await this.work?.catch(() => {})
    await this.client.stop()
  }
}
