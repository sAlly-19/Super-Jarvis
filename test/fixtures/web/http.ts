import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'

export interface FakeReply { status?: number; headers?: Record<string, string>; chunks?: Uint8Array[]; stall?: boolean; broken?: boolean; peer?: string }
export function fakeHttp(replies: FakeReply[]) {
  const calls: Array<{ url: URL; options: RequestOptions; request: any }> = []
  const request = (url: URL, options: RequestOptions, respond: (message: IncomingMessage) => void): ClientRequest => {
    const reply = replies[calls.length]
    if (!reply) throw new Error('Unexpected request: test must not use real networking')
    const req = new EventEmitter() as any
    const socket = new EventEmitter() as any
    socket.connecting = true
    socket.remoteAddress = reply.peer ?? '93.184.215.14'
    req.destroyed = false
    req.destroy = () => { req.destroyed = true; queueMicrotask(() => req.emit('close')); return req }
    req.end = () => {
      req.ended = true
      if (reply.stall) return
      queueMicrotask(() => {
        if (req.destroyed) return
        const body = Readable.from(reply.chunks ?? [Buffer.from('ok')]) as any
        body.statusCode = reply.status ?? 200
        body.headers = reply.headers ?? { 'content-type': 'text/html; charset=utf-8' }
        respond(body)
        if (reply.broken) queueMicrotask(() => body.destroy(new Error('test connection lost')))
      })
    }
    calls.push({ url, options, request: req })
    queueMicrotask(() => {
      if (req.destroyed) return
      req.emit('socket', socket)
      socket.connecting = false
      socket.emit(url.protocol === 'https:' ? 'secureConnect' : 'connect')
    })
    return req
  }
  return { calls, request }
}
