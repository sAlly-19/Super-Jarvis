import type { WebResearchNote } from '../../../shared/types/web-research'
import { isResearchId } from './history-codec'
export function validateWebNote(value: unknown): asserts value is WebResearchNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_web_note')
  const note = value as Record<string, unknown>
  if (Object.keys(note).length !== 4 || !['researchId', 'ticket', 'sessionId', 'summary'].every(key => Object.hasOwn(note, key))
    || !isResearchId(note.researchId) || typeof note.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(note.ticket)
    || !Number.isSafeInteger(note.sessionId) || Number(note.sessionId) < 0 || typeof note.summary !== 'string' || note.summary.length > 4000) throw Error('invalid_web_note')
}
