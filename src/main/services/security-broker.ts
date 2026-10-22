import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getMainWindow } from '../windows/main-window'
import { configStore } from '../config/config-store'
import type { ConfirmationMode } from '@shared'

export type ConfirmationRisk = 'common' | 'elevated' | 'mandatory' | 'critical'

export function requiresConfirmation(mode: ConfirmationMode, risk: ConfirmationRisk): boolean {
  if (risk === 'mandatory' || risk === 'critical') return true
  if (mode === 'all') return false
  if (mode === 'common' && risk === 'common') return false
  return true
}

export interface ConfirmationRequest {
  title: string
  message: string
  detail: string
  confirmLabel: string
  risk?: ConfirmationRisk
}

export interface SafePathResult {
  allowed: boolean
  resolvedPath?: string
  reason?: string
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export class SecurityBroker {
  public async confirmOperation(request: ConfirmationRequest): Promise<boolean> {
    const risk = request.risk || 'elevated'
    const mode = configStore.getConfig().confirmationMode || 'strict'
    if (!requiresConfirmation(mode, risk)) {
      console.log(`[SecurityBroker] Confirmation bypassed by ${mode} mode for ${risk} action.`)
      return true
    }
    const options = {
      type: 'question' as const,
      title: request.title.slice(0, 120),
      message: request.message.slice(0, 500),
      detail: `${request.detail}\n\nModo atual: ${mode}. Ações permanentemente protegidas sempre exigem confirmação.`.slice(0, 1500),
      buttons: ['Cancelar', request.confirmLabel.slice(0, 80)],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }
    const win = getMainWindow()
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    return result.response === 1
  }

  public resolveUserPath(input: string): SafePathResult {
    const trimmed = input.trim()
    if (!trimmed || trimmed.includes('\0') || trimmed.length > 4096 || /^\\\\/.test(trimmed)) {
      return { allowed: false, reason: 'Caminho vazio, UNC ou invalido.' }
    }

    const alias = trimmed.toLowerCase()
    const aliases: Record<string, string> = {
      download: app.getPath('downloads'),
      downloads: app.getPath('downloads'),
      desktop: app.getPath('desktop'),
      'area de trabalho': app.getPath('desktop'),
      documents: app.getPath('documents'),
      documentos: app.getPath('documents')
    }
    const candidate = aliases[alias] || trimmed
    if (!path.isAbsolute(candidate)) return { allowed: false, reason: 'Use uma pasta conhecida ou caminho absoluto do usuario.' }

    const withoutDrive = candidate.replace(/^[a-z]:/i, '')
    if (withoutDrive.includes(':')) return { allowed: false, reason: 'Alternate Data Streams nao sao permitidos.' }

    try {
      const absoluteCandidate = path.resolve(candidate)
      const lexicalAllowedRoots = [app.getPath('downloads'), app.getPath('desktop'), app.getPath('documents')]
        .filter((root, index, roots) => roots.indexOf(root) === index)
        .filter((root) => fs.existsSync(root))
        .map((root) => path.resolve(root))

      const lexicalRoot = lexicalAllowedRoots.find((root) => {
        const comparableRoot = process.platform === 'win32' ? root.toLowerCase() : root
        const comparableCandidate = process.platform === 'win32' ? absoluteCandidate.toLowerCase() : absoluteCandidate
        return isContained(comparableRoot, comparableCandidate)
      })
      if (!lexicalRoot) return { allowed: false, reason: 'Caminho fora de Downloads, Desktop ou Documentos.' }

      let current = lexicalRoot
      for (const part of path.relative(lexicalRoot, absoluteCandidate).split(path.sep).filter(Boolean)) {
        current = path.join(current, part)
        if (fs.lstatSync(current).isSymbolicLink()) {
          return { allowed: false, reason: 'Links simbolicos e junctions nao sao permitidos.' }
        }
      }

      const resolved = fs.realpathSync.native(absoluteCandidate)
      const realAllowedRoots = lexicalAllowedRoots.map((root) => fs.realpathSync.native(root))
      const comparableTarget = process.platform === 'win32' ? resolved.toLowerCase() : resolved
      const allowed = realAllowedRoots.some((root) => {
        const comparableRoot = process.platform === 'win32' ? root.toLowerCase() : root
        return isContained(comparableRoot, comparableTarget)
      })
      return allowed
        ? { allowed: true, resolvedPath: resolved }
        : { allowed: false, reason: 'Caminho fora de Downloads, Desktop ou Documentos.' }
    } catch {
      return { allowed: false, reason: 'Caminho inexistente ou inacessivel.' }
    }
  }
}

export const securityBroker = new SecurityBroker()
