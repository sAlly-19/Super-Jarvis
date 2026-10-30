import { sourceButton } from './web-research-settings'
let initialized = false
export function initializeWebResearchSources(): void {
  const container = document.getElementById('web-research-sources')
  if (initialized || !container) return
  initialized = true
  let version = 0, researchId: string | null = null
  const reset = () => { ++version; researchId = null; container.replaceChildren(); container.hidden = true }
  window.electronAPI.onWebResearchSources(data => {
    ++version; researchId = data.researchId; container.replaceChildren()
    const title = document.createElement('strong'); title.textContent = 'Links da pesquisa'
    const query = document.createElement('p'); query.textContent = `${data.query} · ${new Date(data.consultedAt).toLocaleString('pt-BR')}`
    container.append(title, query)
    for (const source of data.sources.slice(0, 5)) { const button = sourceButton(data.researchId, source.title, source.url); if (button) container.append(button) }
    container.hidden = data.sources.length === 0
  })
  window.electronAPI.onWebResearchChanged(() => {
    const current = ++version, id = researchId
    if (id) void window.electronAPI.getWebResearch(id).then(record => { if (current === version && !record) reset() }).catch(() => { if (current === version) reset() })
  })
  window.electronAPI.onLicenseState(reset)
  window.addEventListener('jasper-modules-changed', reset)
}
