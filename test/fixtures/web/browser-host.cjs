// Capability probe only. No product app, website, server, account or ICE/STUN endpoint is used.
const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')
const [profile, output, enabled] = process.argv.slice(2)
app.setPath('userData', profile)
if (enabled === 'enable-feature') app.commandLine.appendSwitch('enable-features', 'ConnectionAllowlists')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const reports = []
  for (const mode of ['protocol-only', 'connection-allowlist']) {
    const ses = session.fromPartition(`web-gate-${mode}-${Date.now()}`, { cache: false })
    let requests = 0
    const messages = []
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.protocol.handle('http', () => new Response('', { status: 403 }))
    ses.protocol.handle('https', request => {
      requests++
      if (new URL(request.url).origin !== 'https://article.example.invalid') return new Response('', { status: 403 })
      const headers = {
        'content-type': 'text/html', 'x-dns-prefetch-control': 'off',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; connect-src https:; worker-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; webrtc 'block'"
      }
      if (mode === 'connection-allowlist') headers['connection-allowlist'] = '()'
      return new Response(request.url.endsWith('/data') ? 'data' : '<html><body><main id="main">Initial</main><script>document.getElementById("main").textContent="Rendered"</script></body></html>', { headers })
    })
    const win = new BrowserWindow({ show: false, webPreferences: {
      session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true, disableBlinkFeatures: 'WebTransport'
    } })
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      win.webContents.on('console-message', (_event, _level, text) => messages.push(text))
      await win.loadURL('https://article.example.invalid/')
      const result = await win.webContents.executeJavaScript(`(async () => {
        let fetchSucceeded = false
        try { await fetch('https://article.example.invalid/data'); fetchSucceeded = true } catch {}
        let rtc = 'absent'
        if (typeof RTCPeerConnection === 'function') {
          const pc = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'relay' })
          try {
            pc.createDataChannel('probe')
            await pc.setLocalDescription(await pc.createOffer())
            await new Promise(resolve => setTimeout(resolve, 200))
            rtc = pc.connectionState
          } finally { pc.close() }
        }
        return { rendered: document.getElementById('main').textContent, fetchSucceeded, rtc,
          webTransport: typeof WebTransport, node: typeof require, bridge: typeof electronAPI }
      })()`)
      reports.push({ mode, requests, result, messages })
    } finally {
      win.destroy()
      ses.protocol.unhandle('http'); ses.protocol.unhandle('https')
      await ses.clearStorageData()
    }
  }
  fs.writeFileSync(output, JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, reports }, null, 2))
  app.exit(0)
}).catch(error => { console.error(String(error)); app.exit(1) })
setTimeout(() => app.exit(2), 12_000)
