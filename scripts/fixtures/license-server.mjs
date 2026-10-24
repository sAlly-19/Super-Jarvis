// scripts/fixtures/license-server.mjs
// Lightweight ephemeral license server for loopback smoke testing.

import http from 'node:http'
import { generateSmokeKeypair, signSmokeLease } from './smoke-license-keypair.mjs'

export async function createSmokeLicenseServer(options = {}) {
  const keypair = options.keypair || await generateSmokeKeypair()
  const port = options.port || 0
  const host = '127.0.0.1'

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

    if (req.method === 'GET' && url.pathname === '/v1/licenses/public-key') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        kid: keypair.keyId,
        publicKey: keypair.publicKey
      }))
      return
    }

    if (req.method === 'POST' && (url.pathname === '/v1/licenses/activate' || url.pathname === '/v1/licenses/validate')) {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        let parsed = {}
        try { parsed = JSON.parse(body) } catch {}

        const now = Math.floor(Date.now() / 1000)
        const claims = {
          iss: 'jasper-smoke-server',
          aud: 'jasper-desktop',
          installationId: parsed.installationId || 'smoke-inst-1',
          machineHash: parsed.machineHash || 'smoke-hwid-hash',
          iat: now,
          exp: now + (options.leaseDurationSeconds || 72 * 3600),
          tier: 'commercial-pro'
        }

        const leaseJwt = signSmokeLease(claims, keypair.rawPrivateKey, keypair.keyId)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          valid: true,
          status: 'ACTIVE',
          client: {
            name: 'Smoke Test Client',
            email: 'smoke@example.com'
          },
          trustedServerTime: Date.now(),
          leaseToken: leaseJwt,
          expiresAt: new Date((now + 72 * 3600) * 1000).toISOString()
        }))
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'NOT_FOUND' }))
  })

  await new Promise((resolve) => {
    server.listen(port, host, () => resolve())
  })

  const addr = server.address()
  const serverUrl = `http://127.0.0.1:${addr.port}`

  return {
    server,
    url: serverUrl,
    keypair,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

if (process.argv[1] && process.argv[1].endsWith('license-server.mjs')) {
  createSmokeLicenseServer().then((instance) => {
    console.log(`Smoke license server listening at ${instance.url}`)
  })
}

