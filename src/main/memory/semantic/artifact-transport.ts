import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { BlockList, isIP, type Socket } from 'node:net'
import { createHash } from 'node:crypto'
import { Transform, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { WebNetworkPolicy, type ApprovedWebTarget } from '../../modules/web-research/network-policy'
import type { SemanticScope } from './contracts'
import type { ModelAsset } from './model-manifest-validator'
import { SEMANTIC_MODEL_MANIFEST } from './model-manifest'
import { checkModelScope } from './model-files'

export interface ArtifactTransport { download(asset: ModelAsset, revision: string, destination: Writable, scope: SemanticScope, onBytes: (n: number) => void): Promise<void> }
export type ArtifactRequest = (url: URL, options: RequestOptions, respond: (message: IncomingMessage) => void) => ClientRequest
const hosts = new Set(['huggingface.co', 'us.aws.cdn.hf.co'])
const redirectCodes = new Set([301, 302, 303, 307, 308])
const error = (code: string) => new Error(`model_download_${code}`)

/** HTTPS streaming only; no ambient proxy/cookie agent, decompression, retry or arbitrary destination URL. */
export class ArtifactHttpTransport implements ArtifactTransport {
  private readonly policy: WebNetworkPolicy
  private readonly request: ArtifactRequest
  constructor(deps: { policy?: WebNetworkPolicy; request?: ArtifactRequest } = {}) {
    this.policy = deps.policy ?? new WebNetworkPolicy()
    this.request = deps.request ?? httpsRequest
  }
  async download(asset: ModelAsset, revision: string, destination: Writable, scope: SemanticScope, onBytes: (n: number) => void): Promise<void> {
    checkModelScope(scope)
    if (revision !== SEMANTIC_MODEL_MANIFEST.revision || !SEMANTIC_MODEL_MANIFEST.assets.some(item => item.path === asset.path) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 160 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw error('manifest')
    let raw = `https://huggingface.co/${SEMANTIC_MODEL_MANIFEST.modelId}/resolve/${revision}/${asset.path}`
    const visited = new Set<string>()
    for (let hop = 0; ; hop++) {
      let url: URL
      try { url = this.policy.validateUrl(raw) } catch { throw error('blocked') }
      if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port && url.port !== '443' || visited.has(url.href)) throw error('blocked')
      visited.add(url.href)
      const target = await this.policy.approve(url.href, scope); checkModelScope(scope)
      const redirect = await this.once(target, asset, destination, scope, onBytes)
      checkModelScope(scope)
      if (!redirect) return
      if (hop >= 5 || /[\u0000-\u0020\u007f\\]/.test(redirect)) throw error('redirect')
      try { raw = new URL(redirect, url).href } catch { throw error('redirect') }
    }
  }
  private once(target: ApprovedWebTarget, asset: ModelAsset, destination: Writable, scope: SemanticScope, onBytes: (n: number) => void): Promise<string | null> {
    const url = new URL(target.url)
    return new Promise((resolve, reject) => {
      let request: ClientRequest | undefined, response: IncomingMessage | undefined, socket: Socket | undefined
      let settled = false, responded = false
      let idle: ReturnType<typeof setTimeout>, deadline: ReturnType<typeof setTimeout>
      const finish = (cause?: Error, redirect: string | null = null) => {
        if (settled) return
        settled = true; clearTimeout(idle); clearTimeout(deadline)
        scope.signal.removeEventListener('abort', abort)
        socket?.removeListener('secureConnect', connected)
        if (cause) { response?.destroy(); request?.destroy(); reject(cause) }
        else resolve(redirect)
      }
      const abort = () => finish(error('cancelled'))
      const progress = () => { clearTimeout(idle); idle = setTimeout(() => finish(error('timeout')), 30000) }
      const connected = () => {
        if (settled) return
        try {
          checkModelScope(scope)
          const allowed = new BlockList(); allowed.addAddress(target.address, target.family === 4 ? 'ipv4' : 'ipv6')
          const peer = socket?.remoteAddress, family = peer ? isIP(peer) : 0
          if (!peer || !family || !allowed.check(peer, family === 4 ? 'ipv4' : 'ipv6')) throw error('blocked')
          request!.end()
        } catch { finish(error('blocked')) }
      }
      scope.signal.addEventListener('abort', abort, { once: true })
      deadline = setTimeout(() => finish(error('timeout')), Math.max(0, scope.deadline - Date.now())); progress()
      try {
        checkModelScope(scope)
        request = this.request(url, {
          method: 'GET', agent: false, rejectUnauthorized: true, servername: url.hostname, maxHeaderSize: 16384,
          headers: { Host: url.host, Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': 'Jasper-AI-LocalModels/1.0' },
          lookup: (_host, options, callback) => {
            if (typeof options === 'object' && options.all) (callback as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(null, [{ address: target.address, family: target.family }])
            else callback(null, target.address, target.family)
          }
        }, message => {
          if (settled) { message.destroy(); return }
          response = message; responded = true; progress()
          try {
            checkModelScope(scope)
            if (redirectCodes.has(message.statusCode ?? 0)) {
              const location = message.headers.location; message.destroy()
              if (!location) throw error('redirect')
              finish(undefined, location); return
            }
            if (message.statusCode !== 200) throw error('status')
            if (String(message.headers['content-encoding'] ?? 'identity').trim().toLowerCase() !== 'identity') throw error('encoding')
            const length = message.headers['content-length']
            if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) !== asset.bytes)) throw error('size')
            let bytes = 0
            const hash = createHash('sha256')
            const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
              try {
                checkModelScope(scope); bytes += chunk.length
                if (bytes > asset.bytes) throw error('size')
                hash.update(chunk); onBytes(chunk.length); progress(); callback(null, chunk)
              } catch { callback(error('invalidated')) }
            } })
            void pipeline(message, counter, destination, { signal: scope.signal }).then(() => {
              checkModelScope(scope)
              if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw error('integrity')
              finish()
            }).catch(() => finish(error(scope.signal.aborted ? 'cancelled' : 'integrity')))
          } catch (cause) { finish(cause instanceof Error && cause.message.startsWith('model_download_') ? cause : error('invalidated')) }
        })
        request.on('error', () => finish(error('network')))
        request.once('upgrade', (_response, upgraded) => { upgraded.destroy(); finish(error('status')) })
        request.once('close', () => { if (!responded && !settled) finish(error('network')) })
        request.once('socket', value => {
          socket = value
          if (settled) { value.destroy(); return }
          if (!value.connecting && value.remoteAddress) connected()
          else value.once('secureConnect', connected)
        })
      } catch { finish(error('network')) }
    })
  }
}
