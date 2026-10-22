import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const base = 'https://storage.googleapis.com/tfjs-models/tfjs/speech-commands/v0.5/browser_fft/18w/'
const directory = fileURLToPath(new URL('../public/speech-model/', import.meta.url))
const hashes = {
  'model.json': 'be053f904fe26d1fab2be824d943e936d9f04c9ea3d238d3c58fa2a6225b1ef7',
  'metadata.json': '06f92997a0f6b3e5f11d70251222350f1e0f6717280f7edd151d4001482665ac',
  'group1-shard1of2': '79b7ef9d7577b333ee39b0d6e8dfebdb03be559a645bc389307ef84da414a30b',
  'group1-shard2of2': '129b9a7d501f81e62710d494efcba67ed98b3f3032dd28d7fe20cbc8cd5bee1f'
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
await fs.mkdir(directory, { recursive: true })
for (const [name, expected] of Object.entries(hashes)) {
  const destination = new URL(`../public/speech-model/${name}`, import.meta.url)
  const existing = await fs.readFile(destination).catch(() => null)
  if (existing && hash(existing) === expected) continue
  const response = await fetch(base + name, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Speech asset ${name}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (hash(bytes) !== expected) throw new Error(`Speech asset checksum mismatch: ${name}`)
  await fs.writeFile(destination, bytes)
}
console.log('[speech-assets] Verified local model, metadata and weights.')
