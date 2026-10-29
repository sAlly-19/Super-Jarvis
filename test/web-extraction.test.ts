import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { extractWebPage } from '../src/main/modules/web-research/extraction'

const meta = { url: 'https://example.org/article', fetchedAt: '2026-10-29T14:00:00.000Z', mode: 'http' as const }
const fixture = (name: string) => fs.readFileSync(`test/fixtures/web/${name}.html`, 'utf8')

test('web extraction selects editorial content and retains observed source metadata', () => {
  const { page, needsRendering, accessBlocked } = extractWebPage(fixture('article'), meta)
  assert.match(page.text, /Research headline.*Useful article/)
  assert.doesNotMatch(page.text, /navigation|footer|Not editorial|must not run/)
  assert.equal(page.title, 'Article & sources')
  assert.equal(page.url, meta.url); assert.equal(page.fetchedAt, meta.fetchedAt)
  assert.equal(page.publishedAt, '2026-10-29T09:00:00-03:00')
  assert.equal(needsRendering, false); assert.equal(accessBlocked, false)
})

test('short editorial text remains a valid article and a JavaScript shell requests rendering', () => {
  assert.equal(extractWebPage(fixture('short-article'), meta).needsRendering, false)
  const shell = extractWebPage(fixture('js-shell'), meta)
  assert.equal(shell.needsRendering, true); assert.equal(shell.accessBlocked, false)
  assert.equal(shell.page.text, '')
  const plain = extractWebPage('A useful plain text document.', meta)
  assert.equal(plain.needsRendering, false); assert.equal(plain.page.publishedAt, null)
})

test('web extraction identifies structural access walls without mistaking an article about CAPTCHA for a wall', () => {
  const wall = extractWebPage(fixture('access-wall'), meta)
  assert.equal(wall.accessBlocked, true); assert.equal(wall.needsRendering, false)
  const captcha = extractWebPage(fixture('search-captcha'), meta)
  assert.equal(captcha.accessBlocked, true)
  assert.equal(extractWebPage('<article><h1>How CAPTCHA and paywalls work</h1><p>An explanation.</p></article>', meta).accessBlocked, false)
})

test('web extraction preserves valid source dates without inventing dates, timezone or executing JSON-LD', () => {
  const from = (value: string) => extractWebPage(`<meta property="article:published_time" content="${value}"><article>Text.</article>`, meta).page.publishedAt
  assert.equal(from('2026-10-29'), '2026-10-29')
  for (const value of ['2026-02-30', '2026-10-29T09:00', 'yesterday', '2026-10-29T24:00:00Z', 'bad']) assert.equal(from(value), null)
  const ld = '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-28"}</script><article>Known content.</article>'
  assert.equal(extractWebPage(ld, meta).page.publishedAt, '2026-10-28')
  const invalid = '<script type="application/ld+json">throw new Error("executed")</script><article>Known content.</article>'
  assert.equal(extractWebPage(invalid, meta).page.publishedAt, null)
})

test('web extraction only treats explicitly published time elements as publication dates', () => {
  for (const attributes of ['', 'itemprop="dateModified"', 'itemprop="startDate"']) {
    const html = `<article><time ${attributes} datetime="2026-10-29">Date</time><p>Text</p></article>`
    assert.equal(extractWebPage(html, meta).page.publishedAt, null)
  }
  for (const attributes of ['itemprop="datePublished"', 'pubdate']) {
    const html = `<article><time ${attributes} datetime="2026-10-29">Published</time></article>`
    assert.equal(extractWebPage(html, meta).page.publishedAt, '2026-10-29')
  }
})

test('web extraction bounds multibyte text at 48KiB and handles malformed HTML', () => {
  const result = extractWebPage('<article>' + '😀á'.repeat(20000) + '</article>', meta)
  assert.ok(Buffer.byteLength(result.page.text, 'utf8') <= 49152)
  assert.equal(result.page.truncated, true)
  assert.equal(result.page.text.includes('\ufffd'), false)
  const broken = extractWebPage(fixture('malformed'), meta)
  assert.match(broken.page.text, /First.*Second/)
  assert.doesNotMatch(broken.page.text, /Menu/)
})
