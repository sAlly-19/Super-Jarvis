// Synthetic visual acceptance only. No application license bypass, accounts or provider requests.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.superpowers/sdd/2026-10-28-email-05-acceptance')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-email-visual-'))
try {
  fs.mkdirSync(output, { recursive: true })
  const renderer = path.join(root, 'out/renderer')
  let html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*https:[^>]*>/g, '').replace('</body>', '<script defer src="fixture.js"></script></body>')
  fs.writeFileSync(path.join(temporary, 'index.html'), html)
  const assets = path.join(temporary, 'assets'); fs.mkdirSync(assets)
  for (const name of fs.readdirSync(path.join(renderer, 'assets')).filter(name => name.endsWith('.css'))) fs.copyFileSync(path.join(renderer, 'assets', name), path.join(assets, name))
  buildSync({ entryPoints: [path.join(root, 'test/fixtures/email/acceptance-ui.ts')], outfile: path.join(temporary, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife' })
  fs.writeFileSync(path.join(temporary, 'host.cjs'), `const fs=require('node:fs');const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temporary, 'profile'))});app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));const w=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.webContents.on('console-message',async(_e,_l,m)=>{if(m.includes('EMAIL_ACCEPTANCE_FAIL')){console.error(m);app.exit(1)}if(m==='EMAIL_ACCEPTANCE_READY'){try{await new Promise(r=>setTimeout(r,150));fs.writeFileSync(${JSON.stringify(path.join(output, 'email-panel.png'))},(await w.webContents.capturePage()).toPNG());fs.writeFileSync(${JSON.stringify(path.join(output, 'visual-result.json'))},JSON.stringify({passed:true,commercialRuntimeUnlocked:false,syntheticAccounts:true,networkAllowed:false},null,2));console.log('EMAIL_VISUAL_PASS');app.exit(0)}catch(e){console.error(e);app.exit(1)}}});w.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))})});setTimeout(()=>app.exit(2),12000);`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(path.join(root, 'node_modules/electron/dist/electron.exe'), [path.join(temporary, 'host.cjs')], { cwd: root, env, encoding: 'utf8', timeout: 20000, windowsHide: true })
  process.stdout.write(result.stdout || '')
  if (result.status !== 0) process.stderr.write(result.stderr || String(result.error || 'visual acceptance failed'))
  process.exitCode = result.status === 0 ? 0 : 1
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
