import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ICalendarCodec } from '../src/main/modules/reminders/ical-client'

test('real isolated iCal worker parses synthetic bytes and cancellation terminates pending work', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-ical-worker-'))
  try {
    const { buildSync } = createRequire(path.resolve('package.json'))('esbuild')
    const entry = path.join(dir, 'worker.cjs')
    buildSync({ entryPoints: ['src/main/modules/reminders/ical-worker.ts'], outfile: entry, bundle: true, platform: 'node', format: 'cjs' })
    const codec = new ICalendarCodec(entry)
    const bytes = Uint8Array.from(fs.readFileSync('test/fixtures/reminders/sample-calendar.ics'))
    const result = await codec.parse(bytes, { timeZone: 'UTC', allDayTime: '09:00', notificationsEnabled: true, revision: 0 }, new AbortController().signal)
    assert.equal(result.candidates[0].uid, 'fixture-meeting@jasper.test')
    assert.equal(result.candidates.length, 2)
    fs.writeFileSync(path.join(dir, 'pending.cjs'), 'setInterval(() => {}, 1000)')
    const pending = new ICalendarCodec(path.join(dir, 'pending.cjs'), 50)
    await assert.rejects(pending.parse(bytes, {} as any, new AbortController().signal), /timeout/)
    const abort = new AbortController()
    const job = new ICalendarCodec(path.join(dir, 'pending.cjs')).parse(bytes, {} as any, abort.signal)
    abort.abort()
    await assert.rejects(job, /abort/i)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
