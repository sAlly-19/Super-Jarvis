import { DOM } from '../ui/dom'
import { updateStatusBadge } from '../ui/status-badge'
import { AvatarController } from '../scene/avatar'
import { evaluateMathExpression } from '@shared'

export class OfflineHandler {
  private avatar: AvatarController | null = null
  private mouthInterval: any = null

  public setAvatar(avatar: AvatarController | null): void {
    this.avatar = avatar
  }

  public speak(text: string, agentName: string): void {
    if (!window.speechSynthesis) {
      DOM.transcriptText.textContent = text
      DOM.transcriptBox.classList.remove('hidden')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'pt-BR'
    utterance.rate = 1.05
    utterance.pitch = 0.95

    const voices = window.speechSynthesis.getVoices()
    const ptVoice = voices.find((v) => v.lang.includes('pt') || v.lang.includes('BR'))
    if (ptVoice) utterance.voice = ptVoice

    DOM.transcriptText.textContent = text
    DOM.transcriptBox.classList.remove('hidden')
    updateStatusBadge('speaking', `${agentName} Falando (Offline)...`)

    if (this.mouthInterval) clearInterval(this.mouthInterval)
    let step = 0
    this.mouthInterval = setInterval(() => {
      step++
      const val = 0.04 + 0.14 * (Math.sin(step * 0.4) * 0.5 + 0.5)
      this.avatar?.setMouthOpen(val)
    }, 40)

    utterance.onend = () => {
      if (this.mouthInterval) clearInterval(this.mouthInterval)
      this.avatar?.setMouthOpen(0)
      updateStatusBadge('connected', `${agentName} Modo Offline`)
      setTimeout(() => {
        DOM.transcriptBox.classList.add('hidden')
      }, 5000)
    }

    utterance.onerror = () => {
      if (this.mouthInterval) clearInterval(this.mouthInterval)
      this.avatar?.setMouthOpen(0)
      updateStatusBadge('connected', `${agentName} Modo Offline`)
    }

    window.speechSynthesis.speak(utterance)
  }

  public handleQuery(input: string, agentName: string): boolean {
    const q = input.toLowerCase().trim()

    // 1. Identity & Agent Info
    if (q.includes('quem é você') || q.includes('qual seu nome') || q.includes('quem e voce')) {
      this.speak(`Eu sou ${agentName}, seu assistente pessoal. No momento estou operando no modo offline local.`, agentName)
      return true
    }

    // 2. Current Time
    if (q.includes('que horas') || q.includes('horas são') || q.includes('hora atual')) {
      const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      this.speak(`Agora são exatamente ${timeStr}.`, agentName)
      return true
    }

    // 3. Current Date
    if (q.includes('que dia') || q.includes('qual a data') || q.includes('dia é hoje')) {
      const dateStr = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
      this.speak(`Hoje é ${dateStr}.`, agentName)
      return true
    }

    // 4. Quick Math Calculation
    const calcMatch = q.match(/(?:quanto é|calcula|calcule|conta)\s+([\d\s\+\-\*\/\(\)\.\,]+)/)
    if (calcMatch) {
      try {
        const expr = calcMatch[1].replace(/,/g, '.').replace(/x/g, '*')
        const result = evaluateMathExpression(expr)
        const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/\.?0+$/, '')
        this.speak(`O resultado do cálculo é ${formatted}.`, agentName)
        return true
      } catch (e) {}
    }

    // 5. System Utilities
    if (q.includes('bloco de notas') || q.includes('notepad')) {
      this.speak('Abrindo o Bloco de Notas.', agentName)
      window.electronAPI.sendTextMessage('abrir bloco de notas')
      return true
    }
    if (q.includes('calculadora')) {
      this.speak('Abrindo a Calculadora.', agentName)
      window.electronAPI.sendTextMessage('abrir calculadora')
      return true
    }

    // Fallback response
    this.speak(
      `Recebi seu pedido "${input}", porém estou desconectado da API Gemini no momento. Posso informar as horas, data, fazer cálculos ou abrir utilitários do sistema.`,
      agentName
    )
    return true
  }
}

