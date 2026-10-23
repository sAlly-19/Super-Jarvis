// scripts/verify-package.mjs
// Inspects electron-builder configuration, packaged output, ASAR fuses, and sidecar manifest.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()

console.log('==> Verifying package configuration and artifacts...')

// 1. Verify electron-builder.yml configuration
const builderConfigPath = path.join(root, 'electron-builder.yml')
if (!fs.existsSync(builderConfigPath)) {
  console.error('FAIL: electron-builder.yml not found.')
  process.exit(1)
}

const builderConfigContent = fs.readFileSync(builderConfigPath, 'utf-8')

// Must not reference removed autonomous scripts
if (builderConfigContent.includes('autonomous/scripts') || builderConfigContent.includes('src/main/autonomous')) {
  console.error('FAIL: electron-builder.yml references removed autonomous scripts directory.')
  process.exit(1)
}

// Must not contain portable target
if (/target:\s*portable/i.test(builderConfigContent)) {
  console.error('FAIL: electron-builder.yml must not contain portable target; only signed NSIS x64 is allowed.')
  process.exit(1)
}

// Must have ASAR integrity fuse and onlyLoadAppFromAsar
if (!/enableEmbeddedAsarIntegrityValidation:\s*true/.test(builderConfigContent)) {
  console.error('FAIL: electron-builder.yml must have enableEmbeddedAsarIntegrityValidation: true.')
  process.exit(1)
}
if (!/onlyLoadAppFromAsar:\s*true/.test(builderConfigContent)) {
  console.error('FAIL: electron-builder.yml must have onlyLoadAppFromAsar: true.')
  process.exit(1)
}

// Must include jasper-backend in extraResources
if (!builderConfigContent.includes('jasper-backend')) {
  console.error('FAIL: electron-builder.yml must include jasper-backend in extraResources.')
  process.exit(1)
}

// 2. Check unpacked package directory if it exists
const releaseDir = path.join(root, 'release', 'win-unpacked')
if (!fs.existsSync(releaseDir)) {
  console.error(`FAIL: Unpacked release directory not found at ${releaseDir}. Run package:dir first.`)
  process.exit(1)
}

// Check resources/jasper-backend
const sidecarDir = path.join(releaseDir, 'resources', 'jasper-backend')
if (!fs.existsSync(sidecarDir)) {
  console.error(`FAIL: Packaged sidecar directory not found at ${sidecarDir}.`)
  process.exit(1)
}

const sidecarExe = path.join(sidecarDir, 'jasper-backend.exe')
if (!fs.existsSync(sidecarExe)) {
  console.error(`FAIL: Sidecar executable missing at ${sidecarExe}.`)
  process.exit(1)
}

// Verify zero loose .py files in releaseDir
function findFilesByExt(dir, ext) {
  let results = []
  const list = fs.readdirSync(dir)
  for (const item of list) {
    const full = path.join(dir, item)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      results = results.concat(findFilesByExt(full, ext))
    } else if (full.endsWith(ext)) {
      results.push(full)
    }
  }
  return results
}

const pyFiles = findFilesByExt(releaseDir, '.py')
if (pyFiles.length > 0) {
  console.error(`FAIL: Found loose .py files in packaged distribution: ${pyFiles.join(', ')}`)
  process.exit(1)
}

// 3. Verify manifest integrity against DEFAULT_BACKEND_MANIFEST
const manifestPath = path.join(root, 'src', 'main', 'generated', 'backend-manifest.ts')
if (!fs.existsSync(manifestPath)) {
  console.error(`FAIL: Manifest file not found at ${manifestPath}`)
  process.exit(1)
}

const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
const entries = []
const entryRegex = /\{\s*path:\s*['"]([^'"]+)['"]\s*,\s*sha256:\s*['"]([a-f0-9]+)['"]\s*\}/g
let match
while ((match = entryRegex.exec(manifestContent)) !== null) {
  entries.push({ path: match[1], sha256: match[2] })
}

if (entries.length === 0) {
  console.error('FAIL: Manifest has 0 declared files. Generate manifest before packaging.')
  process.exit(1)
}

const declaredPaths = new Set(entries.map((e) => e.path.replace(/\\/g, '/')))
for (const entry of entries) {
  const filePath = path.join(sidecarDir, entry.path)
  if (!fs.existsSync(filePath)) {
    console.error(`FAIL: Declared manifest file missing in sidecar: ${entry.path}`)
    process.exit(1)
  }
  const fileBuf = fs.readFileSync(filePath)
  const actualHash = crypto.createHash('sha256').update(fileBuf).digest('hex')
  if (actualHash.toLowerCase() !== entry.sha256.toLowerCase()) {
    console.error(`FAIL: Hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${actualHash}`)
    process.exit(1)
  }
}

// Verify no extra files in sidecarDir
function getAllRelativeFiles(dir, base = dir) {
  let results = []
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      results = results.concat(getAllRelativeFiles(full, base))
    } else {
      results.push(path.relative(base, full).replace(/\\/g, '/'))
    }
  }
  return results
}

const actualFiles = getAllRelativeFiles(sidecarDir)
for (const rel of actualFiles) {
  if (rel === 'jasper-backend.exe') continue
  if (!declaredPaths.has(rel)) {
    console.error(`FAIL: Extraneous file in packaged sidecar not declared in manifest: ${rel}`)
    process.exit(1)
  }
}

// 4. Verify build flavor is commercial for release
const flavorPath = path.join(root, 'src', 'main', 'generated', 'build-flavor.ts')
if (fs.existsSync(flavorPath)) {
  const flavorContent = fs.readFileSync(flavorPath, 'utf-8')
  const flavorMatch = /BUILD_FLAVOR\s*:\s*BuildFlavor\s*=\s*['"]([^'"]+)['"]/.exec(flavorContent)
  const flavor = flavorMatch ? flavorMatch[1] : 'commercial'
  if (flavor === 'smoke' && !process.env.ALLOW_SMOKE_FLAVOR) {
    console.error('FAIL: Build flavor is smoke; release must be compiled with commercial flavor.')
    process.exit(1)
  }
  if (flavor === 'commercial' && !flavorContent.includes('SMOKE_PUBLIC_KEY: Readonly<JsonWebKey> | null = null')) {
    console.error('FAIL: Commercial release contains non-null smoke key.')
    process.exit(1)
  }
}

// 5. Verify source code does not attempt python/python3/py or port 8765 in production
const pythonBackendTs = fs.readFileSync(path.join(root, 'src', 'main', 'services', 'python-backend.ts'), 'utf-8')
if (pythonBackendTs.includes('127.0.0.1:8765') || pythonBackendTs.includes('8765')) {
  console.error('FAIL: Production sidecar manager references port 8765.')
  process.exit(1)
}

console.log('==> Package verification PASSED.')
