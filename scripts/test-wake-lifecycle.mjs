import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'jasper-wake-test-'))
const assets = path.resolve(root, process.argv.includes('--packaged')
  ? 'release/win-unpacked/resources/app.asar/out/renderer'
  : process.argv.includes('--built') ? 'out/renderer' : 'public')
const electron = createRequire(import.meta.url)('electron')
try {
  await build({
    entryPoints: [path.join(root, 'test/wake-lifecycle.browser.ts')],
    outfile: path.join(temporary, 'test.js'), bundle: true, platform: 'browser', external: ['fs'],
    alias: { util: path.join(root, 'src/renderer/util-polyfill.ts') }
  })
  const sourceHtml = await fs.readFile(path.join(root, 'src/renderer/index.html'), 'utf8')
  const csp = sourceHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)?.[0]
  if (!csp) throw new Error('Missing production CSP')
  await fs.writeFile(path.join(temporary, 'index.html'), `<!doctype html><html><head>${csp}</head><body><script src="./test.js"></script></body></html>`)
  await fs.writeFile(path.join(temporary, 'main.cjs'), `
const {app,BrowserWindow,protocol,net,session}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
app.setPath('userData',path.join(__dirname,'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const deadline=setTimeout(()=>{console.error('Wake lifecycle timed out'); app.exit(1)},180000);
app.whenReady().then(async()=>{
  protocol.handle('app',request=>{
    const name=new URL(request.url).pathname.replace(/^\\/+/, '') || 'index.html';
    const base=name.startsWith('speech-model/') ? ${JSON.stringify(assets)} : __dirname;
    return net.fetch(pathToFileURL(path.join(base,name)).href);
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(true));
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
  const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.on('console-message',(event)=>{
    const message=event.message;
    console.log(message);
    if(message?.includes('WAKE_LIFECYCLE_PASS')) {clearTimeout(deadline); app.exit(0)}
    if(message?.includes('WAKE_LIFECYCLE_FAIL')) {clearTimeout(deadline); app.exit(1)}
  });
  await win.loadURL('app://jasper/index.html');
}).catch(error=>{console.error(error);app.exit(1)});
`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(temporary, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
  process.exitCode = code
} finally {
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
}
