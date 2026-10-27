import { parentPort } from 'node:worker_threads'
import { parseCalendar, serializeCalendar } from './ical-codec'

parentPort?.once('message', request => {
  try {
    const value = request.operation === 'parse' ? parseCalendar(request.bytes, request.preferences)
      : request.operation === 'serialize' ? serializeCalendar(request.items) : (() => { throw new Error('invalid_worker_operation') })()
    parentPort!.postMessage({ ok: true, value })
  } catch (error) {
    const reason = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'invalid_calendar'
    parentPort!.postMessage({ ok: false, reason })
  }
})
