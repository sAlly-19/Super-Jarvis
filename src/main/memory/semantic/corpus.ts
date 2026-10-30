import type { PermanentMemorySnapshot, MemoryToken } from './contracts'
export interface CorpusSource { sourceId: string; kind: 'fact' | 'name' | 'preference'; text: string; createdAt?: string }
export const sameMemoryToken = (a: MemoryToken, b: MemoryToken) => a.generation === b.generation && a.revision === b.revision
export function memoryCorpus(snapshot: PermanentMemorySnapshot): CorpusSource[] {
  const result: CorpusSource[] = []
  if (snapshot.memory.userName.trim()) result.push({ sourceId: 'profile:name', kind: 'name', text: snapshot.memory.userName })
  snapshot.memory.userPreferences.forEach((text, i) => { if (text.trim()) result.push({ sourceId: `profile:preference:${i}`, kind: 'preference', text }) })
  for (const item of snapshot.memory.facts) result.push({ sourceId: `fact:${item.id}`, kind: 'fact', text: item.fact, createdAt: item.createdAt })
  return result
}
