// Test harness only: packaged resources + real domain services, never a production license bypass.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const asar = require('@electron/asar')
const root = path.resolve(__dirname, '..')
const archive = path.join(root, 'release/win-unpacked/resources/app.asar')
const output = path.join(root, '.superpowers/sdd/2026-10-27-reminders-05-acceptance')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-reminder-acceptance-'))
try {
  fs.mkdirSync(output, { recursive: true })
  for (const entry of asar.listPackage(archive).map(name => name.replace(/\\/g, '/')).filter(name => /\/out\/renderer\/assets\/[^/]+\.css$/.test(name))) {
    const relative = entry.replace(/^\//, '').slice('out/renderer/'.length)
    fs.mkdirSync(path.dirname(path.join(temporary, relative)), { recursive: true })
    fs.writeFileSync(path.join(temporary, relative), asar.extractFile(archive, path.join(...entry.replace(/^\//, '').split('/'))))
  }
  let html = asar.extractFile(archive, path.join('out', 'renderer', 'index.html')).toString()
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*(?:https:)[^>]*>/g, '')
    .replace('</body>', '<script defer src="fixture-ui.js"></script></body>')
  fs.writeFileSync(path.join(temporary, 'index.html'), html)
  buildSync({ entryPoints: [path.join(root, 'test/fixtures/reminders/acceptance-host.ts')], outfile: path.join(temporary, 'host.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  buildSync({ entryPoints: [path.join(root, 'test/fixtures/reminders/acceptance-ui.ts')], outfile: path.join(temporary, 'fixture-ui.js'), bundle: true, platform: 'browser', format: 'iife' })
  const methods = ['listModules', 'listReminders', 'getReminder', 'mutateReminder', 'reminderPreferences', 'importReminders', 'exportReminders', 'getOverdueReminders', 'acknowledgeOverdueReminders']
  fs.writeFileSync(path.join(temporary, 'preload.cjs'), `const {contextBridge, ipcRenderer}=require('electron');
const api=Object.fromEntries(${JSON.stringify(methods)}.map(method=>[method,(...args)=>ipcRenderer.invoke('fixture:call',method,...args)]));
api.onRemindersChanged=callback=>{const handler=()=>callback();ipcRenderer.on('fixture:changed',handler);return ()=>ipcRenderer.removeListener('fixture:changed',handler)};
api.onOverdueReminders=callback=>{const handler=(_e,batch)=>callback(batch);ipcRenderer.on('fixture:overdue',handler);return ()=>ipcRenderer.removeListener('fixture:overdue',handler)};
api.onLicenseState=()=>()=>{};
contextBridge.exposeInMainWorld('electronAPI',api);contextBridge.exposeInMainWorld('remindersAcceptance',{recover:()=>ipcRenderer.invoke('fixture:call','recover'),acknowledged:()=>ipcRenderer.invoke('fixture:call','acknowledged'),ready:()=>ipcRenderer.invoke('fixture:call','ready')});`)
  const windows = process.env.SystemRoot || 'C:\\Windows'
  const env = { ...process.env, PATH: [windows, path.join(windows, 'System32'), path.join(windows, 'System32/Wbem')].join(';') }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(path.join(root, 'node_modules/electron/dist/electron.exe'), [path.join(temporary, 'host.cjs'), archive, temporary, path.join(root, 'test/fixtures/reminders/sample-calendar.ics'), output], { cwd: root, env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write(result.stdout || ''); if (result.status !== 0) process.stderr.write(result.stderr || String(result.error || 'acceptance failed'))
  process.exitCode = result.status === 0 ? 0 : 1
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
