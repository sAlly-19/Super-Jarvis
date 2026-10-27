import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

test('real Chromium renders reminder titles as text and exposes editor actions and timezone', { timeout: 30000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-reminders-dom-'))
  try {
    const { buildSync } = createRequire(path.resolve('package.json'))('esbuild')
    buildSync({ entryPoints: ['test/reminders-ui.browser.ts'], outfile: path.join(dir, 'ui.js'), bundle: true, platform: 'browser', format: 'iife' })
    const html = fs.readFileSync('src/renderer/index.html', 'utf8').replace('<script type="module" src="./main.ts"></script>', '<script defer src="ui.js"></script>')
    fs.writeFileSync(path.join(dir, 'index.html'), html)
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(dir, 'profile'))});
app.whenReady().then(() => { const win = new BrowserWindow({show:false}); win.webContents.on('console-message', (_e, _l, message) => { console.log(message); if(message.includes('REMINDERS_UI_PASS')) app.exit(0); if(message.includes('REMINDERS_UI_FAIL')) app.exit(1); }); win.loadFile(${JSON.stringify(path.join(dir, 'index.html'))}); });
setTimeout(() => app.exit(2), 12000);`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const run = spawnSync(path.resolve('node_modules/electron/dist/electron.exe'), [path.join(dir, 'main.cjs')], { env, encoding: 'utf8', timeout: 20000, windowsHide: true })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /REMINDERS_UI_PASS/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
