import { memoryUnavailable } from './contracts'
/** Same admission transformation as the legacy sanitizer. Never run on stored/migrated facts. */
export function sanitizeNewFact(input: string): string {
  if (typeof input !== 'string' || input.length > 20000) throw memoryUnavailable()
  const value = input.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').trim().normalize('NFC')
  if (!value || value.length > 20000) throw memoryUnavailable()
  return value
}
export const factKey = (text: string): string => text.normalize('NFC').toLocaleLowerCase('pt-BR')
export function validateNewProfile(name: string, preferences: string[]): void {
  if (typeof name !== 'string' || name.length > 256 || !Array.isArray(preferences) || preferences.length > 256
    || preferences.some(value => typeof value !== 'string' || value.length > 2000)) throw memoryUnavailable()
}
