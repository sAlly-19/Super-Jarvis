import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import type { MemoryItem, JasperMemory } from '@shared'
import { atomicWriteJsonSync, readJsonFileSync } from './utils/atomic-json'
import { getHardwareInfo } from './services/hwid'

export type { MemoryItem, JasperMemory }

export const MEMORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function getMemoryFilePath(): string {
  try {
    const userPath = app?.getPath ? app.getPath('userData') : process.cwd()
    const primary = join(userPath, 'memory.json')
    const legacy = join(userPath, 'jasper-memory.json')
    if (!fs.existsSync(primary) && fs.existsSync(legacy)) {
      return legacy
    }
    return primary
  } catch {
    return join(process.cwd(), 'memory.json')
  }
}

export function sanitizeFact(input: string): string {
  const withoutScripts = input.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  const stripped = withoutScripts.replace(/<[^>]*>/g, '')
  return stripped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
}

export interface MemoryStoreOptions {
  filePath?: string
  installationId?: string
}

export class MemoryStore {
  private filePath: string
  private installationId?: string

  constructor(options: MemoryStoreOptions = {}) {
    this.filePath = options.filePath || getMemoryFilePath()
    this.installationId = options.installationId
  }

  private resolveInstallationId(): string {
    if (this.installationId) return this.installationId
    try {
      return getHardwareInfo().machineId
    } catch {
      return 'HWID-LOCAL-DEV'
    }
  }

  private freshDefault(installationId?: string): JasperMemory {
    return {
      installationId: installationId || this.resolveInstallationId(),
      updatedAt: new Date().toISOString(),
      userName: '',
      userPreferences: [],
      facts: []
    }
  }

  public load(): JasperMemory {
    const activeHwid = this.resolveInstallationId()
    try {
      if (fs.existsSync(this.filePath)) {
        const data = readJsonFileSync<JasperMemory>(this.filePath)

        // Validate installationId
        if (data && data.installationId && data.installationId !== activeHwid) {
          console.warn(`[MemoryStore] Mismatching installationId (${data.installationId} !== ${activeHwid}). Resetting store.`)
          const fresh = this.freshDefault(activeHwid)
          this.save(fresh)
          return fresh
        }

        const allFacts: MemoryItem[] = Array.isArray(data?.facts) ? data.facts : []
        const cutoff = Date.now() - MEMORY_RETENTION_MS
        const retainedFacts = allFacts.filter((item) => {
          if (!item || typeof item.fact !== 'string' || typeof item.createdAt !== 'string') return false
          const createdAt = Date.parse(item.createdAt)
          return Number.isFinite(createdAt) && createdAt >= cutoff
        })

        const memory: JasperMemory = {
          installationId: activeHwid,
          updatedAt: data?.updatedAt || new Date().toISOString(),
          userName: data?.userName || '',
          userPreferences: Array.isArray(data?.userPreferences) ? data.userPreferences : [],
          facts: retainedFacts
        }

        if (retainedFacts.length !== allFacts.length || !data?.installationId) {
          this.save(memory)
        }
        return memory
      }
    } catch (err) {
      console.warn('[MemoryStore] Error reading memory file:', err)
    }

    const fresh = this.freshDefault(activeHwid)
    return fresh
  }

  public save(memory: JasperMemory): void {
    const activeHwid = this.resolveInstallationId()
    const cutoff = Date.now() - MEMORY_RETENTION_MS
    const allFacts = Array.isArray(memory.facts) ? memory.facts : []
    const retainedFacts = allFacts.filter((item) => {
      if (!item || typeof item.fact !== 'string' || typeof item.createdAt !== 'string') return false
      const createdAt = Date.parse(item.createdAt)
      return Number.isFinite(createdAt) && createdAt >= cutoff
    })

    const payload: JasperMemory = {
      installationId: activeHwid,
      updatedAt: new Date().toISOString(),
      userName: memory.userName || '',
      userPreferences: Array.isArray(memory.userPreferences) ? memory.userPreferences : [],
      facts: retainedFacts
    }

    atomicWriteJsonSync(this.filePath, payload)
  }

  public addFact(fact: string): string {
    const mem = this.load()
    const cleanFact = sanitizeFact(fact)
    if (!cleanFact) return 'Fato inválido ou vazio após sanitização.'

    if (!mem.facts.some((f) => f.fact.toLowerCase() === cleanFact.toLowerCase())) {
      mem.facts.push({
        id: Date.now().toString(),
        fact: cleanFact,
        createdAt: new Date().toISOString()
      })
      this.save(mem)
      return `Fato memorizado com sucesso: "${cleanFact}".`
    }
    return `Já me lembrava disso: "${cleanFact}".`
  }

  public upsertFacts(incoming: Array<string | { fact: string; id?: string; createdAt?: string }>): MemoryItem[] {
    const mem = this.load()
    const updated: MemoryItem[] = []

    for (const item of incoming) {
      const factStr = typeof item === 'string' ? item : item?.fact
      if (!factStr || typeof factStr !== 'string') continue
      const cleanFact = sanitizeFact(factStr)
      if (!cleanFact) continue

      const existingIndex = mem.facts.findIndex((f) => f.fact.toLowerCase() === cleanFact.toLowerCase())
      if (existingIndex >= 0) {
        updated.push(mem.facts[existingIndex])
      } else {
        const newItem: MemoryItem = {
          id: typeof item !== 'string' && item.id ? item.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fact: cleanFact,
          createdAt: typeof item !== 'string' && item.createdAt ? item.createdAt : new Date().toISOString()
        }
        mem.facts.push(newItem)
        updated.push(newItem)
      }
    }

    this.save(mem)
    return updated
  }

  public clear(): void {
    const activeHwid = this.resolveInstallationId()
    const mem: JasperMemory = {
      installationId: activeHwid,
      updatedAt: new Date().toISOString(),
      userName: '',
      userPreferences: [],
      facts: []
    }
    this.save(mem)
  }

  public getSummary(): string {
    const mem = this.load()
    const parts: string[] = []

    if (mem.userName) {
      parts.push(`Nome do usuário: ${mem.userName}.`)
    }
    if (mem.userPreferences.length > 0) {
      parts.push(`Preferências: ${mem.userPreferences.join(', ')}.`)
    }
    if (mem.facts.length > 0) {
      parts.push(`Fatos memorizados: ${mem.facts.map((f) => f.fact).join(' | ')}.`)
    }

    return parts.length > 0 ? parts.join(' ') : 'Nenhum detalhe prévio gravado.'
  }
}

export const memoryStore = new MemoryStore()

export function loadMemory(): JasperMemory {
  return memoryStore.load()
}

export function saveMemory(memory: JasperMemory): void {
  memoryStore.save(memory)
}

export function addFact(fact: string): string {
  return memoryStore.addFact(fact)
}

export function clearMemory(): void {
  memoryStore.clear()
}

export function getMemorySummary(): string {
  return memoryStore.getSummary()
}
