import type { JasperMemory } from './memory'

export interface MemoryToken { generation: number; revision: number }
export interface PermanentMemorySnapshot { token: MemoryToken; memory: JasperMemory }
export interface ProtectedMemoryEnvelope { schemaVersion: 2; sealed: string }
export interface MemoryRecallHit { sourceId: string; sourceRevision: number; kind: 'fact' | 'name' | 'preference'; text: string; createdAt?: string; score: number }
export type MemoryRecall =
  | { mode: 'hybrid' | 'text_only'; token: MemoryToken; hits: MemoryRecallHit[]; warningCode?: string }
  | { mode: 'unavailable'; token: null; hits: MemoryRecallHit[]; warningCode?: string }
export type MemoryChange =
  | { kind: 'upsert_fact'; id?: string; text: string }
  | { kind: 'remove_fact'; id: string }
  | { kind: 'profile'; userName: string; userPreferences: string[] }
  | { kind: 'clear' }
