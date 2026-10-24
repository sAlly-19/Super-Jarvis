import esbuild from 'esbuild'
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const tempTestRoot = path.join(os.tmpdir(), `jasper-package-tests-${process.pid}-${Date.now()}`)
const tempUserData = path.join(tempTestRoot, 'user-data')
const resolvedTempRoot = path.resolve(os.tmpdir())
const resolvedTestRoot = path.resolve(tempTestRoot)
if (!resolvedTestRoot.startsWith(`${resolvedTempRoot}${path.sep}`)) {
  throw new Error('Diretório temporário de testes fora da pasta temporária do sistema.')
}
fs.mkdirSync(resolvedTestRoot, { recursive: true })
fs.mkdirSync(tempUserData, { recursive: true })
fs.symlinkSync(path.join(rootDir, 'node_modules'), path.join(tempTestRoot, 'node_modules'), 'junction')

const artifactTestDir = path.join(rootDir, 'test-artifact')
if (!fs.existsSync(artifactTestDir)) {
  console.error('[run-package-tests] test-artifact directory does not exist.')
  process.exit(1)
}

function findTestFiles(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  let files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath, baseDir))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/')
      files.push(rel)
    }
  }
  return files.sort()
}

const allDiscovered = findTestFiles(artifactTestDir)
if (allDiscovered.length === 0) {
  console.error('[run-package-tests] No artifact test files found.')
  process.exit(1)
}

console.log('[run-package-tests] Empacotando testes de artefato...')
const testFiles = allDiscovered.map((rel) => ({
  in: rel,
  out: rel.replace(/\.test\.ts$/, '.test.mjs').replace(/\//g, '_')
}))

for (const tf of testFiles) {
  esbuild.buildSync({
    entryPoints: [path.join(artifactTestDir, tf.in)],
    outfile: path.join(tempTestRoot, tf.out),
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: {
      '@shared': path.join(rootDir, 'src', 'shared', 'index.ts')
    },
    external: [
      'three',
      '@tensorflow/tfjs',
      '@tensorflow-models/speech-commands',
      'dotenv',
      'systeminformation',
      'exceljs',
      'docx',
      'qrcode',
      'pdf-parse',
      'mammoth',
      'jsqr',
      'tesseract.js'
    ]
  })
}

console.log('[run-package-tests] Executando testes de artefato...')
const outFiles = testFiles.map((tf) => path.join(tempTestRoot, tf.out))
const res = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-timeout=120000', '--test-concurrency=1', ...outFiles], {
  cwd: rootDir,
  stdio: 'inherit',
  timeout: 300000
})

try {
  fs.rmSync(resolvedTestRoot, { recursive: true, force: true })
} catch {}

process.exit(res.status ?? 0)

