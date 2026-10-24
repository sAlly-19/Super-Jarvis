import { DOM } from './dom'
import { OfflineHandler } from '../offline/offline-handler'

export interface ChatDrawerOptions {
  getIsConnected: () => boolean
  getAgentName: () => string
  offlineHandler: OfflineHandler
  controlConsentModal?: { show: () => void }
}

export function initChatDrawer(options: ChatDrawerOptions): void {
  const { btnToggleChat, chatInputDrawer, inputChatText, btnSendText, transcriptText, transcriptBox } = DOM

  btnToggleChat?.addEventListener('click', () => {
    if (!chatInputDrawer) return
    const isOpen = chatInputDrawer.classList.toggle('open')
    chatInputDrawer.classList.toggle('closed', !isOpen)
    btnToggleChat.classList.toggle('active', isOpen)
    if (isOpen && inputChatText) {
      setTimeout(() => inputChatText.focus(), 150)
    }
  })

  const sendTextMessage = async (): Promise<void> => {
    if (!inputChatText) return
    const text = inputChatText.value.trim()
    if (!text) return

    // Show prompt in transcript box
    transcriptText.textContent = `Você: "${text}"`
    transcriptBox.classList.remove('hidden')
    inputChatText.value = ''

    if (!options.getIsConnected()) {
      const accepted = await window.electronAPI.isConsentAccepted().catch(() => false)
      if (!accepted) {
        options.controlConsentModal?.show()
        return
      }
      try {
        const outcome = await window.electronAPI.connectAgent()
        if (outcome.success) {
          window.electronAPI.sendText(text)
          return
        }
      } catch {}
      options.offlineHandler.handleQuery(text, options.getAgentName())
      return
    }

    window.electronAPI.sendText(text)
  }

  btnSendText?.addEventListener('click', () => { void sendTextMessage() })
  inputChatText?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendTextMessage()
    }
  })
}
