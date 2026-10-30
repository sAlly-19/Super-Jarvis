import { createHash, randomUUID } from 'node:crypto'
import { constants, renameSync } from 'node:fs'
import { lstat, open, readdir, realpath, mkdir, mkdtemp, rename, unlink, rmdir } from 'node:fs/promises'
import { isAbsolute, join, resolve, parse, relative, dirname, basename } from 'node:path'
import type { SemanticScope } from './contracts'
import { validateModelManifest, modelFingerprint, type ModelAsset } from './model-manifest-validator'
import { SEMANTIC_MODEL_MANIFEST } from './model-manifest'

export function checkModelScope(scope: SemanticScope) {
  scope.check(); scope.signal.throwIfAborted()
  if (!Number.isFinite(scope.deadline) || Date.now() >= scope.deadline) throw new Error('model_timeout')
}

async function checkedDirectory(root: string, create = false): Promise<void> {
  if (!isAbsolute(root)) throw new Error('model_path_invalid')
  let current = parse(root).root
  for (const component of relative(current, resolve(root)).split(/[\\/]/).filter(Boolean)) {
    current = join(current, component)
    if (create) { try { await mkdir(current, { mode: 0o700 }) } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause } }
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('model_path_invalid')
  }
}
/** Main-only transaction helper. The production subclass accepts only the closed distributed manifest. */
export class ModelFileTransaction {
  private readonly owned = new Map<string, { ino: number; dev: number }>()
  private readonly moved = new Set<string>()
  constructor(protected readonly root: string, private readonly assets: readonly ModelAsset[], private readonly fingerprint: string) {}
  async createStaging(scope: SemanticScope): Promise<string> {
    checkModelScope(scope); await checkedDirectory(this.root, true); checkModelScope(scope)
    const staging = await mkdtemp(join(this.root, '.staging-'))
    const stat = await lstat(staging); this.owned.set(staging, { ino: stat.ino, dev: stat.dev })
    try { checkModelScope(scope); return staging }
    catch (cause) { await this.discard(staging); throw cause }
  }
  private async ownedStage(staging: string) {
    if (dirname(staging) !== this.root || !basename(staging).startsWith('.staging-') || !this.owned.has(staging)) throw new Error('model_staging_invalid')
    await checkedDirectory(staging)
    const stat = await lstat(staging), identity = this.owned.get(staging)!
    if (stat.ino !== identity.ino || stat.dev !== identity.dev) throw new Error('model_staging_invalid')
  }
  async writer(staging: string, asset: ModelAsset, scope: SemanticScope) {
    checkModelScope(scope); await this.ownedStage(staging)
    if (!this.assets.some(item => item.path === asset.path && item.bytes === asset.bytes && item.sha256 === asset.sha256) ||
      !SEMANTIC_MODEL_MANIFEST.assets.some(item => item.path === asset.path)) throw new Error('model_staging_invalid')
    const filename = join(staging, ...asset.path.split('/'))
    await checkedDirectory(dirname(filename), true); checkModelScope(scope)
    const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600)
    try { await this.ownedStage(staging); checkModelScope(scope); return file.createWriteStream({ autoClose: true }) }
    catch (cause) { await file.close(); throw cause }
  }
  async verifyStaging(staging: string, scope: SemanticScope) {
    await this.ownedStage(staging)
    return verifyModelAssets(staging, this.assets, scope)
  }
  async location(scope: SemanticScope): Promise<string> {
    checkModelScope(scope); await checkedDirectory(this.root)
    const filename = join(this.root, 'active.json'), stat = await lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('model_not_prepared')
    const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    let value: unknown
    try {
      const opened = await file.stat()
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > 1024) throw new Error('model_not_prepared')
      const buffer = Buffer.alloc(1025), read = await file.read(buffer, 0, buffer.length, 0)
      if (read.bytesRead !== opened.size || read.bytesRead > 1024) throw new Error('model_not_prepared')
      value = JSON.parse(buffer.subarray(0, read.bytesRead).toString('utf8'))
    } finally { await file.close() }
    const pointer = value as Record<string, unknown>
    if (!pointer || typeof pointer !== 'object' || Object.keys(pointer).length !== 3 || pointer.schemaVersion !== 1 || pointer.fingerprint !== this.fingerprint ||
      typeof pointer.directory !== 'string' || !/^model-[a-f0-9-]{36}$/.test(pointer.directory)) throw new Error('model_not_prepared')
    const root = join(this.root, pointer.directory); await checkedDirectory(root); checkModelScope(scope)
    return root
  }
  async verify(scope: SemanticScope): Promise<boolean> {
    try { return await verifyModelAssets(await this.location(scope), this.assets, scope) }
    catch { checkModelScope(scope); return false }
  }
  async publish(staging: string, scope: SemanticScope): Promise<void> {
    checkModelScope(scope); await this.ownedStage(staging)
    if (!await this.verifyStaging(staging, scope)) throw new Error('model_integrity_failed')
    for (const asset of this.assets) {
      const file = await open(join(staging, ...asset.path.split('/')), constants.O_RDWR | (constants.O_NOFOLLOW || 0))
      try { await file.sync() } finally { await file.close() }
    }
    await this.ownedStage(staging); checkModelScope(scope)
    const before = await lstat(this.root), directory = `model-${randomUUID()}`, destination = join(this.root, directory)
    await rename(staging, destination)
    this.owned.delete(staging); this.moved.add(staging)
    // A cancelled operation can leave an unreferenced immutable directory, never a ready pointer.
    checkModelScope(scope); await checkedDirectory(destination)
    if (!await verifyModelAssets(destination, this.assets, scope)) throw new Error('model_integrity_failed')
    const temporary = join(this.root, `.pointer-${randomUUID()}`)
    const pointer = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try {
      await pointer.writeFile(JSON.stringify({ schemaVersion: 1, fingerprint: this.fingerprint, directory }), 'utf8'); await pointer.sync()
    } finally { await pointer.close() }
    try {
      await checkedDirectory(this.root)
      const after = await lstat(this.root)
      if (before.ino !== after.ino || before.dev !== after.dev) throw new Error('model_path_invalid')
      checkModelScope(scope)
      // No asynchronous gap between final authorization and the atomic pointer switch.
      renameSync(temporary, join(this.root, 'active.json'))
      this.moved.delete(staging)
    } finally { try { await unlink(temporary) } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause } }
  }
  async discard(staging: string): Promise<void> {
    if (this.moved.delete(staging)) return
    await this.ownedStage(staging)
    for (const asset of this.assets) {
      const filename = join(staging, ...asset.path.split('/'))
      try { await checkedDirectory(dirname(filename)); await unlink(filename) }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
    }
    for (const directory of new Set(this.assets.filter(asset => asset.path.includes('/')).map(asset => asset.path.split('/')[0]))) {
      try { await rmdir(join(staging, directory)) } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
    }
    await rmdir(staging); this.owned.delete(staging)
  }
}
export class ModelFiles extends ModelFileTransaction {
  constructor(root: string, value: unknown = SEMANTIC_MODEL_MANIFEST) {
    const manifest = validateModelManifest(value)
    super(resolve(root), manifest.assets, modelFingerprint(manifest))
  }
}
/** Hash only the expected files; never follow a supplied directory link. No network or repair. */
export async function verifyModelAssets(root: string, assets: readonly ModelAsset[], scope: SemanticScope): Promise<boolean> {
  checkModelScope(scope)
  try {
    if (!isAbsolute(root) || !assets.length || assets.some(asset => !SEMANTIC_MODEL_MANIFEST.assets.some(known => known.path === asset.path) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 160 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(asset.sha256))) return false
    const before = await lstat(root); checkModelScope(scope)
    if (!before.isDirectory() || before.isSymbolicLink()) return false
    const canonical = await realpath(root)
    const allowed = new Set(assets.map(asset => asset.path))
    const directories = new Set(assets.filter(asset => asset.path.includes('/')).map(asset => asset.path.split('/')[0]))
    for (const entry of await readdir(canonical, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) return false
      if (entry.isDirectory()) {
        if (!directories.has(entry.name)) return false
        for (const child of await readdir(join(canonical, entry.name), { withFileTypes: true })) {
          if (!child.isFile() || !allowed.has(`${entry.name}/${child.name}`)) return false
        }
      } else if (!entry.isFile() || !allowed.has(entry.name)) return false
    }
    for (const asset of assets) {
      checkModelScope(scope)
      const filename = join(canonical, ...asset.path.split('/'))
      const metadata = await lstat(filename)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== asset.bytes) return false
      const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      try {
        const opened = await file.stat()
        if (opened.ino !== metadata.ino || opened.dev !== metadata.dev || opened.size !== asset.bytes) return false
        const hash = createHash('sha256'), buffer = Buffer.alloc(256 * 1024)
        let bytes = 0
        for (;;) {
          checkModelScope(scope)
          const chunk = await file.read(buffer, 0, buffer.length, null)
          checkModelScope(scope)
          if (!chunk.bytesRead) break
          bytes += chunk.bytesRead
          if (bytes > asset.bytes) return false
          hash.update(buffer.subarray(0, chunk.bytesRead))
        }
        const after = await file.stat()
        if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256 || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return false
      } finally { await file.close() }
    }
    const after = await lstat(root); checkModelScope(scope)
    return !after.isSymbolicLink() && after.dev === before.dev && after.ino === before.ino && await realpath(root) === canonical
  } catch (error) { checkModelScope(scope); return false }
}
