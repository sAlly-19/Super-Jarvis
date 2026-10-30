import type { MemoryRecall, MemoryRecallHit } from '../../../shared/types/semantic-memory'
import type { MemoryChunk } from './contracts'
import { informativeTokens, normalizeSearchText, type RetrievalPolicy } from './retrieval-policy'
import { validVectors } from './model-protocol'

export function rankMemories(query: string, chunks: MemoryChunk[], queryVector: number[] | null, policy: RetrievalPolicy): MemoryRecallHit[] {
  const tokens = informativeTokens(query)
  if (!tokens.length) return []
  if (queryVector && !validVectors([queryVector], 1)) throw new Error('invalid_query_vector')
  const phrase = normalizeSearchText(query), best = new Map<string, MemoryRecallHit>()
  const literalPhrase = new RegExp(`(?<![\\p{L}\\p{N}_])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u')
  for (const chunk of chunks) {
    const text = normalizeSearchText(chunk.text), terms = new Set(text.match(/[\p{L}\p{N}_-]+/gu) ?? [])
    const coverage = tokens.filter(token => terms.has(token)).length / tokens.length
    const literal = literalPhrase.test(text) || coverage >= 0.5
    let cosine = 0
    if (queryVector) {
      if (!validVectors([chunk.vector], 1)) throw new Error('invalid_chunk_vector')
      cosine = Math.max(-1, Math.min(1, chunk.vector.reduce((sum, value, i) => sum + value * queryVector[i], 0)))
    }
    if (!literal && (!queryVector || cosine < policy.minCosine)) continue
    let excerpt = chunk.text
    if (Buffer.byteLength(excerpt) > 2000) {
      // Retain the actual match before the later UTF-8/JSON truncation, without changing the stored fact.
      for (const match of excerpt.matchAll(/[\p{L}\p{M}\p{N}_-]+/gu)) {
        if (tokens.includes(normalizeSearchText(match[0]))) { excerpt = excerpt.slice(match.index); break }
      }
    }
    const hit: MemoryRecallHit = { sourceId: chunk.sourceId, sourceRevision: chunk.sourceRevision, kind: chunk.kind, text: excerpt,
      ...(chunk.createdAt === undefined ? {} : { createdAt: chunk.createdAt }), score: policy.semanticWeight * Math.max(0, cosine) + policy.textWeight * coverage }
    if (!best.has(hit.sourceId) || best.get(hit.sourceId)!.score < hit.score) best.set(hit.sourceId, hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0))
}
function truncateUtf8(text: string, bytes: number): string {
  let size = 0, result = ''
  for (const point of text) { const next = Buffer.byteLength(point); if (size + next > bytes) break; result += point; size += next }
  return result
}
/** Includes escaped text, all metadata and envelope, not just character counts. */
export function fitRecall(result: MemoryRecall): MemoryRecall {
  const output = structuredClone(result); output.hits = []
  if (output.mode === 'unavailable') return output
  const sources = new Set<string>()
  for (const value of result.hits) {
    if (sources.has(value.sourceId) || output.hits.length >= 8) continue
    const hit = { ...value, text: truncateUtf8(value.text, 2000) }
    output.hits.push(hit)
    if (Buffer.byteLength(JSON.stringify(output)) > 6144) {
      const points = Array.from(hit.text); let low = 0, high = points.length, best = ''
      while (low <= high) {
        const middle = Math.floor((low + high) / 2); hit.text = points.slice(0, middle).join('')
        if (Buffer.byteLength(JSON.stringify(output)) <= 6144) { best = hit.text; low = middle + 1 } else high = middle - 1
      }
      hit.text = best
      if (!hit.text) output.hits.pop()
      break
    }
    sources.add(value.sourceId)
  }
  return output
}
