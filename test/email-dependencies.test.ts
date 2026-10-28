import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
test('email official SDKs are pinned, import without credentials and include original licenses', () => {
  const require = createRequire(path.resolve('package.json')), manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const packages = { '@googleapis/gmail': '22.0.2', 'google-auth-library': '11.3.1', '@azure/msal-node': '7.1.2', '@microsoft/microsoft-graph-client': '3.0.7' }
  for (const [name, version] of Object.entries(packages)) {
    assert.equal(manifest.dependencies[name], version, `${name} must be pinned`)
    const imported = require(name)
    assert.ok(imported && Object.keys(imported).length)
    const installed = JSON.parse(fs.readFileSync(path.join('node_modules', name, 'package.json'), 'utf8'))
    assert.equal(installed.version, version)
    assert.ok(fs.readFileSync(path.join('resources/licenses', `${name.replace(/[@/]/g, '-')}-LICENSE.txt`), 'utf8').length > 100)
  }
})
test('email SDK imports work in isolated Electron Main without network or credentials', { timeout: 20000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-sdk-'))
  try {
    const fixture = path.join(root, 'sdk.cjs'), project = path.resolve('package.json')
    fs.writeFileSync(fixture, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(root, 'profile'))});app.disableHardwareAcceleration();app.whenReady().then(()=>{try{for(const p of ['http','https'])require(p).request=()=>{throw new Error('Network forbidden')};global.fetch=()=>Promise.reject(new Error('Network forbidden'));const r=require('node:module').createRequire(${JSON.stringify(project)});for(const p of ['@googleapis/gmail','google-auth-library','@azure/msal-node','@microsoft/microsoft-graph-client'])r(p);console.log('EMAIL_SDK_PASS node='+process.versions.node);app.exit(0)}catch(e){console.error(e);app.exit(1)}});setTimeout(()=>app.exit(2),10000)`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(path.resolve('node_modules/electron/dist/electron.exe'), [fixture], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /EMAIL_SDK_PASS/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
