import { initializeWebResearchSettings } from '../../../src/renderer/ui/web-research-settings'
import { initializeWebResearchSources } from '../../../src/renderer/ui/web-research-sources'
import type { WebResearchRecord } from '../../../src/shared/types/web-research'
const records: WebResearchRecord[] = Array.from({ length: 10 }, (_, index) => ({ id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
  sequence: index + 1, createdAt: '2026-10-30T12:00:00.000Z', updatedAt: '2026-10-30T12:00:00.000Z', state: 'complete', query: `Pesquisa ${index + 1}`,
  results: [{ title: 'Fonte pública', url: 'https://example.org/article', snippet: 'Snippet, não artigo lido' }],
  pages: [{ title: 'Artigo', url: 'https://example.org/article', text: '<script>window.webPwned=true</script> Texto da fonte.', fetchedAt: '2026-10-30T12:00:00.000Z', publishedAt: null, mode: 'http', truncated: false }], summary: null, summaryState: 'pending' }))
let items = [...records].reverse(), generation = 0, unavailable = false, network = 0
const changedListeners: Array<() => void> = []
const changed = () => changedListeners.forEach(callback => callback())
let sources: (value: any) => void = () => {}
Object.defineProperty(window, 'electronAPI', { value: {
  listModules: async () => [{ id: 'web-research', enabled: true, authorized: true, health: 'healthy', lifecycle: 'running' }],
  listWebResearch: async () => ({ generation, storage: unavailable ? 'unavailable' : 'saved', items: items.map(({ pages, ...r }) => ({ ...r, pageCount: pages.length })) }),
  getWebResearch: async (id: string) => items.find(r => r.id === id) ?? null,
  clearWebResearch: async () => { items = []; generation++; changed(); return { generation, storage: 'saved', items: [] } },
  testWebResearch: async () => { network++; return { state: 'empty', results: [] } },
  openWebResearchSource: async () => {}, onWebResearchChanged: (callback: () => void) => { changedListeners.push(callback); return () => {} },
  onWebResearchSources: (callback: (value: any) => void) => { sources = callback; return () => {} }, onLicenseState: () => () => {}
} })
const wait = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000
  while (!predicate()) { if (Date.now() > deadline) throw Error('ui_timeout'); await new Promise(r => setTimeout(r, 20)) }
}
;(async () => {
  document.getElementById('settings-modal')!.classList.remove('hidden')
  document.querySelectorAll('.settings-tab-pane').forEach(n => n.classList.remove('active'))
  document.getElementById('tab-system')!.classList.add('active')
  initializeWebResearchSettings(); initializeWebResearchSources()
  await wait(() => document.querySelectorAll('#web-history-list button').length === 10)
  if (network !== 0) throw Error('implicit_network')
  ;(document.querySelector('#web-history-list button') as HTMLButtonElement).click()
  await wait(() => !!document.getElementById('web-history-detail')!.textContent?.includes('<script>'))
  if ((window as any).webPwned || document.querySelector('#web-history-detail script')) throw Error('html_executed')
  ;(document.querySelectorAll('#web-history-list button')[9] as HTMLButtonElement).click()
  await wait(() => !!document.getElementById('web-history-detail')!.textContent?.startsWith('Pesquisa 1'))
  const eleventh = { ...structuredClone(records[9]), id: '00000011-1111-4111-8111-111111111111', sequence: 11, query: 'Pesquisa 11' }
  items = [eleventh, ...items.slice(0, 9)]; changed()
  await wait(() => !document.getElementById('web-history-detail')!.textContent)
  sources({ researchId: records[9].id, query: 'Pergunta pública', consultedAt: records[9].createdAt, sources: [{ title: '<img onerror=alert(1)>', url: 'https://example.org/article' }, { title: 'Bad', url: 'javascript:alert(1)' }] })
  if (document.querySelectorAll('#web-research-sources button').length !== 1) throw Error('unsafe_sources')
  ;(document.getElementById('web-test') as HTMLButtonElement).click()
  await wait(() => network === 1)
  ;(document.getElementById('web-clear') as HTMLButtonElement).click()
  await wait(() => document.querySelectorAll('#web-history-list button').length === 0)
  unavailable = true; changed()
  await wait(() => !!document.getElementById('web-feedback')!.textContent?.includes('indisponível'))
  unavailable = false; items = [...records].reverse(); changed()
  await wait(() => document.querySelectorAll('#web-history-list button').length === 10)
  document.getElementById('settings-section-title')!.textContent = 'Sistema & Automação'
  ;(document.querySelector('#web-panel details') as HTMLDetailsElement).open = true
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  document.getElementById('web-heading')!.scrollIntoView({ block: 'start' })
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  console.log('WEB_UI_PASS')
})().catch(error => console.error('WEB_UI_FAIL ' + String(error)))
