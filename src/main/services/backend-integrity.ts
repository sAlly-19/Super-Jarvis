import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { BackendManifest } from '../generated/backend-manifest'

export class BackendIntegrityError extends Error {
  constructor(message: string) {
    super(`BACKEND_INTEGRITY_ERROR: ${message}`)
    this.name = 'BackendIntegrityError'
  }
}

export async function verifyBackendIntegrity(root: string, manifest: BackendManifest): Promise<void> {
  if (!manifest || manifest.protocolVersion !== 1) {
    throw new BackendIntegrityError('Invalid manifest protocol version: expected 1')
  }

  if (!manifest.executable || typeof manifest.executable !== 'string') {
    throw new BackendIntegrityError('Invalid manifest executable')
  }

  if (!fs.existsSync(root)) {
    throw new BackendIntegrityError(`Backend root directory not found: ${root}`)
  }

  const exePath = path.join(root, manifest.executable)
  if (!fs.existsSync(exePath)) {
    throw new BackendIntegrityError(`Backend executable missing: ${manifest.executable} in ${root}`)
  }

  if (manifest.files.length > 0) {
    const declaredPaths = new Set(manifest.files.map((e) => e.path.replace(/\\/g, '/')))
    declaredPaths.add(manifest.executable.replace(/\\/g, '/'))

    const checkExtraFiles = async (currentDir: string): Promise<void> => {
      const items = await fs.promises.readdir(currentDir, { withFileTypes: true })
      for (const item of items) {
        const full = path.join(currentDir, item.name)
        if (item.isDirectory()) {
          await checkExtraFiles(full)
        } else if (item.isFile()) {
          const rel = path.relative(root, full).replace(/\\/g, '/')
          if (rel.endsWith('.py')) {
            throw new BackendIntegrityError(`Loose .py source file found in production sidecar: ${rel}`)
          }
          if (!declaredPaths.has(rel)) {
            throw new BackendIntegrityError(`Extraneous file not declared in manifest: ${rel}`)
          }
        }
      }
    }

    await checkExtraFiles(root)
  }

  for (const entry of manifest.files) {
    if (entry.path.endsWith('.py')) {
      throw new BackendIntegrityError(`Loose .py source file found in production sidecar: ${entry.path}`)
    }

    const filePath = path.join(root, entry.path)
    if (!fs.existsSync(filePath)) {
      throw new BackendIntegrityError(`Missing file declared in manifest: ${entry.path}`)
    }

    const fileBuffer = await fs.promises.readFile(filePath)
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    if (hash.toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new BackendIntegrityError(
        `Hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${hash}`
      )
    }
  }
}
