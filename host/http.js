import { createWriteStream, promises as fs } from 'node:fs'

// HTTP primitives for the bookshelf Host surface: route prefixes, request
// limits, content types and the error type every route handler throws. The
// per-request helpers close over the injected web server so CORS keeps
// reflecting loopback origins only.

const ROUTE_PREFIX = '/bookshelf'
const API_PREFIX = '/bookshelf/api'
const ASSET_PREFIX = '/bookshelf/assets'
const MAX_IMPORT_BYTES = 256 * 1024 * 1024
// Per-book state carries bookmarks and text annotations; 1000 annotations with
// long quotes legitimately exceed a few hundred kilobytes, so the cap is sized
// for the model limit rather than for progress-only writes.
const MAX_STATE_BYTES = 4 * 1024 * 1024
const MAX_COVER_BYTES = 8 * 1024 * 1024

const FORMAT_MIME = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
}
const COVER_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
])

const ASSET_TYPES = new Map([
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.bcmap', 'application/octet-stream'],
  ['.wasm', 'application/wasm'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.pfb', 'application/octet-stream'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/plain; charset=utf-8'],
])

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createHttp({ webServer } = {}) {
  function allowedOrigin(request) {
    const origin = request.headers.origin
    if (origin === undefined) return undefined
    if (origin === 'null') return 'null'
    try {
      const parsed = new URL(origin)
      const host = parsed.hostname
      const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
      if (!loopback) return undefined
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
      const port = String(webServer.port ?? '')
      if (port !== '' && parsed.port !== '' && parsed.port !== port) return undefined
      return origin
    } catch {
      return undefined
    }
  }

  function baseHeaders(request) {
    const headers = {
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    }
    const origin = allowedOrigin(request)
    if (origin !== undefined) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'content-type'
      headers['Access-Control-Max-Age'] = '86400'
      headers.Vary = 'Origin'
    }
    return headers
  }

  function sendJson(request, response, status, value) {
    const body = JSON.stringify(value)
    response.writeHead(status, {
      ...baseHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    })
    response.end(body)
  }

  async function readJsonBody(request, limit) {
    const chunks = []
    let total = 0
    for await (const chunk of request) {
      total += chunk.length
      if (total > limit) throw new HttpError(413, `JSON body exceeds the ${limit} byte limit`)
      chunks.push(chunk)
    }
    if (total === 0) throw new HttpError(400, 'empty JSON body')
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new HttpError(400, 'invalid JSON body')
    }
  }

  async function receiveBody(request, target, limit = MAX_IMPORT_BYTES) {
    const declared = Number(request.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      throw new HttpError(413, `upload exceeds the ${limit} byte limit`)
    }
    const output = createWriteStream(target, { flags: 'wx' })
    let received = 0
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        let settled = false
        const fail = (error) => {
          if (settled) return
          settled = true
          output.destroy()
          rejectPromise(error)
        }
        request.on('data', (chunk) => {
          received += chunk.length
          if (received > limit) {
            settled = true
            output.destroy()
            request.destroy()
            rejectPromise(new HttpError(413, `upload exceeds the ${limit} byte limit`))
          }
        })
        request.on('aborted', () => fail(new HttpError(400, 'upload aborted')))
        request.on('error', fail)
        output.on('error', fail)
        output.on('finish', () => {
          if (settled) return
          settled = true
          resolvePromise()
        })
        request.pipe(output)
      })
    } catch (error) {
      await fs.rm(target, { force: true }).catch(() => undefined)
      throw error
    }
    if (received === 0) {
      await fs.rm(target, { force: true }).catch(() => undefined)
      throw new HttpError(400, 'empty upload')
    }
    return received
  }

  return { allowedOrigin, baseHeaders, sendJson, readJsonBody, receiveBody }
}

export {
  ROUTE_PREFIX,
  API_PREFIX,
  ASSET_PREFIX,
  MAX_IMPORT_BYTES,
  MAX_STATE_BYTES,
  MAX_COVER_BYTES,
  FORMAT_MIME,
  COVER_TYPES,
  ASSET_TYPES,
  HttpError,
}
