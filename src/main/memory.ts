import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import type { MemoryItem, JasperMemory } from '@shared'
import { atomicWriteJsonSync, readJsonFileSync } from './utils/atomic-json'

export type { MemoryItem, JasperMemory }

const MEMORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function freshDefaultMemory(): JasperMemory {
  return { userName: '', userPreferences: [], facts: [] }
}

export function getMemoryFilePath(): string {
  return join(app.getPath('userData'), 'jasper-memory.json')
}

export function sanitizeFact(input: string): string {
  // Strip all HTML tags and escape sensitive characters
  const stripped = input.replace(/<[^>]*>/g, '')
  return stripped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
}

export function loadMemory(): JasperMemory {
  try {
    const memPath = getMemoryFilePath()
    if (fs.existsSync(memPath)) {
      const data = readJsonFileSync<JasperMemory>(memPath)
      const allFacts: MemoryItem[] = Array.isArray(data.facts) ? data.facts : []
      const cutoff = Date.now() - MEMORY_RETENTION_MS
      const retainedFacts = allFacts.filter((item) => {
        const createdAt = Date.parse(item?.createdAt)
        return Number.isFinite(createdAt) && createdAt >= cutoff
      })
      const memory: JasperMemory = {
        userName: data.userName || '',
        userPreferences: Array.isArray(data.userPreferences) ? data.userPreferences : [],
        facts: retainedFacts
      }
      if (retainedFacts.length !== allFacts.length) saveMemory(memory)
      return memory
    }
  } catch (err) {
    console.warn('[Memory] Error reading jasper-memory.json:', err)
  }
  return freshDefaultMemory()
}

export function saveMemory(memory: JasperMemory): void {
  try {
    const memPath = getMemoryFilePath()
    atomicWriteJsonSync(memPath, memory)
    console.log('[Memory] Memory saved successfully.')
  } catch (err) {
    console.warn('[Memory] Error writing to jasper-memory.json:', err)
  }
}

export function addFact(fact: string): string {
  const mem = loadMemory()
  const cleanFact = sanitizeFact(fact)
  if (!cleanFact) return 'Fato inválido ou vazio após sanitização.'

  // Prevent exact duplicates
  if (!mem.facts.some((f) => f.fact.toLowerCase() === cleanFact.toLowerCase())) {
    mem.facts.push({
      id: Date.now().toString(),
      fact: cleanFact,
      createdAt: new Date().toISOString()
    })
    saveMemory(mem)
    return `Fato memorizado com sucesso: "${cleanFact}".`
  }
  return `Já me lembrava disso: "${cleanFact}".`
}

export function getMemorySummary(): string {
  const mem = loadMemory()
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

