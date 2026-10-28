import { convert } from 'html-to-text'
export function normalizeEmailText(input: { text?: string; html?: string }): { text: string; truncated: boolean } {
  const value = (input.text !== undefined ? input.text : convert(input.html ?? '', { wordwrap: false,
    selectors: [{ selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }, { selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] })).replace(/\r\n?/g, '\n').replace(/\0/g, '')
  const bytes = Buffer.from(value, 'utf8'), limit = 102400
  if (bytes.length <= limit) return { text: value, truncated: false }
  let end = limit
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: true }
}
