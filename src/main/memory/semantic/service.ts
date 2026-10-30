import type { MemoryRecall } from '../../../shared/types/semantic-memory'
import type { MemorySource, EmbeddingClient, SemanticScope, PermanentMemorySnapshot, MemoryChunk } from './contracts'
import type { SemanticIndexStore } from './index-store'
import type { SemanticIndexer } from './indexer'
import { MODEL_FINGERPRINT, validVectors } from './model-protocol'
import { memoryCorpus, sameMemoryToken } from './corpus'
import { rankMemories, fitRecall } from './retrieval'
import { RETRIEVAL_POLICY } from './retrieval-policy'
import { withinWebScope } from '../../modules/web-research/contracts'
interface Dependencies {
  source: MemorySource; index: SemanticIndexStore; indexer: Pick<SemanticIndexer, 'rebuild' | 'stop'>; client: EmbeddingClient
  modelState(): { phase: string }; authorize(): void; now(): number
}
const unavailable = (): MemoryRecall => ({ mode: 'unavailable', token: null, hits: [], warningCode: 'memory_unavailable' })
export class SemanticMemoryService {
  private stopped = false
  private controllers = new Set<AbortController>()
  private tasks = new Set<Promise<MemoryRecall>>()
  constructor(private readonly deps: Dependencies) {}
  private check(scope: SemanticScope) {
    scope.check(); scope.signal.throwIfAborted(); this.deps.authorize()
    if (this.stopped) throw new Error('semantic_memory_stopped')
    if (!Number.isFinite(scope.deadline) || this.deps.now() >= scope.deadline) throw new Error('memory_timeout')
  }
  recall(query: string, outer: SemanticScope): Promise<MemoryRecall> {
    try { this.check(outer); if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw new Error('invalid_memory_query') }
    catch (cause) { return Promise.reject(cause) }
    const controller = new AbortController(), abort = () => controller.abort()
    this.controllers.add(controller); outer.signal.addEventListener('abort', abort, { once: true })
    const scope: SemanticScope = { signal: controller.signal, deadline: Math.min(outer.deadline, this.deps.now() + 3000), check: () => { outer.check(); this.deps.authorize() } }
    const task = Promise.resolve().then(() => this.run(query, scope)).finally(() => { this.controllers.delete(controller); this.tasks.delete(task); outer.signal.removeEventListener('abort', abort) })
    this.tasks.add(task)
    if (outer.signal.aborted) abort()
    return task
  }
  private snapshot(scope: SemanticScope): PermanentMemorySnapshot | null {
    this.check(scope)
    try { const value = this.deps.source.snapshot(); this.check(scope); return value }
    catch { this.check(scope); return null }
  }
  private textual(query: string, snapshot: PermanentMemorySnapshot, warningCode: string): MemoryRecall {
    const chunks: MemoryChunk[] = memoryCorpus(snapshot).map((source, i) => ({ ...source, id: String(i), sourceRevision: snapshot.token.revision,
      generation: snapshot.token.generation, modelFingerprint: MODEL_FINGERPRINT, vector: [] }))
    return { mode: 'text_only', token: snapshot.token, hits: rankMemories(query, chunks, null, RETRIEVAL_POLICY), warningCode }
  }
  private deliver(query: string, result: MemoryRecall, used: PermanentMemorySnapshot, scope: SemanticScope, retried = false): MemoryRecall {
    const current = this.snapshot(scope)
    if (!current) return unavailable()
    if (!sameMemoryToken(current.token, used.token)) {
      if (retried) throw new Error('memory_changed')
      return this.deliver(query, this.textual(query, current, 'memory_changed'), current, scope, true)
    }
    const fitted = fitRecall(result); this.check(scope); return fitted
  }
  private async run(query: string, scope: SemanticScope): Promise<MemoryRecall> {
    const snapshot = this.snapshot(scope)
    if (!snapshot) return unavailable()
    let warning = 'model_not_ready'
    if (this.deps.modelState().phase === 'ready') {
      warning = 'index_unavailable'
      const chunks = this.deps.index.read(snapshot.token, MODEL_FINGERPRINT, () => this.check(scope))
      if (chunks) {
        let result: MemoryRecall | undefined
        try {
          // Reserve a small part of the overall3s for authorized textual fallback and delivery.
          const embeddingScope = { ...scope, deadline: scope.deadline - 100 }
          const vectors = await withinWebScope(embeddingScope, () => this.deps.client.embed([query], embeddingScope), this.deps.now)
          this.check(scope)
          if (!validVectors(vectors, 1)) throw new Error('invalid_query_vector')
          result = { mode: 'hybrid', token: snapshot.token, hits: rankMemories(query, chunks, vectors[0], RETRIEVAL_POLICY) }
        } catch { this.check(scope); warning = 'embedding_unavailable' }
        // Delivery conflicts must not be swallowed as an embedding failure and retried again.
        if (result) return this.deliver(query, result, snapshot, scope)
      }
    }
    const current = this.snapshot(scope)
    if (!current) return unavailable()
    return this.deliver(query, this.textual(query, current, sameMemoryToken(current.token, snapshot.token) ? warning : 'memory_changed'), current, scope, !sameMemoryToken(current.token, snapshot.token))
  }
  async reindex(scope: SemanticScope): Promise<void> {
    this.check(scope)
    if (this.deps.modelState().phase !== 'ready') throw new Error('model_not_ready')
    await this.deps.indexer.rebuild({ ...scope, check: () => { this.check(scope) } }); this.check(scope)
  }
  async stop(): Promise<void> {
    this.stopped = true
    for (const controller of this.controllers) controller.abort()
    await this.deps.indexer.stop()
    await Promise.allSettled([...this.tasks])
    await this.deps.client.stop()
  }
}
