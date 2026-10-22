import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pythonBackend } from '../src/main/services/python-backend'
import { JasperSocketService } from '../src/renderer/src/services/jasperSocket'

describe('Suíte de Integração Real: Back-End Python (FastAPI + WebSocket + Super-Ferramentas OS)', () => {
  before(async () => {
    const started = await pythonBackend.start()
    assert.equal(started, true, 'O microsserviço Python deve iniciar na porta 8765')
  })

  after(() => {
    pythonBackend.stop()
  })

  test('Estrutura de arquivos jasper-backend (requirements.txt, tools_os.py, main.py) existe e está completa', () => {
    const backendDir = pythonBackend.getBackendDir()
    assert.equal(fs.existsSync(path.join(backendDir, 'requirements.txt')), true)
    assert.equal(fs.existsSync(path.join(backendDir, 'tools_os.py')), true)
    assert.equal(fs.existsSync(path.join(backendDir, 'main.py')), true)

    const reqs = fs.readFileSync(path.join(backendDir, 'requirements.txt'), 'utf-8')
    for (const pkg of ['fastapi', 'uvicorn', 'websockets', 'litellm', 'edge-tts', 'psutil', 'pyautogui', 'mss', 'pillow', 'pycaw', 'comtypes', 'python-dotenv']) {
      assert.ok(reqs.includes(pkg), `requirements.txt deve incluir ${pkg}`)
    }
  })

  test('Super-Ferramentas do Windows (tools_os.py): telemetria, PowerShell, trava anti-destruição e captura de tela', () => {
    const backendDir = pythonBackend.getBackendDir()
    const pyExe = pythonBackend.resolvePythonExecutable(backendDir)

    const pyScript = `
import json, sys
sys.path.insert(0, ${JSON.stringify(backendDir)})
import tools_os

telemetry = json.loads(tools_os.get_system_telemetry())
assert telemetry["status"] == "ok"
assert "cpu_percent" in telemetry
assert len(telemetry["top_5_memory_processes"]) <= 5

ps_ok = json.loads(tools_os.run_powershell("Write-Output 'JASPER_PS_OK'"))
assert ps_ok["status"] == "ok"
assert "JASPER_PS_OK" in ps_ok["stdout"]

ps_blocked = json.loads(tools_os.run_powershell("Format-Volume -DriveLetter C"))
assert ps_blocked["status"] == "blocked"

screen_b64 = tools_os.capture_screen_base64()
assert len(screen_b64) > 100

schema_names = [t["function"]["name"] for t in tools_os.TOOLS_SCHEMA]
for expected in ["run_powershell", "get_system_telemetry", "gui_action", "control_system_volume", "capture_screen_base64"]:
    assert expected in schema_names
    assert expected in tools_os.AVAILABLE_FUNCTIONS

print("TOOLS_OS_ALL_PASSED")
`
    const res = spawnSync(pyExe, ['-c', pyScript], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 25000
    })
    assert.equal(res.status, 0, `Falha em tools_os.py: ${res.stderr}`)
    assert.ok(res.stdout.includes('TOOLS_OS_ALL_PASSED'))
  })

  test('Endpoints HTTP /health e /config do FastAPI respondem em 127.0.0.1:8765', async () => {
    const healthRes = await fetch('http://127.0.0.1:8765/health')
    assert.equal(healthRes.ok, true)
    const healthData = await healthRes.json() as any
    assert.equal(healthData.status, 'online')
    assert.ok(Array.isArray(healthData.tools))
    assert.ok(healthData.tools.includes('run_powershell'))
    assert.ok(healthData.tools.includes('capture_screen_base64'))

    const cfgRes = await fetch('http://127.0.0.1:8765/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: 'Jasper',
        model: 'gemini/gemini-2.5-flash',
        voice: 'pt-BR-AntonioNeural'
      })
    })
    assert.equal(cfgRes.ok, true)
    const cfgData = await cfgRes.json() as any
    assert.equal(cfgData.status, 'ok')
    assert.equal(cfgData.model, 'gemini/gemini-2.5-flash')
  })

  test('Cliente WebSocket Central (JasperSocketService) conecta em ws://127.0.0.1:8765/ws/jasper e sincroniza estado/memória', async () => {
    const client = new JasperSocketService('ws://127.0.0.1:8765/ws/jasper')

    const statusReceived = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout conectando ao WebSocket /ws/jasper')), 6000)
      client.onStatusChange = (status) => {
        if (status === 'connected') {
          clearTimeout(timeout)
          resolve(status)
        }
      }
    })

    client.connect({
      agentName: 'Jasper',
      model: 'ollama/qwen2.5:3b',
      voiceName: 'pt-BR-AntonioNeural',
      vision: false
    })

    const initialStatus = await statusReceived
    assert.equal(initialStatus, 'connected')
    assert.equal(client.isConnected(), true)

    // Test memory clear over WebSocket
    const memoryCleared = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout aguardando memory_cleared')), 5000)
      client.onMemoryData = (facts) => {
        clearTimeout(timeout)
        resolve(facts)
      }
    })

    client.clearMemory()
    const facts = await memoryCleared
    assert.deepEqual(facts, [])

    client.disconnect()
    assert.equal(client.isConnected(), false)
  })
})
