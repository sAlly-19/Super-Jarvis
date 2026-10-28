import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
test('real Chromium health panel renders partial data safely, saves preferences and hides revoked readings', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-health-ui-'))
  try {
    createRequire(path.resolve('package.json'))('esbuild').buildSync({ entryPoints: ['test/pc-health-ui.browser.ts'], outfile: path.join(root, 'ui.js'), bundle: true, platform: 'browser', format: 'iife' })
    fs.writeFileSync(path.join(root, 'index.html'), fs.readFileSync('src/renderer/index.html', 'utf8').replace('<script type="module" src="./main.ts"></script>', '<script defer src="ui.js"></script>'))
    fs.writeFileSync(path.join(root, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(root,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});w.webContents.on('console-message',(_e,_l,m)=>{console.log(m);if(m.includes('PC_HEALTH_UI_PASS'))app.exit(0);if(m.includes('PC_HEALTH_UI_FAIL'))app.exit(1)});w.loadFile(${JSON.stringify(path.join(root,'index.html'))})});setTimeout(()=>app.exit(2),15000);`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(path.resolve('node_modules/electron/dist/electron.exe'), [path.join(root, 'main.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 20000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /PC_HEALTH_UI_PASS/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
