import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ModuleRegistry } from '../src/main/modules/registry'

test('plan B offers exactly the original five tools with unrestricted PowerShell script content', () => {
  const registry = new ModuleRegistry(JSON.parse(fs.readFileSync('resources/modules/native-capabilities.json', 'utf8')))
  assert.deepEqual(registry.list().filter(item => item.moduleId === 'computer').map(item => item.id).sort(), ['run_powershell', 'get_system_telemetry', 'gui_action', 'control_system_volume', 'capture_screen_base64'].sort())
  for (const command of [
    'Start-Process notepad.exe',
    'Get-Process | Select-Object Id,ProcessName',
    'Move-Item -LiteralPath "C:\\source" -Destination "D:\\destination"',
    'Get-ChildItem -LiteralPath "\\\\server\\share"',
    '$items = Get-ChildItem; foreach ($item in $items) { Write-Output $item.Name }'
  ]) assert.doesNotThrow(() => registry.validateInput('run_powershell', { command }))
  assert.throws(() => registry.validateInput('run_powershell', { command: 42 }))
})
