import { DOM } from './dom'
import { OfflineHandler } from '../offline/offline-handler'

export interface ChatDrawerOptions {
  getIsConnected: () => boolean
  getAgentName: () => string
  offlineHandler: OfflineHandler
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

  const sendTextMessage = (): void => {
    if (!inputChatText) return
    const text = inputChatText.value.trim()
    if (!text) return

    // Show prompt in transcript box
    transcriptText.textContent = `Você: "${text}"`
    transcriptBox.classList.remove('hidden')
    inputChatText.value = ''

    if (!options.getIsConnected()) {
      options.offlineHandler.handleQuery(text, options.getAgentName())
      return
    }

    window.electronAPI.sendText(text)
  }

  btnSendText?.addEventListener('click', sendTextMessage)
  inputChatText?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendTextMessage()
    }
  })
}
