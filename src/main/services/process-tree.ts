import { spawn, type ChildProcess } from 'child_process'

export interface ProcessTreeTerminationOptions {
  platform?: NodeJS.Platform
  spawnFn?: (command: string, args: string[], options: any) => ChildProcess
}

export async function terminateProcessTree(
  pid: number,
  options: ProcessTreeTerminationOptions = {}
): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process id: ${pid}`)
  }

  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error: any) {
      if (error?.code !== 'ESRCH') throw error
    }
    return
  }

  const spawnFn = options.spawnFn ?? spawn
  await new Promise<void>((resolve, reject) => {
    const killer = spawnFn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })

    killer.once('error', reject)
    killer.once('exit', (code) => {
      // taskkill returns 128 when the target already exited. The desired state is
      // already reached in that case.
      if (code === 0 || code === 128) {
        resolve()
      } else {
        reject(new Error(`taskkill failed for process ${pid} with exit code ${code}`))
      }
    })
  })
}
