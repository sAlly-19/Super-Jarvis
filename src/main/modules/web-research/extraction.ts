import { getOuterHTML, removeElement } from 'domutils'
import { convert } from 'html-to-text'
import { parseDocument, findAll, hasClass, elementText, clipWebText, type HtmlElement } from './html'
import { WEB_RESPONSE_BYTES, WebError, type WebPage } from './contracts'

const ignored = new Set(['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside', 'form', 'template'])
const textLimit = 48 * 1024

function sourceDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const timestamp = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  if (!date && !timestamp) return null
  const civil = value.slice(0, 10), midnight = Date.parse(civil + 'T00:00:00Z')
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== civil) return null
  return date || Number.isFinite(Date.parse(value)) ? value : null
}

function structuredDate(scripts: HtmlElement[]): string | null {
  for (const script of scripts) {
    const content = script.children.filter(node => node.type === 'text').map(node => 'data' in node ? node.data : '').join('')
    if (Buffer.byteLength(content) > 50 * 1024) continue
    let parsed: unknown
    try { parsed = JSON.parse(content) } catch { continue }
    const queue: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }]
    for (let visited = 0; queue.length && visited < 256; visited++) {
      const { value, depth } = queue.shift()!
      if (!value || typeof value !== 'object' || depth > 8) continue
      if (!Array.isArray(value)) {
        const entry = value as Record<string, unknown>
        const types = Array.isArray(entry['@type']) ? entry['@type'] : [entry['@type']]
        if (types.some(type => ['Article', 'NewsArticle', 'BlogPosting'].includes(String(type)))) {
          const date = sourceDate(entry.datePublished)
          if (date) return date
        }
      }
      for (const child of (Array.isArray(value) ? value : Object.values(value)).slice(0, 64)) {
        if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 })
      }
    }
  }
  return null
}

export function extractWebPage(html: string, meta: { url: string; fetchedAt: string; mode: 'http' | 'browser' }): {
  page: WebPage; needsRendering: boolean; accessBlocked: boolean
} {
  if (Buffer.byteLength(html) > WEB_RESPONSE_BYTES) throw new WebError('too_large')
  const document = parseDocument(html)
  const titleNode = findAll(node => node.name === 'title', document.children)[0]
  const title = titleNode ? elementText(titleNode, 512) : new URL(meta.url).hostname
  const scripts = findAll(node => node.name === 'script', document.children)
  const article = findAll(node => node.name === 'article', document.children)[0]
  const main = findAll(node => node.name === 'main', document.children)[0]
  const root = article ?? main ?? findAll(node => node.name === 'body', document.children)[0] ?? document
  const walls = findAll(node => node.attribs.id === 'challenge-form' || node.attribs.id === 'cf-challenge-running'
    || ['anomaly-modal', 'paywall', 'paywall-container', 'subscription-required'].some(name => hasClass(node, name))
    || (node.name === 'form' && (node.attribs.action ?? '').includes('/anomaly.js')), document.children)
  const password = findAll(node => node.name === 'input' && node.attribs.type?.toLowerCase() === 'password', document.children).length > 0
  const accessBlocked = walls.length > 0 || (!article && password)
  const dates = findAll(node => node.name === 'meta' && [node.attribs.property, node.attribs.name, node.attribs.itemprop]
    .some(key => ['article:published_time', 'datePublished', 'pubdate', 'date'].includes(key)), document.children)
    .map(node => sourceDate(node.attribs.content))
  const time = findAll(node => node.name === 'time' && !!node.attribs.datetime
    && ((node.attribs.itemprop ?? '').split(/\s+/).includes('datePublished')
      || Object.hasOwn(node.attribs, 'pubdate')), root.children).map(node => sourceDate(node.attribs.datetime))
  const publishedAt = dates.find(Boolean) ?? structuredDate(scripts.filter(node => node.attribs.type?.toLowerCase() === 'application/ld+json')) ?? time.find(Boolean) ?? null
  const appRoot = findAll(node => ['root', 'app', '__next', '__nuxt'].includes(node.attribs.id), document.children).length > 0
  for (const node of findAll(node => ignored.has(node.name), document.children)) removeElement(node)
  const text = clipWebText(convert(getOuterHTML(root), { wordwrap: false, selectors: [
    { selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' },
    ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(selector => ({ selector, options: { uppercase: false } }))
  ] }), Number.MAX_SAFE_INTEGER)
  const bytes = Buffer.from(text, 'utf8')
  let end = Math.min(bytes.length, textLimit)
  if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  const needsRendering = !accessBlocked && !article && scripts.length > 0 && appRoot
    && (!text || /^(?:loading|carregando)[.!…\s]*$/i.test(text))
  return { page: { title, url: meta.url, text: bytes.subarray(0, end).toString('utf8'), fetchedAt: meta.fetchedAt,
    publishedAt, mode: meta.mode, truncated: end < bytes.length }, needsRendering, accessBlocked }
}
