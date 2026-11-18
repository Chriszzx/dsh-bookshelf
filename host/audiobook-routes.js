import { createReadStream } from 'node:fs'

import { API_PREFIX, HttpError } from './http.js'
import { regexRoute } from './routes.js'
import { cleanText } from './states.js'

/** Whole-book audiobook routes: plan, render, download, state and removal. */
export function createAudiobookRoutes({ http, audiobooks, findBook } = {}) {
  const { sendJson, readJsonBody, baseHeaders } = http

  async function plan(request, response, id) {
    const record = await findBook(id)
    const body = await readJsonBody(request, 8 * 1024 * 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid audiobook plan')
    const value = await audiobooks.plan(record.id, {
      text: typeof body.text === 'string' ? body.text : '',
      voice: cleanText(body.voice, '', 64),
      provider: cleanText(body.provider, '', 20),
      speed: body.speed,
    })
    sendJson(request, response, 200, { plan: value })
  }

  async function start(request, response, id) {
    const record = await findBook(id)
    const body = await readJsonBody(request, 16 * 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid audiobook request')
    const state = await audiobooks.start(record.id, {
      planId: cleanText(body.planId, '', 36),
    })
    sendJson(request, response, 200, { state })
  }

  async function cancel(request, response, id) {
    const record = await findBook(id)
    sendJson(request, response, 200, { state: await audiobooks.cancel(record.id) })
  }

  async function sendFile(request, response, id) {
    const record = await findBook(id)
    const file = await audiobooks.file(record.id)
    if (file === null) throw new HttpError(404, 'audio not found')
    // Browsers seek and stream media with byte ranges; without them a long
    // book WAV cannot be scrubbed and some players refuse to start.
    const size = file.bytes
    let start = 0
    let end = size - 1
    let status = 200
    const rangeHeader = typeof request.headers.range === 'string' ? request.headers.range.trim() : ''
    if (/^bytes=\d*-\d*$/.test(rangeHeader)) {
      const [from, to] = rangeHeader.slice(6).split('-')
      if (from === '') start = Math.max(0, size - Number(to))
      else start = Number(from)
      if (to !== '' && from !== '') end = Math.min(size - 1, Number(to))
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        response.writeHead(416, { ...baseHeaders(request), 'Content-Range': `bytes */${size}` })
        response.end()
        return
      }
      status = 206
    }
    const headers = {
      ...baseHeaders(request),
      'Content-Type': file.mime,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Disposition': `inline; filename="${file.name}"`,
      'Cache-Control': 'no-store',
    }
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    response.writeHead(status, headers)
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    await new Promise((resolve, reject) => {
      const stream = createReadStream(file.path, status === 206 ? { start, end } : undefined)
      stream.once('error', reject)
      response.once('close', resolve)
      response.once('finish', resolve)
      stream.pipe(response)
    })
  }

  async function getState(request, response, id) {
    const record = await findBook(id)
    sendJson(request, response, 200, { state: await audiobooks.state(record.id) })
  }

  async function remove(request, response, id) {
    const record = await findBook(id)
    await audiobooks.remove(record.id)
    sendJson(request, response, 200, { ok: true })
  }

  return [
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio/plan$`), {
      POST: (request, response, context) => plan(request, response, context.params[1]),
    }),
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio/start$`), {
      POST: (request, response, context) => start(request, response, context.params[1]),
    }),
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio/cancel$`), {
      POST: (request, response, context) => cancel(request, response, context.params[1]),
    }),
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio/file$`), {
      GET: (request, response, context) => sendFile(request, response, context.params[1]),
      HEAD: (request, response, context) => sendFile(request, response, context.params[1]),
    }),
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio$`), {
      GET: (request, response, context) => getState(request, response, context.params[1]),
      DELETE: (request, response, context) => remove(request, response, context.params[1]),
    }),
  ]
}
