import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { checkWebScope, withinWebScope, WebError, type WebScope } from './contracts'

const denied4 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) denied4.addSubnet(address, prefix, 'ipv4')
const public6 = new BlockList(), denied6 = new BlockList()
public6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['2620:4f:8000::', 48], ['3fff::', 20]] as const) {
  denied6.addSubnet(address, prefix, 'ipv6')
}

/** Conservative website policy based on IANA special registries; mapped/transition IPv6 is denied. */
export function isPublicWebAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? !denied4.check(address, 'ipv4')
    : family === 6 && public6.check(address, 'ipv6') && !denied6.check(address, 'ipv6')
}
type Address = { address: string; family: 4 | 6 }
export interface ApprovedWebTarget extends Address { url: string }
export class WebNetworkPolicy {
  private readonly resolve: (hostname: string) => Promise<Address[]>
  private readonly now: () => number
  constructor(deps: { resolve?: (hostname: string) => Promise<Address[]>; now?: () => number } = {}) {
    this.resolve = deps.resolve ?? (async hostname => await lookup(hostname, { all: true, verbatim: true }) as Address[])
    this.now = deps.now ?? Date.now
  }

  public validateUrl(raw: string): URL {
    const denied = () => { throw new WebError('blocked_url') }
    if (typeof raw !== 'string' || !raw || raw.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(raw) || !/^https?:\/\//i.test(raw)) denied()
    let url: URL
    try { url = new URL(raw) } catch { return denied() }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || raw.slice(raw.indexOf('://') + 3).split(/[/?#]/, 1)[0].includes('@')
      || (url.port && !['80', '443'].includes(url.port))) denied()
    const host = url.hostname.toLowerCase().replace(/\.+$/, '')
    const address = host.startsWith('[') ? host.slice(1, -1) : host
    if (!host || ['localhost', 'local', 'internal'].some(name => host === name || host.endsWith(`.${name}`))) denied()
    if (isIP(address) && !isPublicWebAddress(address)) denied()
    url.hostname = host
    url.hash = ''
    if (url.href.length > 4096) denied()
    return url
  }

  public async approve(raw: string, scope: WebScope): Promise<ApprovedWebTarget> {
    checkWebScope(scope, this.now)
    const url = this.validateUrl(raw)
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
    const family = isIP(hostname)
    if (family) return { url: url.href, address: hostname, family: family as 4 | 6 }
    let addresses: Address[]
    try { addresses = await withinWebScope(scope, () => this.resolve(hostname), this.now) }
    catch (error) {
      checkWebScope(scope, this.now)
      if (error instanceof WebError) throw error
      throw new WebError('network_unavailable')
    }
    checkWebScope(scope, this.now)
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64) throw new WebError('network_unavailable')
    if (addresses.some(item => !item || ![4, 6].includes(item.family) || isIP(item.address) !== item.family || !isPublicWebAddress(item.address))) throw new WebError('blocked_url')
    return { url: url.href, ...addresses[0] }
  }
}
