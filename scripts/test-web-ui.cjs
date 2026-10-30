// Synthetic Electron UI acceptance. No license/profile/provider data or public network.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { pathToFileURL } = require('node:url')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-web-ui-'))
const output = path.join(root, '.superpowers/sdd/2026-10-29-web-research-04-integration')
try {
  fs.mkdirSync(output, { recursive: true })
  let html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*https:[^>]*>/g, '')
    .replace('href="./styles.css"', `href="${pathToFileURL(path.join(root, 'src/renderer/styles.css')).href}"`)
    .replace('</body>', '<script defer src="fixture.js"></script></body>')
  fs.writeFileSync(path.join(temporary, 'index.html'), html)
  buildSync({ entryPoints: [path.join(root, 'test/fixtures/web/acceptance-ui.ts')], outfile: path.join(temporary, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife' })
  fs.writeFileSync(path.join(temporary, 'host.cjs'), `const fs=require('node:fs');const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temporary, 'profile'))});app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));const w=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});w.webContents.on('console-message',async(event)=>{const m=event.message;if(m.startsWith('WEB_UI_FAIL')){console.error(m);app.exit(1)}if(m==='WEB_UI_PASS'){try{await new Promise(r=>setTimeout(r,100));fs.writeFileSync(${JSON.stringify(path.join(output, 'web-panel.png'))},(await w.webContents.capturePage()).toPNG());console.log(m);app.exit(0)}catch(e){console.error(e);app.exit(1)}}});w.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))})});setTimeout(()=>app.exit(2),12000);`)
  const env = {}
  for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA']) if (process.env[key]) env[key] = process.env[key]
  const result = spawnSync(path.join(root, 'node_modules/electron/dist/electron.exe'), [path.join(temporary, 'host.cjs')], { cwd: root, env, encoding: 'utf8', timeout: 18000, windowsHide: true })
  process.stdout.write(result.stdout || '')
  if (result.status !== 0) process.stderr.write(result.stderr || String(result.error || 'web_ui_failed'))
  process.exitCode = result.status === 0 && (result.stdout || '').includes('WEB_UI_PASS') ? 0 : 1
} finally {
  const resolved = fs.realpathSync(temporary), parent = fs.realpathSync(os.tmpdir())
  if (!resolved.startsWith(parent + path.sep) || !path.basename(resolved).startsWith('jasper-web-ui-')) throw Error('unsafe_temp_path')
  fs.rmSync(resolved, { recursive: true, force: true })
}
