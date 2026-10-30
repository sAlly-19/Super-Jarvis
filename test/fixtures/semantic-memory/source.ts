import type { JasperMemory } from '../../../src/shared/types/memory'
export const installationId = 'HWID-SYNTHETIC-MEMORY'
export const oldMemory = (): JasperMemory => ({ installationId, updatedAt: '2020-01-02T12:00:00.000Z',
  userName: 'Synthetic user', userPreferences: ['Preferir TypeScript'],
  facts: [{ id: 'legacy-1', fact: 'Synthetic sentinel &amp; old preference', createdAt: '2020-01-01T12:00:00.000Z' }] })
const mask = (bytes: Uint8Array) => Uint8Array.from(bytes, byte => byte ^ 0xa5)
export const protection = { available: () => true, encrypt: (text: string) => mask(Buffer.from(text, 'utf8')),
  decrypt: (bytes: Uint8Array) => Buffer.from(mask(bytes)).toString('utf8') }
