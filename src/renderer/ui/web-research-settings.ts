import type { HistorySnapshot, WebResearchRecord } from '@shared'
let initialized = false
export function sourceButton(id: string, title: string, url: string): HTMLButtonElement | null {
  try {
    const target = new URL(url)
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || url.length > 4096) return null
  } catch { return null }
  const button = document.createElement('button')
  button.type = 'button'; button.className = 'btn-toggle web-source-link'; button.textContent = title || url; button.title = url
  button.addEventListener('click', () => { void window.electronAPI.openWebResearchSource(id, url).catch(() => { button.textContent = 'Fonte indisponível — recarregue o histórico' }) })
  return button
}
export function initializeWebResearchSettings(): void {
  const list = document.getElementById('web-history-list'), detail = document.getElementById('web-history-detail'), feedback = document.getElementById('web-feedback')
  const clear = document.getElementById('web-clear') as HTMLButtonElement | null, test = document.getElementById('web-test') as HTMLButtonElement | null
  if (initialized || !list || !detail || !feedback || !clear || !test) return
  initialized = true
  let request = 0, snapshot: HistorySnapshot | null = null, selectedId: string | null = null
  const describe = (record: WebResearchRecord) => {
    detail.replaceChildren()
    const title = document.createElement('h5'); title.textContent = record.query
    const meta = document.createElement('p'); meta.textContent = `Consultado em ${new Date(record.createdAt).toLocaleString('pt-BR')} · ${record.state}`
    const summary = document.createElement('p'); summary.textContent = record.summaryState === 'available' ? record.summary : record.summaryState === 'pending' ? 'Resumo pendente.' : 'Resumo indisponível.'
    detail.append(title, meta, summary)
    for (const page of record.pages) {
      const heading = document.createElement('h5'); heading.textContent = `${page.title}${page.truncated ? ' · conteúdo parcial' : ''}`
      const date = document.createElement('p'); date.textContent = `Leitura: ${new Date(page.fetchedAt).toLocaleString('pt-BR')} · publicação: ${page.publishedAt ?? 'não informada'}`
      const text = document.createElement('pre'); text.textContent = page.text
      detail.append(heading, date, text)
    }
    for (const source of [...record.pages, ...record.results]) {
      const button = sourceButton(record.id, source.title, source.url)
      if (button) detail.append(button)
    }
  }
  async function refresh() {
    const version = ++request
    try {
      const [state, modules] = await Promise.all([window.electronAPI.listWebResearch(), window.electronAPI.listModules()])
      if (version !== request) return
      snapshot = state
      const module = modules.find(item => item.id === 'web-research')
      test!.disabled = !module?.enabled || !module.authorized || module.lifecycle !== 'running' || module.health !== 'healthy'
      clear!.disabled = !module?.authorized
      list!.replaceChildren()
      feedback!.textContent = state.storage === 'unavailable'
        ? 'Histórico protegido indisponível. Dados anteriores foram preservados; consultas podem usar apenas memória temporária.'
        : module?.enabled ? 'Busca sem chave adicional · leitura HTTP. Sites que exigem JavaScript ainda não são suportados.' : 'Módulo desativado. O histórico permanece disponível.'
      if (state.storage === 'unavailable') { selectedId = null; detail!.replaceChildren(); return }
      if (selectedId && !state.items.some(item => item.id === selectedId)) { selectedId = null; detail!.replaceChildren() }
      if (!state.items.length) { const empty = document.createElement('p'); empty.textContent = 'Nenhuma pesquisa salva.'; list!.append(empty) }
      for (const item of state.items.slice(0, 10)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-toggle web-history-entry'
        button.textContent = `${item.query} · ${new Date(item.createdAt).toLocaleString('pt-BR')} · ${item.pageCount} página(s)`
        button.addEventListener('click', async () => {
          selectedId = item.id
          const current = ++request
          try { const record = await window.electronAPI.getWebResearch(item.id); if (current === request) { if (record) describe(record); else detail!.textContent = 'Pesquisa não está mais disponível.' } }
          catch { if (current === request) detail!.textContent = 'Não foi possível abrir o histórico protegido.' }
        })
        list!.append(button)
      }
    } catch {
      if (version !== request) return
      snapshot = null; selectedId = null; list!.replaceChildren(); detail!.replaceChildren(); clear!.disabled = true; test!.disabled = true
      feedback!.textContent = 'Pesquisa web indisponível. Verifique licença e consentimento operacional.'
    }
  }
  clear.addEventListener('click', async () => {
    if (!snapshot) return
    ++request; selectedId = null; clear.disabled = true; detail.replaceChildren()
    try { await window.electronAPI.clearWebResearch(snapshot.generation); await refresh() }
    catch { await refresh(); feedback.textContent = 'Não foi possível limpar. Histórico recarregado.' }
  })
  test.addEventListener('click', async () => {
    test.disabled = true; feedback.textContent = 'Testando busca pública, sem salvar no histórico…'
    try {
      const result = await window.electronAPI.testWebResearch()
      feedback.textContent = ['ok', 'empty'].includes(result.state) ? 'Busca respondeu. Disponibilidade pode variar por site.' : `Busca indisponível: ${result.code ?? result.state}.`
    } catch { feedback.textContent = 'Não foi possível testar a busca. Verifique módulo, licença e conexão.' }
    finally { test.disabled = false }
  })
  window.electronAPI.onWebResearchChanged(() => { void refresh() })
  window.electronAPI.onLicenseState(() => { detail.replaceChildren(); void refresh() })
  window.addEventListener('jasper-modules-changed', () => { detail.replaceChildren(); void refresh() })
  void refresh()
}
