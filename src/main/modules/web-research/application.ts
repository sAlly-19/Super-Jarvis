import { WebResearchService, type WebApplicationDependencies } from './service'
export function startWebResearchApplication(deps: WebApplicationDependencies) {
  const service = new WebResearchService(deps)
  return { service, history: service.history, notes: service.notes,
    status: () => service.status(), clear: (generation: number) => service.clear(generation),
    list: () => service.listHistory(), get: (id: string) => service.getHistory(id),
    acceptNote: service.acceptNote.bind(service), testConnection: () => service.testConnection(),
    stop: () => service.stop(), restore: () => service.restore() }
}
export type WebResearchApplication = ReturnType<typeof startWebResearchApplication>
