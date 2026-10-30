import { SEMANTIC_MODEL_MANIFEST } from './model-manifest'
import { modelFingerprint } from './model-manifest-validator'

export const MODEL_FINGERPRINT = modelFingerprint(SEMANTIC_MODEL_MANIFEST)
export interface ModelOperations { embed(texts: string[]): Promise<number[][]>; count(texts: string[]): Promise<number[]> }
export const modelRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export function validModelTexts(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 8 && value.every(text => typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= 16384)
}
export function validVectors(value: unknown, count: number): value is number[][] {
  return Array.isArray(value) && value.length === count && value.every(vector => Array.isArray(vector) && vector.length === 384 &&
    vector.every(n => typeof n === 'number' && Number.isFinite(n)) && Math.abs(vector.reduce((sum, n) => sum + n * n, 0) - 1) <= 0.002)
}
export function validCounts(value: unknown, count: number): value is number[] {
  return Array.isArray(value) && value.length === count && value.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 65536)
}
export async function handleModelRequest(value: unknown, operations: ModelOperations) {
  const id = modelRecord(value) && typeof value.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value.id) ? value.id : 'invalid'
  const error = (code: string) => ({ id, type: 'error' as const, code, modelFingerprint: MODEL_FINGERPRINT })
  if (!modelRecord(value) || Object.keys(value).length !== 4 || !['id', 'type', 'texts', 'modelFingerprint'].every(key => Object.hasOwn(value, key)) ||
    id === 'invalid' || !validModelTexts(value.texts) || value.modelFingerprint !== MODEL_FINGERPRINT || !['embed', 'count'].includes(value.type as string)) return error('model_protocol_error')
  try {
    if (value.type === 'embed') {
      const vectors = await operations.embed(value.texts)
      if (!validVectors(vectors, value.texts.length)) return error('model_protocol_error')
      return { id, type: 'result' as const, vectors, modelFingerprint: MODEL_FINGERPRINT }
    }
    const counts = await operations.count(value.texts)
    if (!validCounts(counts, value.texts.length)) return error('model_protocol_error')
    return { id, type: 'counts' as const, counts, modelFingerprint: MODEL_FINGERPRINT }
  } catch (cause) { return error(cause instanceof Error && cause.message === 'model_not_prepared' ? 'model_not_prepared' : 'model_failed') }
}
