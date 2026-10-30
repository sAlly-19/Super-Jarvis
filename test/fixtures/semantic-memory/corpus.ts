import type { MemorySource, MemoryToken, PermanentMemorySnapshot } from '../../../src/main/memory/semantic/contracts'
export function syntheticSource(): MemorySource & { change(text?: string): void } {
  let value: PermanentMemorySnapshot = { token: { generation: 0, revision: 0 }, memory: { userName: 'Ana', userPreferences: ['Café sem açúcar'], facts: [{ id: 'profile:name', fact: 'Studio &amp; editor', createdAt: '2020-01-01' }] } }
  const listeners = new Set<(token: MemoryToken) => void>()
  return { snapshot: () => structuredClone(value),
    mutate() { throw Error('unused') }, replace() { throw Error('unused') },
    onChanged(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    change(text) { value = { ...value, token: { generation: value.token.generation + (text === undefined ? 1 : 0), revision: value.token.revision + 1 }, memory: { ...value.memory, facts: text === undefined ? [] : [{ id: 'profile:name', fact: text, createdAt: '2020-01-01' }] } }; for (const listener of listeners) listener(value.token) }
  }
}
export const testTokenizer = { async count(texts: string[]) { return texts.map(text => Array.from(text).length + 2) } }
export const unitVector = () => Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)
