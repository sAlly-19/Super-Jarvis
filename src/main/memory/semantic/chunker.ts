import { createHash } from 'node:crypto'
import type { ChunkInput, LocalTokenizer, MemoryToken, SemanticScope } from './contracts'
import type { CorpusSource } from './corpus'
import { MODEL_FINGERPRINT } from './model-protocol'
import { checkModelScope } from './model-files'
export async function chunkSource(source: CorpusSource, token: MemoryToken, tokenizer: LocalTokenizer, scope: SemanticScope): Promise<ChunkInput[]> {
  checkModelScope(scope)
  const points = Array.from(source.text), result: ChunkInput[] = []
  let start = 0
  while (start < points.length) {
    checkModelScope(scope)
    const candidate = points.slice(start, start + 2048)
    const cache = new Map<string, number>()
    const count = async (text: string) => {
      checkModelScope(scope)
      const known = cache.get(text); if (known !== undefined) return known
      const values = await tokenizer.count([text], scope); checkModelScope(scope)
      if (values.length !== 1 || !Number.isSafeInteger(values[0]) || values[0] < 0 || values[0] > 65536) throw new Error('tokenizer_unavailable')
      cache.set(text, values[0]); return values[0]
    }
    const fitting = async (length: number, limit: number, suffix = false) => {
      const text = (n: number) => (suffix ? candidate.slice(candidate.length - n) : candidate.slice(0, n)).join('')
      if (length && await count(text(length)) <= limit) return length
      let low = 1, high = length, best = 0
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        if (await count(text(middle)) <= limit) { best = middle; low = middle + 1 } else high = middle - 1
      }
      return best
    }
    const length = await fitting(candidate.length, 96)
    if (!length) throw new Error('tokenizer_unavailable')
    const text = candidate.slice(0, length).join('')
    if (text.trim()) result.push({ id: createHash('sha256').update(JSON.stringify([source.sourceId, token.generation, token.revision, MODEL_FINGERPRINT, start, start + length])).digest('hex'),
      sourceId: source.sourceId, kind: source.kind, ...(source.createdAt === undefined ? {} : { createdAt: source.createdAt }),
      text, generation: token.generation, sourceRevision: token.revision, modelFingerprint: MODEL_FINGERPRINT })
    if (start + length >= points.length) break
    // Count suffixes ending at the actual chunk boundary, not at the candidate window boundary.
    const overlapCandidate = candidate.splice(0, length)
    candidate.splice(0, candidate.length, ...overlapCandidate)
    const overlap = await fitting(Math.max(0, length - 1), 16, true)
    start += Math.max(1, length - overlap)
  }
  checkModelScope(scope); return result
}
