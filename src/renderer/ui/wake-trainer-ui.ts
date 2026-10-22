import { DOM } from './dom'
import { WakeWordManager } from '../audio/wake-word-manager'
import { MicRecorder } from '../audio/mic-recorder'
import { SVG_ICONS } from './icons'

export interface WakeTrainerOptions {
  getAgentName: () => string
  wakeWordManager: WakeWordManager
  micRecorder: MicRecorder
}

function setTrustedIconText(element: HTMLElement, icon: string, message: string): void {
  const iconElement = document.createElement('span')
  iconElement.setAttribute('aria-hidden', 'true')
  iconElement.innerHTML = icon
  element.replaceChildren(iconElement, document.createTextNode(` ${message}`))
}

function setAgentTitle(element: HTMLElement, prefix: string, agentName: string): void {
  const name = document.createElement('span')
  name.className = 'lbl-agent-target-name'
  name.textContent = agentName
  element.replaceChildren(document.createTextNode(prefix), name)
}

export class WakeTrainerUI {
  private options: WakeTrainerOptions
  private busy = false

  constructor(options: WakeTrainerOptions) {
    this.options = options
    this.setupListeners()
  }

  public updateUI(): void {
    const currentAgentName = this.options.getAgentName()
    const engine = this.options.wakeWordManager.getEngine()

    const lblAgentNames = document.querySelectorAll('.lbl-agent-target-name')
    lblAgentNames.forEach((el) => {
      el.textContent = currentAgentName
    })

    const isCustomActive = engine?.isCustomModelActive() || false
    const isLegacy = engine?.isLegacyModel() || false
    const {
      badgeModelState,
      wakeStatusTitle,
      wakeStatusDesc,
      wakeStatusIcon,
      countNameSamples,
      countNoiseSamples,
      countOtherSamples,
      btnTrainCustomModel
    } = DOM

    const counts = engine?.getExampleCounts() || {}
    const nameKey = currentAgentName.toLowerCase()
    const nameCount = counts[nameKey] || 0
    const noiseCount = counts['_background_noise_'] || 0
    const otherCount = (counts['_other_'] || 0) + (counts['_other_speech_'] || 0)

    if (countNameSamples) countNameSamples.textContent = String(nameCount)
    if (countNoiseSamples) countNoiseSamples.textContent = String(noiseCount)
    if (countOtherSamples) countOtherSamples.textContent = String(otherCount)

    if (btnTrainCustomModel) {
      const ready = !this.busy && nameCount >= 3 && noiseCount >= 2 && otherCount >= 2
      btnTrainCustomModel.disabled = !ready
      btnTrainCustomModel.style.opacity = ready ? '1' : '0.5'
      btnTrainCustomModel.style.cursor = ready ? 'pointer' : 'not-allowed'
    }

    if (isCustomActive) {
      if (badgeModelState) {
        badgeModelState.textContent = 'Calibrado & Ativo (3 Classes)'
        badgeModelState.style.background = 'rgba(255, 255, 255, 0.14)'
        badgeModelState.style.color = '#ffffff'
        badgeModelState.style.borderColor = 'rgba(255, 255, 255, 0.45)'
      }
      if (wakeStatusTitle) {
        setAgentTitle(wakeStatusTitle, 'Motor Neural Ativo para: ', currentAgentName)
      }
      if (wakeStatusDesc) {
        wakeStatusDesc.textContent = `Pronto! Diga "${currentAgentName}" no microfone para ativar o assistente via TensorFlow. Fala comum ou ruídos aleatórios serão ignorados.`
      }
      if (wakeStatusIcon) wakeStatusIcon.innerHTML = SVG_ICONS.check
    } else if (isLegacy) {
      if (badgeModelState) {
        badgeModelState.textContent = 'Requer Amostras Negativas'
        badgeModelState.style.background = 'rgba(255, 255, 255, 0.08)'
        badgeModelState.style.color = '#d4d4d8'
        badgeModelState.style.borderColor = 'rgba(255, 255, 255, 0.25)'
      }
      if (wakeStatusTitle) {
        setAgentTitle(wakeStatusTitle, 'Calibração Incompleta: ', currentAgentName)
      }
      if (wakeStatusDesc) {
        wakeStatusDesc.textContent = `O modelo salvo possui apenas 2 classes (ativa com qualquer voz). Grave 3 amostras de "Outras Palavras" e clique em "Treinar" para corrigir.`
      }
      if (wakeStatusIcon) wakeStatusIcon.innerHTML = SVG_ICONS.bolt
    } else {
      if (badgeModelState) {
        badgeModelState.textContent = 'Pendente de Calibração'
        badgeModelState.style.background = 'rgba(255, 255, 255, 0.08)'
        badgeModelState.style.color = '#d4d4d8'
        badgeModelState.style.borderColor = 'rgba(255, 255, 255, 0.25)'
      }
      if (wakeStatusTitle) {
        setAgentTitle(wakeStatusTitle, 'Calibração TensorFlow para: ', currentAgentName)
      }
      if (wakeStatusDesc) {
        wakeStatusDesc.textContent = `Grave 3 amostras dizendo "${currentAgentName}", 2 de silêncio e 3 de outras palavras comuns para treinar a rede neural sem falsos positivos.`
      }
      if (wakeStatusIcon) wakeStatusIcon.innerHTML = SVG_ICONS.bolt
    }
  }

