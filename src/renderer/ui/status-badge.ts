import { DOM } from './dom'

let currentAgentName = 'Jasper'

export function getCurrentAgentName(): string {
  return currentAgentName
}

export function updateStatusBadge(state: string, label: string): void {
  if (DOM.statusBadge) {
    DOM.statusBadge.className = `status-badge ${state}`
  }
  if (DOM.statusText) {
    DOM.statusText.textContent = label
  }
}

export function applyAgentName(name: string, onNameChanged?: (cleanName: string) => void): string {
  const cleanName = (name && name.trim()) || 'Jasper'
  currentAgentName = cleanName

  if (DOM.brandName) {
    DOM.brandName.textContent = cleanName.toUpperCase()
  }
  if (DOM.transcriptSpeaker) {
    DOM.transcriptSpeaker.textContent = `${cleanName.toUpperCase()}:`
  }
  if (DOM.inputChatText) {
    DOM.inputChatText.placeholder = `Digite para o ${cleanName}...`
  }
  document.title = `${cleanName} AI - Voice Assistant`

  // Keep live status label aligned with new name if displaying default online text
  if (DOM.statusBadge?.classList.contains('connected') && DOM.statusText) {
    DOM.statusText.textContent = `${cleanName} Online`
  }

  onNameChanged?.(cleanName)
  return cleanName
}

