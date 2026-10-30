import type { JasperMemory } from '../../../shared/types/memory'
import type { MemoryChange, MemoryToken, PermanentMemorySnapshot } from '../../../shared/types/semantic-memory'
export type { MemoryChange, MemoryToken, PermanentMemorySnapshot, ProtectedMemoryEnvelope } from '../../../shared/types/semantic-memory'
export interface MemoryProtection {
  available(): boolean
  encrypt(text: string): Uint8Array
  decrypt(bytes: Uint8Array): string
}
export interface MemorySource {
  snapshot(): PermanentMemorySnapshot
  mutate(change: MemoryChange, expected: MemoryToken): PermanentMemorySnapshot
  /** Main-only atomic replacement for token-tracked legacy load/edit/save. */
  replace(memory: JasperMemory, expected: MemoryToken): PermanentMemorySnapshot
  onChanged(callback: (token: MemoryToken) => void): () => void
}
export const MEMORY_PLAINTEXT_BYTES = 32 * 1024 * 1024
export const MEMORY_ENVELOPE_BYTES = 64 * 1024 * 1024
export const memoryUnavailable = (): Error => new Error('memory_unavailable')
export const memoryChanged = (): Error => new Error('memory_changed')
export interface SemanticScope { signal: AbortSignal; deadline: number; check(): void }
export interface EmbeddingClient { embed(texts: string[], scope: SemanticScope): Promise<number[][]>; stop(): Promise<void> }
export interface LocalTokenizer { count(texts: string[], scope: SemanticScope): Promise<number[]> }
export interface MemoryChunk {
  id: string; sourceId: string; sourceRevision: number; generation: number; modelFingerprint: string
  kind: 'fact' | 'name' | 'preference'; createdAt?: string; text: string; vector: number[]
}
export type ChunkInput = Omit<MemoryChunk, 'vector'>
