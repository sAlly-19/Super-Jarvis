import type { Writable } from 'node:stream'
import type { SemanticScope } from './contracts'
import type { ModelAsset } from './model-manifest-validator'
import type { ArtifactTransport } from './artifact-transport'
import { SEMANTIC_MODEL_MANIFEST } from './model-manifest'
import { checkModelScope } from './model-files'

export interface ModelState { phase: 'not_prepared' | 'downloading' | 'verifying' | 'ready' | 'cancelled' | 'error'; downloadedBytes: number; totalBytes: number; errorCode?: string }
export interface PreparationFiles {
  verify(scope: SemanticScope): Promise<boolean>
  createStaging(scope: SemanticScope): Promise<string>
  writer(staging: string, asset: ModelAsset, scope: SemanticScope): Promise<Writable>
  verifyStaging(staging: string, scope: SemanticScope): Promise<boolean>
  publish(staging: string, scope: SemanticScope): Promise<void>
  discard(staging: string): Promise<void>
  location(scope: SemanticScope): Promise<string>
}
type Probe = (root: string, scope: SemanticScope) => Promise<void>
export class ModelPreparation {
  private value: ModelState = { phase: 'not_prepared', downloadedBytes: 0, totalBytes: SEMANTIC_MODEL_MANIFEST.assets.reduce((sum, asset) => sum + asset.bytes, 0) }
  private consumers = new Set<SemanticScope>()
  private listeners = new Set<(state: ModelState) => void>()
  private controller?: AbortController
  private work?: Promise<void>
  private verification?: { controller: AbortController; work: Promise<ModelState> }
  private epoch = 0
  private stopped = false
  private lastEvent = 0
  constructor(private readonly files: PreparationFiles, private readonly transport: ArtifactTransport, private readonly probe: Probe) {}
  state(): ModelState { return { ...this.value } }
  onProgress(listener: (state: ModelState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<ModelState>, terminal = false) {
    this.value = { ...this.value, ...patch }
    if (!terminal && Date.now() - this.lastEvent < 250) return
    this.lastEvent = Date.now()
    for (const listener of this.listeners) { try { listener(this.state()) } catch { /* Observer cannot change preparation. */ } }
  }
  prepare(scope: SemanticScope): Promise<void> {
    try { checkModelScope(scope); if (this.stopped) throw new Error('model_stopped') }
    catch (cause) { return Promise.reject(cause) }
    this.consumers.add(scope)
    if (!this.work) {
      const controller = new AbortController(), epoch = ++this.epoch
      this.controller = controller
      const deadline = Date.now() + 600000
      const internal: SemanticScope = { signal: controller.signal, deadline, check: () => {
        if (epoch !== this.epoch || this.stopped) throw new Error('model_cancelled')
        let authorized = false
        for (const consumer of this.consumers) { try { checkModelScope(consumer); authorized = true; break } catch { /* Another consumer may still authorize this shared operation. */ } }
        if (!authorized) throw new Error('model_cancelled')
      } }
      const precedingVerification = this.verification?.work
      this.work = Promise.resolve().then(async () => {
        await precedingVerification?.catch(() => {})
        checkModelScope(internal)
        await this.run(internal, epoch)
      }).finally(() => {
        if (this.controller === controller) { this.work = undefined; this.controller = undefined }
      })
    }
    const work = this.work
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (cause?: unknown) => {
        if (settled) return; settled = true; clearTimeout(timer)
        scope.signal.removeEventListener('abort', abort); this.consumers.delete(scope)
        if (!this.consumers.size && this.work) this.controller?.abort()
        if (cause) reject(cause); else resolve()
      }
      const abort = () => finish(new Error('model_cancelled'))
      const timer = setTimeout(() => finish(new Error('model_timeout')), Math.max(0, Math.min(600000, scope.deadline - Date.now())))
      scope.signal.addEventListener('abort', abort, { once: true })
      work.then(() => { try { checkModelScope(scope); finish() } catch (cause) { finish(cause) } }, finish)
      if (scope.signal.aborted) abort()
    })
  }
  private async run(scope: SemanticScope, epoch: number) {
    let staging: string | undefined
    try {
      checkModelScope(scope)
      this.update({ phase: 'verifying', downloadedBytes: 0, errorCode: undefined })
      if (await this.files.verify(scope)) {
        await this.probe(await this.files.location(scope), scope); checkModelScope(scope)
        this.update({ phase: 'ready', downloadedBytes: this.value.totalBytes }, true); return
      }
      staging = await this.files.createStaging(scope); checkModelScope(scope)
      this.update({ phase: 'downloading' })
      for (const asset of SEMANTIC_MODEL_MANIFEST.assets) {
        const destination = await this.files.writer(staging, asset, scope)
        try {
          await this.transport.download(asset, SEMANTIC_MODEL_MANIFEST.revision, destination, scope, bytes => {
            checkModelScope(scope)
            this.update({ downloadedBytes: Math.min(this.value.totalBytes, this.value.downloadedBytes + bytes) })
          })
        } finally { if (!destination.destroyed) destination.destroy() }
        checkModelScope(scope)
      }
      this.update({ phase: 'verifying' })
      if (!await this.files.verifyStaging(staging, scope)) throw new Error('model_integrity_failed')
      await this.probe(staging, scope); checkModelScope(scope)
      await this.files.publish(staging, scope); staging = undefined
      checkModelScope(scope)
      this.update({ phase: 'ready', downloadedBytes: this.value.totalBytes }, true)
    } catch (cause) {
      if (epoch === this.epoch) this.update({ phase: scope.signal.aborted ? 'cancelled' : 'error', errorCode: scope.signal.aborted ? 'model_cancelled' : 'model_preparation_failed' }, true)
      throw new Error(scope.signal.aborted ? 'model_cancelled' : 'model_preparation_failed')
    } finally {
      if (staging) {
        try { await this.files.discard(staging) }
        catch { if (epoch === this.epoch) this.update({ phase: 'error', errorCode: 'model_cleanup_failed' }, true) }
      }
    }
  }
  verifyLocal(): Promise<ModelState> {
    if (this.stopped) return Promise.reject(new Error('model_stopped'))
    if (this.work) return Promise.resolve(this.state())
    if (this.verification) return this.verification.work
    const epoch = this.epoch, controller = new AbortController()
    const scope: SemanticScope = { signal: controller.signal, deadline: Date.now() + 20000, check: () => {
      if (epoch !== this.epoch || this.stopped) throw new Error('model_cancelled')
    } }
    const work = Promise.resolve().then(async () => {
      checkModelScope(scope)
      const valid = await this.files.verify(scope); checkModelScope(scope)
      if (valid) {
        try { await this.probe(await this.files.location(scope), scope); checkModelScope(scope) }
        catch {
          checkModelScope(scope)
          if (!this.work) this.update({ phase: 'error', errorCode: 'model_load_failed' }, true)
          return this.state()
        }
      }
      checkModelScope(scope)
      if (!this.work) this.update({ phase: valid ? 'ready' : 'not_prepared', errorCode: undefined }, true)
      return this.state()
    }).finally(() => { if (this.verification?.controller === controller) this.verification = undefined })
    this.verification = { controller, work }
    return work
  }
  async cancel(): Promise<void> {
    this.epoch++; this.controller?.abort(); this.verification?.controller.abort()
    this.update({ phase: 'cancelled', errorCode: 'model_cancelled' }, true)
  }
  async stop(): Promise<void> {
    this.stopped = true
    await this.cancel()
    await Promise.allSettled([this.work, this.verification?.work])
  }
}
