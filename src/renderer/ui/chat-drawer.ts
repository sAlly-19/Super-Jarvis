import { DOM } from './dom'
import { OfflineHandler } from '../offline/offline-handler'
import { jasperSocket } from '../src/services/jasperSocket'

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

    // Send over WebSocket to Python FastAPI Backend
    if (jasperSocket.isConnected()) {
      jasperSocket.sendText(text)
      return
    }

    // Fallback if Python WebSocket is temporarily offline
    if (!options.getIsConnected()) {
      options.offlineHandler.handleQuery(text, options.getAgentName())
      return
    }

    window.electronAPI.sendTextMessage(text)
  }

  btnSendText?.addEventListener('click', sendTextMessage)
  inputChatText?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendTextMessage()
    }
  })
}
