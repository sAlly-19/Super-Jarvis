import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { webcrypto } from 'node:crypto'
import { app } from 'electron'

import { buildMorphCacheMap } from '../src/renderer/scene/avatar'
import { getHardwareInfo } from '../src/main/services/hwid'
import { DEFAULT_LICENSE_API_URL, licenseManager, LicenseManager } from '../src/main/services/license-manager'
import { configStore } from '../src/main/config/config-store'
import { isTrustedRendererUrl } from '../src/main/utils/trusted-renderer'
import { requiresConfirmation, securityBroker } from '../src/main/services/security-broker'

describe('Suíte de Testes de Integração: Segurança, Áudio, Lip-Sync & Licenciamento Real', () => {
  describe('Origem confiável do renderer', () => {
    test('aceita somente o host do protocolo app em produção', () => {
      assert.equal(isTrustedRendererUrl('app://jasper/index.html'), true)
      assert.equal(isTrustedRendererUrl('app://evil/index.html'), false)
      assert.equal(isTrustedRendererUrl('file:///tmp/index.html'), false)
      assert.equal(isTrustedRendererUrl('https://jasper/index.html'), false)
    })

    test('aceita somente a origem do servidor configurado em desenvolvimento', () => {
      const developmentUrl = 'http://127.0.0.1:5173/'
      assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/settings', developmentUrl), true)
      assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/', developmentUrl), false)
      assert.equal(isTrustedRendererUrl('https://127.0.0.1:5173/', developmentUrl), false)
    })
  })

  describe('SecurityBroker (contenção de arquivos do usuário)', () => {
    test('aplica os três modos sem liberar ações obrigatoriamente protegidas', () => {
      assert.equal(requiresConfirmation('strict', 'common'), true)
      assert.equal(requiresConfirmation('strict', 'elevated'), true)
      assert.equal(requiresConfirmation('common', 'common'), false)
      assert.equal(requiresConfirmation('common', 'elevated'), true)
      assert.equal(requiresConfirmation('all', 'common'), false)
      assert.equal(requiresConfirmation('all', 'elevated'), false)
      assert.equal(requiresConfirmation('all', 'mandatory'), true)
    })

    test('permite arquivo em Documentos e rejeita caminho externo', () => {
      const allowedFile = path.join(app.getPath('documents'), 'broker-test.txt')
      fs.writeFileSync(allowedFile, 'ok', 'utf-8')
      try {
        assert.equal(securityBroker.resolveUserPath(allowedFile).allowed, true)
        assert.equal(securityBroker.resolveUserPath(path.join(os.tmpdir(), 'fora-do-perimetro.txt')).allowed, false)
        assert.equal(securityBroker.resolveUserPath('..\\segredo.txt').allowed, false)
      } finally {
        fs.rmSync(allowedFile, { force: true })
      }
    })

    test('rejeita link simbólico ou junction mesmo dentro de Documentos', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-outside-'))
      const linkPath = path.join(app.getPath('documents'), `jasper-link-${Date.now()}`)
      try {
        fs.symlinkSync(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
        assert.equal(securityBroker.resolveUserPath(linkPath).allowed, false)
      } finally {
        fs.rmSync(linkPath, { recursive: true, force: true })
        fs.rmSync(outsideDir, { recursive: true, force: true })
      }
    })
  })

  describe('Avatar 3D Morph Target O(1) Cache Real', () => {
    test('buildMorphCacheMap mapeia variações ARKit Left/Right e caixa alta/baixa', () => {
      const dict = {
        mouthSmile_L: 0,
        mouthSmile_R: 1,
        eyeBlinkLeft: 2,
        eyeBlinkRight: 3,
        jawOpen: 4
      }

      const cache = buildMorphCacheMap(dict)

      assert.equal(cache.get('mouthSmile_L'), 0)
      assert.equal(cache.get('mouthSmileLeft'), 0)
      assert.equal(cache.get('mouthsmileleft'), 0)
      assert.equal(cache.get('eyeBlinkLeft'), 2)
      assert.equal(cache.get('eyeBlink_L'), 2)
      assert.equal(cache.get('jawopen'), 4)
    })
  })

  describe('WakeWordManager & Chamada de Agente Exclusiva via TensorFlow', () => {
    test('código fonte de wake-word-manager e speech-commands não possui referências a Web Speech API', () => {
      const wakeWordManagerSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/renderer/audio/wake-word-manager.ts'),
        'utf-8'
      )
      assert.equal(wakeWordManagerSrc.includes('SpeechRecognition'), false)
      assert.equal(wakeWordManagerSrc.includes('webkitSpeechRecognition'), false)
      assert.equal(wakeWordManagerSrc.includes('startPhoneticFallback'), false)
      assert.equal(wakeWordManagerSrc.includes('isPhoneticFallbackActive'), false)

      assert.ok(wakeWordManagerSrc.includes("mode: isCalibrated ? 'tensorflow' : 'disabled'"))
      assert.ok(wakeWordManagerSrc.includes('syncRunningState'))
      assert.ok(wakeWordManagerSrc.includes("import { SpeechCommandsWakeWord } from './speech-commands'"))
      assert.ok(wakeWordManagerSrc.includes('new SpeechCommandsWakeWord({'))

      const speechCommandsSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/renderer/audio/speech-commands.ts'),
        'utf-8'
      )
      assert.equal(speechCommandsSrc.includes('tr.secondLastBaseDenseLayer = null'), false)
      assert.ok(speechCommandsSrc.includes('./speech-model/model.json'))
    })

    test('speech-commands implementa modelo neural de 3 classes com amostras negativas e threshold de 0.90', () => {
      const speechCommandsSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/renderer/audio/speech-commands.ts'),
        'utf-8'
      )
      assert.ok(speechCommandsSrc.includes("detectedWord === '_other_'"))
      assert.ok(speechCommandsSrc.includes("detectedWord === '_background_noise_'"))
      assert.ok(speechCommandsSrc.includes('probabilityThreshold: options.probabilityThreshold ?? 0.90'))
      assert.ok(speechCommandsSrc.includes('overlapFactor: 0.25'))
      assert.ok(speechCommandsSrc.includes('hasNegativeSpeechSamples()'))
      assert.ok(speechCommandsSrc.includes('isLegacyModel()'))
      assert.ok(speechCommandsSrc.includes("labels.includes('_other_')"))
    })

    test('wake-trainer-ui e index.html exigem calibração de 3 classes (nome, silêncio e outras palavras)', () => {
      const trainerUiSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/renderer/ui/wake-trainer-ui.ts'),
        'utf-8'
      )
      const indexHtmlSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/renderer/index.html'),
        'utf-8'
      )

      assert.ok(trainerUiSrc.includes('nameCount >= 3 && noiseCount >= 2 && otherCount >= 2'))
      assert.ok(trainerUiSrc.includes("engine.collectCustomSample('_other_')"))
      assert.ok(trainerUiSrc.includes('btnSampleOther'))
      assert.ok(trainerUiSrc.includes('countOtherSamples'))

      assert.ok(indexHtmlSrc.includes('id="btn-sample-other"'))
      assert.ok(indexHtmlSrc.includes('id="count-other-samples"'))
      assert.ok(indexHtmlSrc.includes('Gravar Outras Palavras'))
    })
  })

  describe('Modo Chamada Contínuo, Lip-Sync (facecap.glb) & Integração WebSocket', () => {
    test('MicRecorder possui suporte nativo a Modo Chamada Full-Duplex, WAV VAD e timeout de 30s', () => {
      const micRecorderSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/renderer/audio/mic-recorder.ts'),
        'utf-8'
      )
      assert.ok(micRecorderSrc.includes('CALL_INACTIVITY_TIMEOUT_MS = 30000'))
      assert.ok(micRecorderSrc.includes('onCallInactivityTimeout: (() => void) | null = null'))
      assert.ok(micRecorderSrc.includes('onUtteranceWavBase64: ((wavBase64: string) => void) | null = null'))
      assert.ok(micRecorderSrc.includes('notifyAssistantActivity()'))
      assert.ok(micRecorderSrc.includes('getRemainingInactivitySeconds()'))
      assert.ok(micRecorderSrc.includes('SPEECH_RMS_THRESHOLD = 0.025'))
      assert.ok(micRecorderSrc.includes('MIN_SPEECH_CHUNKS = 18'))
      assert.ok(micRecorderSrc.includes('Full-Duplex'))
    })

    test('main.ts implementa Modo Chamada Full-Duplex, saudação proativa, barge-in e integração jasperSocket', () => {
      const mainSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/renderer/main.ts'),
        'utf-8'
      )
      assert.ok(mainSrc.includes('async function enterCallMode(withGreeting = true)'))
      assert.ok(mainSrc.includes('async function exitCallMode()'))
      assert.ok(mainSrc.includes('enterCallMode(true)'))
      assert.ok(mainSrc.includes('jasperSocket'))
      assert.ok(mainSrc.includes('O usuário acabou de chamar você. Cumprimente-o com elegância e brevidade em português e pergunte o que deseja.'))
      assert.ok(mainSrc.includes('Barge-in:'))
      assert.ok(mainSrc.includes('micRecorder.onCallInactivityTimeout = () => {'))
    })

    test('AudioPlayer decodifica MP3/PCM via AudioContext + AudioWorklet (audio-processor.js) para Lip-Sync', () => {
      const audioPlayerSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/renderer/audio/audio-player.ts'),
        'utf-8'
      )
      assert.ok(audioPlayerSrc.includes('public onPlaybackEnded: (() => void) | null = null'))
      assert.ok(audioPlayerSrc.includes('decodeAudioData'))
      assert.ok(audioPlayerSrc.includes('./audio-processor.js'))
      assert.ok(audioPlayerSrc.includes('source.disconnect()'))
      assert.ok(audioPlayerSrc.includes('this.onPlaybackEnded?.()'))
    })

    test('ConfigStore preserva modelos LiteLLM (Gemini 2.5 Flash, Groq Llama 3.3, Ollama Qwen 2.5) e aposenta modelos antigos', () => {
      const previous = configStore.getConfig().model
      try {
        for (const model of ['gemini/gemini-2.5-flash', 'groq/llama-3.3-70b-versatile', 'ollama/qwen2.5:3b']) {
          assert.equal(configStore.updateConfig({ model }).model, model)
        }
        assert.equal(configStore.updateConfig({ model: 'gemini-2.0-flash-exp' }).model, 'gemini/gemini-2.5-flash')
        assert.equal(configStore.updateConfig({ model: 'gemini-3.8-live' }).model, 'gemini/gemini-2.5-flash')
      } finally {
        configStore.updateConfig({ model: previous })
      }
    })
  })

  describe('Sistema de Licenciamento Criptográfico & Node-Locking (Módulo Real)', () => {
    test('getHardwareInfo gera identificador único estável no formato HWID-XXXX-XXXX-XXXX', () => {
      const hw1 = getHardwareInfo()
      assert.ok(hw1.machineId)
      assert.match(hw1.machineId, /^HWID-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/)
      assert.ok(hw1.machineName.length > 0)
      assert.ok(hw1.platform.length > 0)

      const hw2 = getHardwareInfo()
      assert.equal(hw1.machineId, hw2.machineId)
    })

    test('LicenseManager aceita apenas o formato atual de chaves aleatórias', () => {
      assert.equal(DEFAULT_LICENSE_API_URL, 'https://jasper-api-production.jasper-avatar.workers.dev')
      assert.equal(licenseManager.validateKeyFormat('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34'), true)
      assert.equal(licenseManager.validateKeyFormat('jasper-abcde-fghjk-lmnpq-rstuv-wxyz2-34'), true)
      assert.equal(licenseManager.validateKeyFormat('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-35'), false)
      assert.equal(licenseManager.validateKeyFormat('JASPER-LT-ZJV8-DVLK-942B'), false)
      assert.equal(licenseManager.validateKeyFormat('JSPR-V1-ABCD-1234-EF56'), false)
      assert.equal(licenseManager.validateKeyFormat('JASPER-INVALID-KEY'), false)
      assert.equal(licenseManager.validateKeyFormat(''), false)
      assert.equal(licenseManager.validateKeyFormat(null as any), false)
    })

    test('LicenseManager valida lease Ed25519 do Worker e renova por heartbeat', async () => {
      const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
      const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
      let activationBody: any = null

      const signLease = async (installationId: string, machineHash: string): Promise<{ token: string; expiresAt: string }> => {
        const now = Math.floor(Date.now() / 1000)
        const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({
          iss: 'jasper-license-api',
          aud: 'jasper-avatar-desktop',
          installationId,
          machineHash,
          iat: now,
          exp: now + (72 * 60 * 60)
        })).toString('base64url')
        const signature = await webcrypto.subtle.sign(
          { name: 'Ed25519' },
          pair.privateKey,
          Buffer.from(`${header}.${payload}`, 'utf-8')
        )
        return {
          token: `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`,
          expiresAt: new Date((now + (72 * 60 * 60)) * 1000).toISOString()
        }
      }

      const readJsonBody = (req: http.IncomingMessage): Promise<any> => new Promise((resolve) => {
        let raw = ''
        req.on('data', chunk => { raw += chunk })
        req.on('end', () => resolve(JSON.parse(raw || '{}')))
      })

      const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET' && req.url === '/v1/licenses/public-key') {
          res.end(JSON.stringify({ key: publicJwk }))
          return
        }
        if (req.method === 'POST' && req.url === '/v1/licenses/activate') {
          activationBody = await readJsonBody(req)
          res.end(JSON.stringify({
            status: 'active',
            deviceId: 'device-test-1',
            deviceSecret: 'device-secret-test-value',
            lease: await signLease(activationBody.installationId, activationBody.machineHash)
          }))
          return
        }
        if (req.method === 'POST' && req.url === '/v1/licenses/heartbeat') {
          await readJsonBody(req)
          res.end(JSON.stringify({
            status: 'active',
            lease: await signLease(activationBody.installationId, activationBody.machineHash)
          }))
          return
        }
        res.statusCode = 404
        res.end(JSON.stringify({ error: { code: 'not_found' } }))
      })

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
      const address = server.address() as { port: number }
      const manager = new LicenseManager()
      manager.setCustomBaseUrl(`http://127.0.0.1:${address.port}`)
      configStore.updateConfig({
        licenseKey: '',
        licenseStatus: 'unlicensed',
        licenseMachineId: '',
        licenseInstallationId: '',
        licenseDeviceId: '',
        licenseDeviceSecret: '',
        licenseLeaseToken: '',
        licenseLeaseExpiresAt: '',
        licensePublicJwk: ''
      })

      try {
        const activated = await manager.activateLicense('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34')
        assert.equal(activated.valid, true)
        assert.equal(activated.status, 'ACTIVATED')
        assert.equal(configStore.getConfig().licenseStatus, 'active')
        assert.ok(configStore.getConfig().licenseLeaseToken?.includes('.'))

        const renewed = await manager.verifyCurrentLicense()
        assert.equal(renewed.valid, true)
        assert.equal(renewed.status, 'ACTIVE')
        assert.equal(manager.getLicenseInfo().isLicensed, true)
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    })

    test('LicenseManager não aceita chaves de desenvolvimento em modo offline (modo dev removido)', async () => {
      const manager = new LicenseManager()
      manager.setCustomBaseUrl('http://127.0.0.1:59999/non-existent')

      const devResult = await manager.activateLicense('JASPER-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2-34')
      assert.equal(devResult.valid, false)
      assert.equal(devResult.error, 'NETWORK_ERROR')
    })

    test('LicenseManager checkAccess24h e onRevoked notificam quando licença é suspensa ou revogada', async () => {
      const manager = new LicenseManager()
      let revocationNotified = false
      manager.onRevoked(() => {
        revocationNotified = true
      })

      configStore.updateConfig({ licenseKey: '', licenseStatus: 'unlicensed' })
      const res = await manager.checkAccess24h(true)
      assert.equal(res.valid, false)
      assert.equal(revocationNotified, true)
    })

    test('UI e arquivos fonte contêm elementos e proteções de licenciamento obrigatórias e onboarding Gemini', () => {
      const htmlSrc = fs.readFileSync(path.join(process.cwd(), 'src/renderer/index.html'), 'utf-8')
      assert.ok(htmlSrc.includes('id="modal-license-activation"'))
      assert.ok(htmlSrc.includes('id="step-license-activation"'))
      assert.ok(htmlSrc.includes('id="step-gemini-onboarding"'))
      assert.ok(htmlSrc.includes('id="gemini-key-masked-display"'))
      assert.ok(htmlSrc.includes('id="input-onboarding-gemini-key"'))
      assert.ok(htmlSrc.includes('id="tab-license"'))
      assert.ok(htmlSrc.includes('id="input-license-key"'))
      assert.ok(htmlSrc.includes('id="tab-btn-activate-key"'))

      const ipcSrc = fs.readFileSync(path.join(process.cwd(), 'src/main/ipc/register-ipc.ts'), 'utf-8')
      assert.ok(ipcSrc.includes("cfg.licenseStatus !== 'active'"))
      assert.ok(ipcSrc.includes('LICENSE_GET_STATUS'))
      assert.ok(ipcSrc.includes('LICENSE_ACTIVATE'))
      assert.ok(ipcSrc.includes('LICENSE_GET_HWID'))

      const mainSrc = fs.readFileSync(path.join(process.cwd(), 'src/renderer/main.ts'), 'utf-8')
      assert.ok(mainSrc.includes('licenseModal.checkOnStartup()'))
      assert.ok(mainSrc.includes('!lic.isLicensed'))
      assert.ok(mainSrc.includes('onLicenseRevoked'))
    })
  })
})
