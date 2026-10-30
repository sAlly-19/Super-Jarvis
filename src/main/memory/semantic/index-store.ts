import { createHash, randomUUID } from 'node:crypto'
import type { StateDatabase, StateTransaction } from '../../storage/state-database'
import type { MemoryProtection, MemoryToken, MemoryChunk } from './contracts'
import { exactObject, validateMemoryToken } from './source-codec'
import { IndexCodec, indexUnavailable, validateIndexChunk } from './index-codec'
const digest = (ids: string[]) => createHash('sha256').update(ids.sort().join('\n')).digest('hex')
export class SemanticIndexStore {
  private readonly codec: IndexCodec
  private epoch = 0
  private invalidated = false
  private busy = false
  private pendingRemoval = false
  constructor(private readonly database: StateDatabase, private readonly protection: MemoryProtection) { this.codec = new IndexCodec(protection) }
  private transaction<T>(run: (tx: StateTransaction) => T): T {
    if (this.busy) throw indexUnavailable()
    this.busy = true
    try { return this.database.transaction(run) } finally { this.busy = false; this.flushRemoval() }
  }
  private flushRemoval() {
    if (this.busy || !this.pendingRemoval) return
    try {
      this.database.transaction(tx => { tx.prepare('DELETE FROM semantic_index_builds').run() })
      this.pendingRemoval = false
    } catch { /* Logically unavailable already; retry cleanup on the next access, never block canonical mutations. */ }
  }
  private valid(token: MemoryToken, fingerprint: string) {
    try { validateMemoryToken(token) } catch { throw indexUnavailable() }
    if (!this.protection.available() || !/^[a-f0-9]{64}$/.test(fingerprint)) throw indexUnavailable()
  }
  begin(token: MemoryToken, modelFingerprint: string): string {
    this.valid(token, modelFingerprint)
    this.flushRemoval(); if (this.pendingRemoval) throw indexUnavailable()
    const id = randomUUID()
    this.transaction(tx => {
      tx.prepare('DELETE FROM semantic_index_builds').run()
      tx.prepare("INSERT INTO semantic_index_builds(id,generation,source_revision,model_fingerprint,state) VALUES(?,?,?,?,'building')").run(id, token.generation, token.revision, modelFingerprint)
    })
    this.invalidated = false; return id
  }
  append(buildId: string, chunks: MemoryChunk[], check: () => void) {
    const epoch = this.epoch
    this.transaction(tx => {
      check()
      const build = tx.prepare("SELECT * FROM semantic_index_builds WHERE id=? AND state='building'").get(buildId)
      if (!build || this.invalidated) throw indexUnavailable()
      for (const chunk of chunks) {
        validateIndexChunk(chunk)
        if (chunk.generation !== build.generation || chunk.sourceRevision !== build.source_revision || chunk.modelFingerprint !== build.model_fingerprint) throw indexUnavailable()
        const sealed = this.codec.seal({ schemaVersion: 1, buildId, chunk })
        check(); if (epoch !== this.epoch || this.invalidated) throw indexUnavailable()
        tx.prepare('INSERT INTO semantic_index_chunks(build_id,id,sealed_chunk) VALUES(?,?,?)').run(buildId, chunk.id, sealed)
      }
      check(); if (epoch !== this.epoch || this.invalidated) throw indexUnavailable()
    })
  }
  finish(buildId: string, token: MemoryToken, check: () => void) {
    const epoch = this.epoch
    this.transaction(tx => {
      check()
      const build = tx.prepare("SELECT * FROM semantic_index_builds WHERE id=? AND state='building'").get(buildId)
      if (!build || build.generation !== token.generation || build.source_revision !== token.revision || this.invalidated) throw indexUnavailable()
      const ids = tx.prepare('SELECT id FROM semantic_index_chunks WHERE build_id=? ORDER BY id').all(buildId).map(row => String(row.id))
      // A protected completion receipt detects lost rows instead of accepting a corrupt empty/partial build.
      const sealed = this.codec.seal({ schemaVersion: 1, buildId, token, fingerprint: build.model_fingerprint, count: ids.length, digest: digest(ids) })
      check(); if (epoch !== this.epoch || this.invalidated) throw indexUnavailable()
      tx.prepare('INSERT INTO semantic_index_chunks(build_id,id,sealed_chunk) VALUES(?,?,?)').run(buildId, 'manifest', sealed)
      tx.prepare("UPDATE semantic_index_builds SET state='ready' WHERE id=?").run(buildId)
      check(); if (epoch !== this.epoch || this.invalidated) throw indexUnavailable()
    })
  }
  read(token: MemoryToken, fingerprint: string, check: () => void): MemoryChunk[] | null {
    check(); const epoch = this.epoch
    try {
      this.valid(token, fingerprint)
      if (this.invalidated) { this.flushRemoval(); return null }
      return this.transaction(tx => {
        const build = tx.prepare("SELECT id FROM semantic_index_builds WHERE generation=? AND source_revision=? AND model_fingerprint=? AND state='ready'").get(token.generation, token.revision, fingerprint)
        if (!build) return null
        const receiptRow = tx.prepare("SELECT sealed_chunk FROM semantic_index_chunks WHERE build_id=? AND id='manifest'").get(String(build.id))
        const receipt = this.codec.open(receiptRow?.sealed_chunk)
        if (!exactObject(receipt, ['schemaVersion', 'buildId', 'token', 'fingerprint', 'count', 'digest']) || receipt.schemaVersion !== 1 || receipt.buildId !== build.id ||
          receipt.fingerprint !== fingerprint || !exactObject(receipt.token, ['generation', 'revision']) || receipt.token.generation !== token.generation || receipt.token.revision !== token.revision ||
          !Number.isSafeInteger(receipt.count) || Number(receipt.count) < 0) throw indexUnavailable()
        const result: MemoryChunk[] = []
        for (let offset = 0; ; offset += 128) {
          check()
          const rows = tx.prepare("SELECT id,sealed_chunk FROM semantic_index_chunks WHERE build_id=? AND id<>'manifest' ORDER BY id LIMIT 128 OFFSET ?").all(String(build.id), offset)
          for (const row of rows) {
            const envelope = this.codec.open(row.sealed_chunk)
            if (!exactObject(envelope, ['schemaVersion', 'buildId', 'chunk']) || envelope.schemaVersion !== 1 || envelope.buildId !== build.id) throw indexUnavailable()
            validateIndexChunk(envelope.chunk)
            const chunk = envelope.chunk
            if (chunk.id !== row.id || chunk.generation !== token.generation || chunk.sourceRevision !== token.revision || chunk.modelFingerprint !== fingerprint) throw indexUnavailable()
            result.push(chunk); check()
          }
          if (rows.length < 128) break
        }
        if (result.length !== receipt.count || digest(result.map(chunk => chunk.id)) !== receipt.digest) throw indexUnavailable()
        check(); if (epoch !== this.epoch || this.invalidated) throw indexUnavailable()
        return result
      })
    } catch { check(); return null }
  }
  invalidate() {
    this.epoch++; this.invalidated = true
    this.pendingRemoval = true; this.flushRemoval()
  }
}
