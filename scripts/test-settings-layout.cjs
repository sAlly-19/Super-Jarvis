// Visual layout check using static source HTML: no backend, profile or credentials.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow, session } = require('electron')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-layout-'))
app.setPath('userData', path.join(temporary, 'profile'))
const deadline = setTimeout(() => app.exit(1), 30000)
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((_request, callback) => {
    callback({ cancel: _request.resourceType === 'script' || /^https?:/.test(_request.url) })
  })
  const win = new BrowserWindow({ show: false, width: 1100, height: 860, webPreferences: { sandbox: true } })
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  await win.webContents.executeJavaScript(`
    document.getElementById('settings-modal').classList.remove('hidden');
    document.querySelectorAll('.settings-tab-pane').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-ai-voice').classList.add('active');
  `)
  for (const width of [1100, 800, 600]) {
    win.setSize(width, 860)
    await new Promise(resolve => setTimeout(resolve, 200))
    const errors = await win.webContents.executeJavaScript(`(() => {
      const errors = [];
      const root = document.getElementById('tab-ai-voice');
      for (const el of root.querySelectorAll('.settings-card, .form-group, .provider-card-top, .credential-status-pill, .input-password-wrap')) {
        if (el.scrollWidth > el.clientWidth + 2) errors.push(el.className + ': horizontal overflow');
      }
      const inputs = ['select-ai-provider', 'select-model'].map(id => document.getElementById(id).getBoundingClientRect());
      if (root.clientWidth > 560 && Math.abs(inputs[0].top - inputs[1].top) > 2) errors.push('Misaligned chat selectors');
      for (const button of root.querySelectorAll('.input-password-wrap button')) {
        if (button.getBoundingClientRect().height < 29) errors.push(button.id + ': undersized target');
      }
      return errors;
    })()`)
    if (errors.length) throw new Error(`${width}px: ${errors.join('; ')}`)
    console.log(`SETTINGS_LAYOUT_PASS ${width}px`)
    if (width === 1100) {
      const screenshot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(temporary, 'settings.png'), screenshot.toPNG())
      console.log(`Screenshot: ${path.join(temporary, 'settings.png')}`)
    }
  }
  clearTimeout(deadline)
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
