import { createHash } from 'node:crypto'
import { SEMANTIC_MODEL_MANIFEST } from './model-manifest'

export interface ModelAsset { path: string; bytes: number; sha256: string }
export interface ModelManifest {
  schemaVersion: 1; modelId: string; revision: string; dtype: 'int8'; dimensions: 384
  pooling: 'mean'; normalization: 'l2'; maxTokens: 128; assets: ModelAsset[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function reject(): never { throw new Error('invalid_model_manifest') }

// The trusted candidate is deliberately closed: a changed artifact requires a new review.
export function validateModelManifest(value: unknown): ModelManifest {
  if (!record(value)) return reject()
  const expected = SEMANTIC_MODEL_MANIFEST
  const keys = Object.keys(expected)
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return reject()
  for (const key of keys.filter(key => key !== 'assets')) {
    if (value[key] !== expected[key as keyof typeof expected]) return reject()
  }
  if (!Array.isArray(value.assets) || value.assets.length !== expected.assets.length) return reject()
  const assets: ModelAsset[] = []
  for (const trusted of expected.assets) {
    const matches = value.assets.filter(asset => record(asset) && asset.path === trusted.path)
    if (matches.length !== 1) return reject()
    const asset = matches[0] as Record<string, unknown>
    if (Object.keys(asset).length !== 3 || asset.bytes !== trusted.bytes || asset.sha256 !== trusted.sha256) return reject()
    assets.push({ ...trusted })
  }
  return { ...expected, assets }
}

export function modelFingerprint(value: unknown): string {
  const manifest = validateModelManifest(value)
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}
