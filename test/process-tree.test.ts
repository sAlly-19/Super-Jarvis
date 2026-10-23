import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { terminateProcessTree } from '../src/main/services/process-tree'

describe('process-tree termination', () => {
  test('uses taskkill with an argument array on Windows', async () => {
    const emitter = new EventEmitter()
    const calls: Array<{ command: string; args: string[]; options: any }> = []
    const spawnFn = (command: string, args: string[], options: any) => {
      calls.push({ command, args, options })
      setImmediate(() => emitter.emit('exit', 0, null))
      return emitter as ChildProcess
    }

    await terminateProcessTree(4321, { platform: 'win32', spawnFn })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, 'taskkill.exe')
    assert.deepEqual(calls[0].args, ['/PID', '4321', '/T', '/F'])
    assert.equal(calls[0].options.shell, false)
    assert.equal(calls[0].options.windowsHide, true)
  })

  test('terminates a Windows child and its grandchild', { skip: process.platform !== 'win32' }, async () => {
    const powershell = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    const root = spawn(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$child = Start-Process -FilePath $PSHOME\\powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 60' -PassThru; Write-Output $child.Id; [Console]::Out.Flush(); Start-Sleep -Seconds 60"
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    )

    const grandchildPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for grandchild PID')), 5_000)
      root.once('error', reject)
      root.stdout!.once('data', (chunk) => {
        clearTimeout(timer)
        resolve(Number.parseInt(chunk.toString('utf8').trim(), 10))
      })
    })
    assert.ok(root.pid)
    assert.ok(Number.isInteger(grandchildPid))

    await terminateProcessTree(root.pid!)

    const waitUntilGone = async (pid: number) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          process.kill(pid, 0)
          await new Promise((resolve) => setTimeout(resolve, 50))
        } catch {
          return
        }
      }
      assert.fail(`Process ${pid} survived tree termination`)
    }

    await waitUntilGone(root.pid!)
    await waitUntilGone(grandchildPid)
  })
})
