import { execFileSync } from 'child_process'
import crypto from 'crypto'
import os from 'os'

export interface HardwareInfo {
  machineId: string
  machineName: string
  platform: string
}

let cachedHardwareInfo: HardwareInfo | null = null

/**
 * Coleta componentes imutáveis de hardware da máquina local:
 * - Windows: UUID da placa-mãe (WMI), ID do processador, Serial do volume C: e MachineGuid de registro.
 * - macOS: IOPlatformSerialNumber via ioreg.
 * - Linux: /etc/machine-id ou /var/lib/dbus/machine-id.
 * 
 * Gera um identificador único estável no formato HWID-XXXX-XXXX-XXXX
 */
export function getHardwareInfo(): HardwareInfo {
  if (cachedHardwareInfo) {
    return cachedHardwareInfo
  }

  const platform = process.platform
  const machineName = os.hostname() || 'JASPER-PC'
  const rawParts: string[] = []

  if (platform === 'win32') {
    try {
      const psScript = `
        $u = (Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID;
        $c = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1).ProcessorId;
        $d = (Get-CimInstance Win32_LogicalDisk -ErrorAction SilentlyContinue | Where-Object DeviceID -eq 'C:').VolumeSerialNumber;
        $g = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid -ErrorAction SilentlyContinue).MachineGuid;
        "$u|$c|$d|$g"
      `.trim()

      const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        timeout: 4000,
        encoding: 'utf-8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim()

      if (output && output.includes('|')) {
        rawParts.push(output)
      }
    } catch {
      // Fallback secundário no Windows
      try {
        const wmicUuid = execFileSync('wmic.exe', ['csproduct', 'get', 'uuid'], { timeout: 2500, encoding: 'utf-8', windowsHide: true })
          .replace('UUID', '')
          .trim()
        if (wmicUuid) rawParts.push(wmicUuid)
      } catch {}
    }
  } else if (platform === 'darwin') {
    try {
      const ioregOutput = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        timeout: 2000,
        encoding: 'utf-8'
      }).trim()
      const macSerial = ioregOutput.match(/"IOPlatformSerialNumber"\s*=\s*"([^"]+)"/)?.[1] || ''
      if (macSerial) rawParts.push(macSerial)
    } catch {}
  } else {
    // Linux
    try {
      const fs = require('fs')
      if (fs.existsSync('/etc/machine-id')) {
        rawParts.push(fs.readFileSync('/etc/machine-id', 'utf-8').trim())
      } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
        rawParts.push(fs.readFileSync('/var/lib/dbus/machine-id', 'utf-8').trim())
      }
    } catch {}
  }

  // Fallback garantido usando arquitetura, cpu e home dir se nenhum comando retornar
  if (rawParts.length === 0) {
    rawParts.push(`${os.hostname()}|${os.arch()}|${os.cpus().length}|${os.userInfo().username}`)
  }

  // Gera o hash SHA-256 dos componentes fixos
  const sha = crypto.createHash('sha256').update(rawParts.join('::')).digest('hex').toUpperCase()

  // Formato: HWID-XXXX-XXXX-XXXX (12 caracteres hexadecimais em 3 grupos de 4)
  const chunk1 = sha.substring(0, 4)
  const chunk2 = sha.substring(4, 8)
  const chunk3 = sha.substring(8, 12)
  const machineId = `HWID-${chunk1}-${chunk2}-${chunk3}`

  cachedHardwareInfo = {
    machineId,
    machineName,
    platform
  }

  return cachedHardwareInfo
}

