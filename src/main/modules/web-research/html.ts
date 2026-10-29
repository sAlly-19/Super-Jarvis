import { parseDocument } from 'htmlparser2'
import { findAll, getOuterHTML } from 'domutils'
import { convert } from 'html-to-text'
import { WebError, WEB_RESPONSE_BYTES, type SafeHttpResponse } from './contracts'

export { parseDocument, findAll }
export type HtmlElement = ReturnType<typeof findAll>[number]
export function hasClass(element: HtmlElement, name: string): boolean {
  return (element.attribs.class ?? '').split(/\s+/).includes(name)
}
export function clipWebText(text: string, limit: number): string {
  let result = text.replace(/\s+/g, ' ').trim().slice(0, limit)
  const last = result.charCodeAt(result.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) result = result.slice(0, -1)
  return result
}
export function elementText(element: HtmlElement, limit: number): string {
  return clipWebText(convert(getOuterHTML(element), { wordwrap: false, selectors: [
    { selector: 'a', options: { ignoreHref: true } }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }
  ] }), limit)
}

/** Decode only declared text documents; never silently interpret a binary attachment as HTML. */
export function decodeWebText(response: SafeHttpResponse): string {
  if (response.body.byteLength > WEB_RESPONSE_BYTES) throw new WebError('too_large')
  const type = response.headers['content-type'] ?? ''
  if (!['text/html', 'text/plain', 'application/xhtml+xml'].includes(type.split(';', 1)[0].trim().toLowerCase())) throw new WebError('unsupported_content')
  const charset = (value: string) => /charset\s*=\s*["']?([^;\s"']+)/i.exec(value)?.[1]
  let encoding = charset(type)
  if (!encoding && !type.toLowerCase().startsWith('text/plain')) {
    const prefix = parseDocument(Buffer.from(response.body.subarray(0, 1024)).toString('latin1'))
    const meta = findAll(node => node.name === 'meta' && (!!node.attribs.charset
      || node.attribs['http-equiv']?.toLowerCase() === 'content-type'), prefix.children)[0]
    encoding = meta?.attribs.charset || charset(meta?.attribs.content ?? '')
  }
  try { return new TextDecoder(encoding || 'utf-8', { fatal: true }).decode(response.body) }
  catch { throw new WebError('unsupported_content') }
}
