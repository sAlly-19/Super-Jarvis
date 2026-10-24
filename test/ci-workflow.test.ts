import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

describe('Reproducible CI, Artifact Separation & CodeQL (Task 8)', () => {
  const root = process.cwd()

  test('source tests are separated from compiled sidecar artifact tests', () => {
    const legacyTestPath = path.join(root, 'test', 'python-package.test.ts')
    const artifactTestPath = path.join(root, 'test-artifact', 'python-package.test.ts')
    const packageRunnerPath = path.join(root, 'scripts', 'run-package-tests.mjs')
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

    assert.equal(
      fs.existsSync(legacyTestPath),
      false,
      'test/python-package.test.ts must be moved out of source test directory so npm test passes on a clean checkout without a prebuilt sidecar'
    )
    assert.equal(
      fs.existsSync(artifactTestPath),
      true,
      'test-artifact/python-package.test.ts must exist for compiled sidecar verification'
    )
    assert.equal(
      fs.existsSync(packageRunnerPath),
      true,
      'scripts/run-package-tests.mjs must exist'
    )
    assert.equal(
      pkg.scripts['test:package'],
      'node scripts/run-package-tests.mjs',
      'package.json must define test:package using scripts/run-package-tests.mjs'
    )
    assert.match(
      pkg.scripts['package:dir'] || '',
      /build:python|build-python-backend\.ps1/,
      'package:dir must be self-contained and build the Python sidecar'
    )
  })

  test('CI and Release workflows enforce source-before-build ordering and run test:package after build:python', () => {
    for (const wfName of ['ci.yml', 'release.yml']) {
      const wfPath = path.join(root, '.github', 'workflows', wfName)
      assert.equal(fs.existsSync(wfPath), true, `${wfName} must exist`)
      const wf = fs.readFileSync(wfPath, 'utf8')

      const ciInstallIdx = wf.indexOf('npm ci')
      const verifyIdx = wf.indexOf('npm run verify')
      const pyTestIdx = wf.indexOf('npm run test:python')
      const buildPyIdx = wf.indexOf('npm run build:python')
      const pkgTestIdx = wf.indexOf('npm run test:package')

      assert.ok(ciInstallIdx >= 0, `${wfName} must run npm ci`)
      assert.ok(verifyIdx > ciInstallIdx, `${wfName} must run source verification after npm ci`)
      assert.ok(pyTestIdx > ciInstallIdx, `${wfName} must run Python unit tests after npm ci`)
      assert.ok(buildPyIdx > verifyIdx && buildPyIdx > pyTestIdx, `${wfName} must build sidecar after source tests`)
      assert.ok(pkgTestIdx > buildPyIdx, `${wfName} must run npm run test:package after npm run build:python`)
    }
  })

  test('CodeQL v4 workflow covers javascript-typescript and python with least privilege and schedule', () => {
    const codeqlPath = path.join(root, '.github', 'workflows', 'codeql.yml')
    assert.equal(fs.existsSync(codeqlPath), true, '.github/workflows/codeql.yml must exist')
    const content = fs.readFileSync(codeqlPath, 'utf8')

    assert.match(content, /push:[\s\S]*branches:\s*\[main\]/, 'must trigger on push to main')
    assert.match(content, /pull_request:[\s\S]*branches:\s*\[main\]/, 'must trigger on pull_request to main')
    assert.match(content, /schedule:[\s\S]*cron:/, 'must include scheduled analysis')
    assert.match(content, /security-events:\s*write/, 'must grant security-events: write')
    assert.match(content, /contents:\s*read/, 'must grant contents: read')
    assert.match(content, /javascript-typescript/, 'matrix must include javascript-typescript')
    assert.match(content, /python/, 'matrix must include python')
    assert.match(content, /github\/codeql-action\/init@v4/, 'must use codeql-action/init@v4')
    assert.match(content, /github\/codeql-action\/analyze@v4/, 'must use codeql-action/analyze@v4')
  })
})