  private setupListeners(): void {
    const {
      btnSampleName,
      btnSampleNoise,
      btnSampleOther,
      btnTrainCustomModel,
      btnResetCustomModel,
      trainerFeedback,
      btnMic,
      micStatusLabel
    } = DOM

    const stopMicIfRecording = (): void => {
      if (this.options.micRecorder.isRecording()) {
        this.options.micRecorder.stop()
        btnMic.classList.remove('active')
        if (micStatusLabel) micStatusLabel.textContent = 'Pressione para falar'
      }
    }

    const setSampleButtonsDisabled = (disabled: boolean): void => {
      this.busy = disabled
      if (btnSampleName) btnSampleName.disabled = disabled
      if (btnSampleNoise) btnSampleNoise.disabled = disabled
      if (btnSampleOther) btnSampleOther.disabled = disabled
      if (btnResetCustomModel) btnResetCustomModel.disabled = disabled
      this.updateUI()
    }

    btnSampleName?.addEventListener('click', async () => {
      if (this.busy) return
      setSampleButtonsDisabled(true)
      stopMicIfRecording()
      await this.options.wakeWordManager.pause()

      let engine = this.options.wakeWordManager.getEngine()
      if (!engine) {
        await this.options.wakeWordManager.init(true)
        engine = this.options.wakeWordManager.getEngine()
      }
      if (!engine) { setSampleButtonsDisabled(false); return }

      const currentAgentName = this.options.getAgentName()
      const targetName = currentAgentName.toLowerCase().trim()

      try {
        setSampleButtonsDisabled(true)
        if (trainerFeedback) {
          setTrustedIconText(trainerFeedback, SVG_ICONS.dotRecord, `Gravando... Diga claramente "${currentAgentName}" agora!`)
          trainerFeedback.style.color = '#ffffff'
        }
        btnSampleName.innerHTML = `${SVG_ICONS.dotRecord} Gravando...`

        const result = await engine.collectCustomSample(targetName)

        if (trainerFeedback) {
          setTrustedIconText(trainerFeedback, SVG_ICONS.check, `Amostra de "${currentAgentName}" gravada com sucesso! (${result.count}/3)`)
          trainerFeedback.style.color = '#ffffff'
        }
        this.updateUI()
      } catch (err: any) {
        console.error('[WakeTrainer] Erro ao gravar amostra:', err)
        if (trainerFeedback) {
          trainerFeedback.textContent = `Erro ao gravar: ${err?.message || err}`
          trainerFeedback.style.color = '#a1a1aa'
        }
      } finally {
        setSampleButtonsDisabled(false)
        setTrustedIconText(btnSampleName, SVG_ICONS.mic, `Gravar "${currentAgentName}"`)
      }
    })

    btnSampleNoise?.addEventListener('click', async () => {
      if (this.busy) return
      setSampleButtonsDisabled(true)
      stopMicIfRecording()
      await this.options.wakeWordManager.pause()

      let engine = this.options.wakeWordManager.getEngine()
      if (!engine) {
        await this.options.wakeWordManager.init(true)
        engine = this.options.wakeWordManager.getEngine()
      }
      if (!engine) { setSampleButtonsDisabled(false); return }

      try {
        setSampleButtonsDisabled(true)
        if (trainerFeedback) {
          setTrustedIconText(trainerFeedback, SVG_ICONS.micOff, 'Gravando ruído ambiente... Fique em silêncio por 1 segundo.')
          trainerFeedback.style.color = '#ffffff'
        }
        btnSampleNoise.innerHTML = `${SVG_ICONS.dotRecord} Gravando...`

        const result = await engine.collectCustomSample('_background_noise_')

        if (trainerFeedback) {
          setTrustedIconText(trainerFeedback, SVG_ICONS.check, `Silêncio capturado com sucesso! (${result.count}/2)`)
          trainerFeedback.style.color = '#ffffff'
        }
        this.updateUI()
      } catch (err: any) {
        console.error('[WakeTrainer] Erro ao gravar silêncio:', err)
        if (trainerFeedback) {
          trainerFeedback.textContent = `Erro ao gravar: ${err?.message || err}`
          trainerFeedback.style.color = '#a1a1aa'
        }
      } finally {
        setSampleButtonsDisabled(false)
        btnSampleNoise.innerHTML = `${SVG_ICONS.micOff} Gravar Silêncio`
      }
    })

    btnSampleOther?.addEventListener('click', async () => {
      if (this.busy) return
      setSampleButtonsDisabled(true)
      stopMicIfRecording()
      await this.options.wakeWordManager.pause()

      let engine = this.options.wakeWordManager.getEngine()
      if (!engine) {
        await this.options.wakeWordManager.init(true)
        engine = this.options.wakeWordManager.getEngine()
      }
      if (!engine) { setSampleButtonsDisabled(false); return }

      try {
        setSampleButtonsDisabled(true)
        if (trainerFeedback) {
          setTrustedIconText(trainerFeedback, SVG_ICONS.dotRecord, 'Gravando... Diga qualquer palavra comum (ex: "olá", "teste", "ok")!')
          trainerFeedback.style.color = '#d4d4d8'
        }
        btnSampleOther.innerHTML = `${SVG_ICONS.dotRecord} Gravando...`

        const result = await engine.collectCustomSample('_other_')

        if (trainerFeedback) {
          setTrustedIconText(trainerFeedback, SVG_ICONS.check, `Amostra de outras palavras gravada com sucesso! (${result.count}/3)`)
          trainerFeedback.style.color = '#ffffff'
        }
        this.updateUI()
      } catch (err: any) {
        console.error('[WakeTrainer] Erro ao gravar outras palavras:', err)
        if (trainerFeedback) {
          trainerFeedback.textContent = `Erro ao gravar: ${err?.message || err}`
          trainerFeedback.style.color = '#a1a1aa'
        }
      } finally {
        setSampleButtonsDisabled(false)
        btnSampleOther.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Gravar Outras Palavras`
      }
    })

    btnTrainCustomModel?.addEventListener('click', async () => {
      if (this.busy) return
      const engine = this.options.wakeWordManager.getEngine()
      if (!engine) return
      const currentAgentName = this.options.getAgentName()

      try {
        setSampleButtonsDisabled(true)
        btnTrainCustomModel.disabled = true
        if (trainerFeedback) {
          setTrustedIconText(trainerFeedback, SVG_ICONS.bolt, `Compilando e treinando modelo neural local de 3 classes para "${currentAgentName}"...`)
          trainerFeedback.style.color = '#ffffff'
        }

        await engine.trainCustomModel((epoch, loss) => {
          if (trainerFeedback) {
            trainerFeedback.textContent = `Treinando época ${epoch}/25 (perda: ${loss.toFixed(3)})...`
          }
        })

        this.options.wakeWordManager.syncRunningState()
        await this.options.wakeWordManager.resume(this.options.micRecorder.isRecording())
        if (trainerFeedback) {
          setTrustedIconText(trainerFeedback, SVG_ICONS.sparkle, `Sucesso! O assistente agora responde com alta precisão ao nome "${currentAgentName}". Fala comum será ignorada.`)
          trainerFeedback.style.color = '#ffffff'
        }
        this.updateUI()
      } catch (err: any) {
        console.error('[WakeTrainer] Erro no treinamento:', err)
        if (trainerFeedback) {
          trainerFeedback.textContent = `Erro no treinamento: ${err?.message || err}`
          trainerFeedback.style.color = '#a1a1aa'
        }
      } finally {
        setSampleButtonsDisabled(false)
        this.updateUI()
      }
    })

    btnResetCustomModel?.addEventListener('click', async () => {
      if (this.busy) return
      const engine = this.options.wakeWordManager.getEngine()
      if (!engine) return
      const currentAgentName = this.options.getAgentName()

      if (confirm(`Deseja resetar as amostras e a calibração de voz para "${currentAgentName}"?`)) {
        try {
          setSampleButtonsDisabled(true)
          await engine.clearCustomModel()
          if (trainerFeedback) {
            trainerFeedback.textContent = 'Calibração resetada com sucesso.'
            trainerFeedback.style.color = '#8e8e93'
          }
        } catch (err: unknown) {
          if (trainerFeedback) {
            trainerFeedback.textContent = `Erro ao resetar: ${err instanceof Error ? err.message : String(err)}`
            trainerFeedback.style.color = '#a1a1aa'
          }
        } finally {
          setSampleButtonsDisabled(false)
          this.options.wakeWordManager.syncRunningState()
        }
      }
    })
  }
}
