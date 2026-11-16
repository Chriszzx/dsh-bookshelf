import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { sourceRevision } from './source-revision.js'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppleBooksImportError, listAppleBooks, packEpubDirectory, readAppleBook } from './apple-books.js'
import { createSourceLink } from './link-source.js'
import { sanitizeFontSettings } from './assets/reading-fonts.mjs'
import { replaceFile } from './assets/atomic-file.mjs'
import { ShelfSidebarSnapshotController, sidebarSnapshotProjection, createSidebarSnapshotCommand } from './sidebar.js'
import { createTtsService, TtsError } from './tts.js'
import { AudiobookError, createAudiobookService } from './audiobook.js'
import {
  createTagStore,
  FINISHED_PERCENT,
  isTagId,
  readingStatusOf,
  READING_STATUSES,
  TAG_LIMITS,
  TagStoreError,
} from './tags.js'

/**
 * Local bookshelf library for the DSH Web GUI.
 *
 * The Host half owns the durable library: imported files live under
 * `$DSH_HOME/bookshelf/books`, metadata lives in `$DSH_HOME/bookshelf/library.json`,
 * and a small HTTP surface under `/bookshelf` serves the shelf and the file
 * bytes the browser readers need. The browser route is local-only: the web
 * carrier binds loopback, and every response reflects a loopback Origin only.
 */

export const inject = ['webServer', 'directoryPickerController', 'commands', 'sessionProjections']

const ROUTE_PREFIX = '/bookshelf'
const API_PREFIX = '/bookshelf/api'
const ASSET_PREFIX = '/bookshelf/assets'
const MAX_IMPORT_BYTES = 256 * 1024 * 1024
const MAX_STATE_BYTES = 512 * 1024
const MAX_COVER_BYTES = 8 * 1024 * 1024
const MAX_BOOKMARKS = 500
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
const SETTING_THEMES = new Set(['auto', 'light', 'dark'])
const SETTING_PAGE_MARGINS = new Set(['standard', 'compact', 'fill'])
const SETTING_PAGE_MODES = new Set(['scroll', 'paged'])
const SETTING_PDF_FITS = new Set(['page', 'width', 'custom'])
const SETTING_PDF_VIEWS = new Set(['continuous', 'single'])

const ASSET_TYPES = new Map([
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
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

export function apply(ctx, options = {}) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const rootDir = join(home, 'bookshelf')
  const booksDir = join(rootDir, 'books')
  const coversDir = join(rootDir, 'covers')
  const indexPath = join(rootDir, 'library.json')
  const statesPath = join(rootDir, 'state.json')
  const defaultsPath = join(rootDir, 'defaults.json')
  const assetsDir = fileURLToPath(new URL('./assets', import.meta.url))
  const tagStore = createTagStore({ rootDir })

  // Read-aloud secrets never leave the Host. A pasted key is stored in a
  // 0600 file under the bookshelf directory; an environment variable or a
  // credential store entry with the same name still applies as a fallback.
  const ttsSecretsPath = join(rootDir, 'tts-secrets.json')
  let secretsCache = null
  let pendingSecretWrite = Promise.resolve()
  async function readTtsSecrets() {
    if (secretsCache !== null) return secretsCache
    try {
      const parsed = JSON.parse(await fs.readFile(ttsSecretsPath, 'utf8'))
      secretsCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      secretsCache = {}
    }
    return secretsCache
  }
  function writeTtsSecrets(patch) {
    const run = async () => {
      const current = await readTtsSecrets()
      const next = { ...current }
      for (const [name, value] of Object.entries(patch)) {
        if (typeof value === 'string' && value.trim() !== '') next[name] = value.trim()
        else delete next[name]
      }
      secretsCache = next
      await fs.mkdir(rootDir, { recursive: true })
      const temporary = `${ttsSecretsPath}.${process.pid}.tmp`
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 })
      await fs.chmod(temporary, 0o600).catch(() => undefined)
      await replaceFile(temporary, ttsSecretsPath)
      return next
    }
    const pending = pendingSecretWrite.then(run, run)
    pendingSecretWrite = pending.catch(() => undefined)
    return pending
  }
  async function resolveTtsSecret(name) {
    const stored = (await readTtsSecrets())[name]
    if (typeof stored === 'string' && stored !== '') return stored
    const envName = name === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'BOOKSHELF_TTS_OPENAI_KEY'
    const fromEnv = process.env[envName]
    if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
    try {
      const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
      const hit = credentials && typeof credentials.resolve === 'function' ? await credentials.resolve(envName) : undefined
      if (hit && typeof hit.value === 'string' && hit.value !== '') return hit.value
    } catch {
      // The credential store is optional; a missing service is not an error.
    }
    return ''
  }
  const tts = createTtsService({ rootDir, resolveSecret: resolveTtsSecret, logger: ctx.logger, ...(options.tts || {}) })
  const audiobooks = createAudiobookService({ rootDir, tts, logger: ctx.logger })

  let pendingWrite = Promise.resolve()
  let pendingStateWrite = Promise.resolve()
  let pendingDefaultsWrite = Promise.resolve()

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
      const port = String(ctx.webServer.port ?? '')
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

  async function readLibrary() {
    let raw
    try {
      raw = await fs.readFile(indexPath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, books: [] }
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new HttpError(500, 'bookshelf library.json is not valid JSON')
    }
    if (!parsed || !Array.isArray(parsed.books)) {
      throw new HttpError(500, 'bookshelf library.json has no books array')
    }
    return { version: 1, books: parsed.books }
  }

  function updateLibrary(change) {
    const run = async () => {
      const library = await readLibrary()
      const next = { version: 1, books: change(library.books.slice()) }
      await fs.mkdir(rootDir, { recursive: true })
      const temporary = `${indexPath}.${process.pid}.tmp`
      await fs.writeFile(temporary, JSON.stringify(next, null, 2))
      await replaceFile(temporary, indexPath)
    }
    const pending = pendingWrite.then(run, run)
    pendingWrite = pending.catch(() => undefined)
    return pending
  }

  async function readStates() {
    let raw
    try {
      raw = await fs.readFile(statesPath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, books: {} }
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new HttpError(500, 'bookshelf state.json is not valid JSON')
    }
    if (!parsed || typeof parsed.books !== 'object' || parsed.books === null || Array.isArray(parsed.books)) {
      throw new HttpError(500, 'bookshelf state.json has no books map')
    }
    return { version: 1, books: parsed.books }
  }

  async function readDefaults() {
    let raw
    try {
      raw = await fs.readFile(defaultsPath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new HttpError(500, 'bookshelf defaults.json is not valid JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const source = parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings) ? parsed.settings : parsed
    return sanitizeSettings(source) || {}
  }

  function updateDefaults(settings) {
    const run = async () => {
      await fs.mkdir(rootDir, { recursive: true })
      const temporary = `${defaultsPath}.${process.pid}.tmp`
      await fs.writeFile(temporary, JSON.stringify({ version: 1, settings }, null, 2))
      await replaceFile(temporary, defaultsPath)
    }
    const pending = pendingDefaultsWrite.then(run, run)
    pendingDefaultsWrite = pending.catch(() => undefined)
    return pending
  }

  function updateStates(change) {
    const run = async () => {
      const states = await readStates()
      const next = { version: 1, books: change({ ...states.books }) }
      await fs.mkdir(rootDir, { recursive: true })
      const temporary = `${statesPath}.${process.pid}.tmp`
      await fs.writeFile(temporary, JSON.stringify(next, null, 2))
      await replaceFile(temporary, statesPath)
    }
    const pending = pendingStateWrite.then(run, run)
    pendingStateWrite = pending.catch(() => undefined)
    return pending
  }

  function cleanText(value, fallback, limit = 500) {
    if (typeof value !== 'string') return fallback
    const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (cleaned === '') return fallback
    return cleaned.slice(0, limit)
  }

  function normalizedBookText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '')
  }

  function sameShelfBook(record, candidate) {
    return (
      record.format === candidate.format &&
      normalizedBookText(record.title) === normalizedBookText(candidate.title) &&
      normalizedBookText(record.author) === normalizedBookText(candidate.author)
    )
  }

  function publicBook(record) {
    const { link, ...visible } = record
    return visible
  }

  // A damaged tags.json must not take the whole shelf down: it degrades to "no
  // custom tags" and leaves a warning. Mutations still report the real error.
  async function readTagDefinitions() {
    try {
      return await tagStore.list()
    } catch (error) {
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      return []
    }
  }

  function selectedTagIds(record, knownTagIds) {
    if (!Array.isArray(record.tags)) return []
    const ids = []
    for (const value of record.tags) {
      if (typeof value !== 'string' || !knownTagIds.has(value) || ids.includes(value)) continue
      ids.push(value)
    }
    return ids
  }

  function publicBookView(record, state, knownTagIds) {
    const progress = state && state.progress && typeof state.progress === 'object' ? state.progress : null
    const bookmarkCount = state && Array.isArray(state.bookmarks) ? state.bookmarks.length : 0
    const { status, manual } = readingStatusOf(record, progress)
    return {
      ...publicBook(record),
      status,
      statusManual: manual,
      tags: selectedTagIds(record, knownTagIds),
      progress,
      bookmarkCount,
    }
  }

  function titleFromName(name) {
    const base = name.replace(/\\/g, '/').split('/').pop() || 'Untitled'
    const withoutExtension = base.replace(/\.[^.]+$/, '')
    return cleanText(withoutExtension, 'Untitled')
  }

  function clampNumber(value, minimum, maximum) {
    const number = Number(value)
    if (!Number.isFinite(number)) return undefined
    return Math.min(maximum, Math.max(minimum, number))
  }

  function sanitizeProgress(value, format) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const progress = {}
    progress.format = format === 'pdf' || format === 'epub' ? format : value.format === 'pdf' || value.format === 'epub' ? value.format : undefined
    if (progress.format === undefined) delete progress.format
    if (Number.isInteger(value.chapterIndex) && value.chapterIndex >= 0 && value.chapterIndex <= 100000) {
      progress.chapterIndex = value.chapterIndex
    }
    if (Number.isInteger(value.page) && value.page >= 1 && value.page <= 1000000) progress.page = value.page
    const scrollRatio = clampNumber(value.scrollRatio, 0, 1)
    if (scrollRatio !== undefined) progress.scrollRatio = scrollRatio
    const percent = clampNumber(value.percent, 0, 1)
    if (percent !== undefined) progress.percent = percent
    if (typeof value.anchor === 'string') progress.anchor = value.anchor.slice(0, 300)
    if (typeof value.chapterPath === 'string') progress.chapterPath = value.chapterPath.slice(0, 500)
    const updatedAt = clampNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER)
    progress.updatedAt = updatedAt === undefined ? Date.now() : updatedAt
    return progress
  }

  function sanitizeBookmarks(value) {
    if (!Array.isArray(value)) return undefined
    const bookmarks = []
    const seen = new Set()
    for (const item of value.slice(0, MAX_BOOKMARKS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(item.id) ? item.id : randomUUID()
      if (seen.has(id)) continue
      seen.add(id)
      const bookmark = {
        id,
        label: cleanText(item.label, '', 300),
        createdAt: clampNumber(item.createdAt, 0, Number.MAX_SAFE_INTEGER) ?? Date.now(),
      }
      if (item.format === 'pdf' || item.format === 'epub') bookmark.format = item.format
      if (Number.isInteger(item.chapterIndex) && item.chapterIndex >= 0 && item.chapterIndex <= 100000) {
        bookmark.chapterIndex = item.chapterIndex
      }
      if (Number.isInteger(item.page) && item.page >= 1 && item.page <= 1000000) bookmark.page = item.page
      const scrollRatio = clampNumber(item.scrollRatio, 0, 1)
      if (scrollRatio !== undefined) bookmark.scrollRatio = scrollRatio
      const percent = clampNumber(item.percent, 0, 1)
      if (percent !== undefined) bookmark.percent = percent
      if (typeof item.anchor === 'string') bookmark.anchor = item.anchor.slice(0, 300)
      bookmarks.push(bookmark)
    }
    return bookmarks
  }

  function sanitizeSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const settings = sanitizeFontSettings(value)
    const fontSize = clampNumber(value.fontSize, 12, 30)
    if (fontSize !== undefined) settings.fontSize = Math.round(fontSize)
    const lineHeight = clampNumber(value.lineHeight, 1.2, 2.5)
    if (lineHeight !== undefined) settings.lineHeight = Math.round(lineHeight * 100) / 100
    if (SETTING_PAGE_MARGINS.has(value.pageMargin)) settings.pageMargin = value.pageMargin
    if (SETTING_THEMES.has(value.theme)) settings.theme = value.theme
    if (SETTING_PAGE_MODES.has(value.pageMode)) settings.pageMode = value.pageMode
    if (value.pageSpread === 'auto' || value.pageSpread === 'single') settings.pageSpread = value.pageSpread
    if (SETTING_PDF_FITS.has(value.pdfFit)) settings.pdfFit = value.pdfFit
    const pdfZoom = clampNumber(value.pdfZoom, 0.5, 3)
    if (pdfZoom !== undefined) settings.pdfZoom = Math.round(pdfZoom * 100) / 100
    if (SETTING_PDF_VIEWS.has(value.pdfView)) settings.pdfView = value.pdfView
    return settings
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

  function coverPath(record) {
    if (!record.cover || typeof record.cover.ext !== 'string' || !/^\.[a-z0-9]+$/.test(record.cover.ext)) return undefined
    return join(coversDir, `${record.id}${record.cover.ext}`)
  }

  async function removeCover(record) {
    const file = coverPath(record)
    if (file === undefined) return
    await fs.rm(file, { force: true }).catch(() => undefined)
  }

  async function getBookState(request, response, id) {
    const library = await readLibrary()
    const record = library.books.find((book) => book.id === id)
    if (record === undefined) throw new HttpError(404, 'book not found')
    const states = await readStates()
    sendJson(request, response, 200, { state: states.books[id] || null })
  }

  async function putBookState(request, response, id) {
    const library = await readLibrary()
    const record = library.books.find((book) => book.id === id)
    if (record === undefined) throw new HttpError(404, 'book not found')
    const body = await readJsonBody(request, MAX_STATE_BYTES)
    const payload = body && typeof body === 'object' && !Array.isArray(body) && body.state !== undefined ? body.state : body
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'state must be an object')
    const states = await readStates()
    const current = states.books[id] && typeof states.books[id] === 'object' && !Array.isArray(states.books[id]) ? states.books[id] : {}
    const next = { ...current }
    if ('progress' in payload) {
      const progress = sanitizeProgress(payload.progress, record.format)
      if (progress === undefined) throw new HttpError(400, 'progress must be an object')
      progress.format = record.format
      next.progress = progress
    }
    if ('bookmarks' in payload) {
      if (!Array.isArray(payload.bookmarks)) throw new HttpError(400, 'bookmarks must be an array')
      next.bookmarks = sanitizeBookmarks(payload.bookmarks)
    }
    if ('settings' in payload) {
      if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
        throw new HttpError(400, 'settings must be an object')
      }
      next.settings = sanitizeSettings(payload.settings) || {}
    }
    await updateStates((books) => ({ ...books, [id]: next }))
    // Reading a finished book again drops the finished override as soon as the
    // saved progress falls below the last page, so the shelf returns to
    // "continue reading" without another manual step. Settings-only writes keep
    // the override, which is why this checks the incoming patch.
    if (
      'progress' in payload &&
      next.progress &&
      typeof next.progress.percent === 'number' &&
      next.progress.percent < FINISHED_PERCENT &&
      record.status === 'finished'
    ) {
      await updateLibrary((books) =>
        books.map((book) => {
          if (book.id !== id || book.status !== 'finished') return book
          const cleared = { ...book }
          delete cleared.status
          return cleared
        }),
      )
    }
    sendJson(request, response, 200, { state: next })
  }

  async function getDefaults(request, response) {
    sendJson(request, response, 200, { settings: await readDefaults() })
  }

  async function putDefaults(request, response) {
    const body = await readJsonBody(request, MAX_STATE_BYTES)
    const payload = body && typeof body === 'object' && !Array.isArray(body) && body.settings !== undefined ? body.settings : body
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'settings must be an object')
    const settings = sanitizeSettings(payload)
    if (settings === undefined) throw new HttpError(400, 'settings must be an object')
    await updateDefaults(settings)
    sendJson(request, response, 200, { settings })
  }

  async function sendCover(request, response, id) {
    const library = await readLibrary()
    const record = library.books.find((book) => book.id === id)
    if (record === undefined) throw new HttpError(404, 'book not found')
    const file = coverPath(record)
    if (file === undefined) throw new HttpError(404, 'cover not found')
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      throw new HttpError(404, 'cover not found')
    }
    response.writeHead(200, {
      ...baseHeaders(request),
      'Content-Type': record.cover.type || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    })
    const stream = createReadStream(file)
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  }

  async function putCover(request, response, id) {
    const library = await readLibrary()
    const record = library.books.find((book) => book.id === id)
    if (record === undefined) throw new HttpError(404, 'book not found')
    const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    const extension = COVER_TYPES.get(type)
    if (extension === undefined) throw new HttpError(415, 'cover must be a JPEG, PNG, GIF, WebP, or SVG image')
    await fs.mkdir(coversDir, { recursive: true })
    const target = join(coversDir, `${id}${extension}`)
    const partial = `${target}.${randomUUID()}.part`
    try {
      await receiveBody(request, partial, MAX_COVER_BYTES)
      await fs.rename(partial, target)
      const stat = await fs.stat(target)
      const cover = { type, ext: extension, bytes: stat.size, updatedAt: Date.now() }
      await updateLibrary((books) => books.map((book) => (book.id === id ? { ...book, cover } : book)))
      if (record.cover && record.cover.ext !== extension) {
        await fs.rm(join(coversDir, `${id}${record.cover.ext}`), { force: true }).catch(() => undefined)
      }
      sendJson(request, response, 200, { cover })
    } catch (error) {
      await fs.rm(partial, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async function listBooks(request, response) {
    const library = await readLibrary()
    let states = { books: {} }
    try {
      states = await readStates()
    } catch (error) {
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    }
    const tags = await readTagDefinitions()
    const knownTagIds = new Set(tags.map((tag) => tag.id))
    const books = library.books
      .slice()
      .sort((left, right) => (Number(right.addedAt) || 0) - (Number(left.addedAt) || 0))
      .map((book) => publicBookView(book, states.books[book.id], knownTagIds))
    sendJson(request, response, 200, { books, tags })
  }

  const linkSessions = new Map()
  const LINK_SESSION_TTL = 10 * 60 * 1000

  function pruneLinkSessions() {
    const now = Date.now()
    for (const [token, session] of linkSessions) {
      if (session.expiresAt <= now) linkSessions.delete(token)
    }
    while (linkSessions.size > 8) {
      const oldest = linkSessions.keys().next().value
      if (oldest === undefined) break
      linkSessions.delete(oldest)
    }
  }

  async function listLinkableFiles(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue
      const extension = extname(entry.name).toLowerCase()
      if (extension !== '.epub' && extension !== '.pdf') continue
      const full = join(directory, entry.name)
      let info
      try {
        info = await fs.stat(full)
      } catch {
        continue
      }
      if (!info.isFile()) continue
      files.push({ name: entry.name, format: extension.slice(1), bytes: info.size })
      if (files.length >= 500) break
    }
    files.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    return files
  }

  async function pickLinkFolder(request, response) {
    if (!ctx.directoryPickerController || typeof ctx.directoryPickerController.pick !== 'function') {
      throw new HttpError(503, 'the native folder picker is unavailable')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000)
    let selected
    try {
      selected = await ctx.directoryPickerController.pick(controller.signal)
    } catch {
      throw new HttpError(503, 'the native folder picker is unavailable')
    } finally {
      clearTimeout(timer)
    }
    if (selected === null || selected === undefined || selected === '') {
      sendJson(request, response, 200, { cancelled: true, files: [] })
      return
    }
    let directory
    try {
      directory = await fs.realpath(String(selected))
      const info = await fs.stat(directory)
      if (!info.isDirectory()) throw new Error('not a directory')
    } catch {
      throw new HttpError(400, 'the selected folder is not readable')
    }
    const files = await listLinkableFiles(directory)
    const library = await readLibrary()
    const linked = new Map(
      library.books
        .filter((book) => book.link && book.link.kind === 'file')
        .map((book) => [book.link.path, book.link.mode === 'copy' ? 'copy' : 'symlink']),
    )
    const enriched = []
    for (const file of files) {
      let resolved
      try {
        resolved = await fs.realpath(join(directory, file.name))
      } catch {
        resolved = ''
      }
      const mode = resolved === '' ? undefined : linked.get(resolved)
      enriched.push({ ...file, linked: mode !== undefined, mode: mode ?? '' })
    }
    pruneLinkSessions()
    const token = randomUUID()
    linkSessions.set(token, {
      directory,
      files: new Set(files.map((file) => file.name)),
      expiresAt: Date.now() + LINK_SESSION_TTL,
    })
    sendJson(request, response, 200, { token, directory, files: enriched })
  }

  async function importLinkBook(request, response) {
    const body = await readJsonBody(request, 16 * 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid link import')
    const token = typeof body.token === 'string' ? body.token : ''
    const name = typeof body.name === 'string' ? body.name : ''
    const session = linkSessions.get(token)
    if (session === undefined || session.expiresAt <= Date.now()) {
      if (session !== undefined) linkSessions.delete(token)
      throw new HttpError(410, 'the folder selection expired; choose the folder again')
    }
    if (
      name === '' ||
      name.includes('/') ||
      name.includes('\\') ||
      name === '.' ||
      name === '..' ||
      !session.files.has(name)
    ) {
      throw new HttpError(400, 'invalid file in the selected folder')
    }
    let source
    let info
    try {
      source = await fs.realpath(join(session.directory, name))
      info = await fs.stat(source)
    } catch {
      throw new HttpError(404, 'the selected file is no longer available')
    }
    if (!info.isFile()) throw new HttpError(400, 'the selected entry is not a file')
    if (!source.startsWith(`${session.directory}${sep}`)) throw new HttpError(403, 'file is outside the selected folder')
    const format = extname(name).slice(1).toLowerCase()
    if (format !== 'epub' && format !== 'pdf') throw new HttpError(415, 'only EPUB and PDF can be added')
    if (info.size > MAX_IMPORT_BYTES) throw new HttpError(413, 'book is too large')
    const library = await readLibrary()
    const existing = library.books.find((book) => book.link && book.link.kind === 'file' && book.link.path === source)
    if (existing !== undefined) {
      const mode = existing.link.mode === 'copy' ? 'copy' : 'symlink'
      sendJson(request, response, 200, { book: publicBook(existing), duplicate: true, mode })
      return
    }
    const id = randomUUID()
    await fs.mkdir(booksDir, { recursive: true })
    const target = join(booksDir, `${id}.${format}`)
    try {
      const mode = await createSourceLink(source, target)
      if (mode === 'copy') ctx.logger.info('bookshelf: symbolic link denied; stored a shelf copy')
      const title = titleFromName(name)
      const record = {
        id,
        title,
        author: '',
        format,
        bytes: info.size,
        name: cleanText(name, `${title}.${format}`, 300),
        addedAt: Date.now(),
        link: { kind: 'file', path: source, mode },
      }
      await updateLibrary((books) => [record, ...books.filter((book) => book.id !== id)])
      sendJson(request, response, 201, { book: publicBook(record), mode })
    } catch (error) {
      await fs.unlink(target).catch(() => undefined)
      await fs.unlink(`${target}.copy`).catch(() => undefined)
      throw error
    }
  }

  async function listAppleBooksRoute(request, response, url) {
    if (process.platform !== 'darwin') throw new HttpError(501, 'Apple Books import is available on macOS only')
    const query = cleanText(url.searchParams.get('query'), '', 200)
    const offset = Number(url.searchParams.get('offset'))
    const limit = Number(url.searchParams.get('limit'))
    const result = await listAppleBooks({
      query,
      offset: Number.isInteger(offset) && offset >= 0 ? offset : 0,
      limit: Number.isInteger(limit) && limit > 0 ? Math.min(100, limit) : 50,
    })
    const library = await readLibrary()
    result.books = result.books.map((book) => ({
      ...book,
      imported: library.books.some(
        (record) =>
          (record.source &&
            record.source.kind === 'apple-books' &&
            record.source.assetID === book.assetID) ||
          sameShelfBook(record, book),
      ),
    }))
    sendJson(request, response, 200, result)
  }

  async function importAppleBook(request, response, url) {
    if (process.platform !== 'darwin') throw new HttpError(501, 'Apple Books import is available on macOS only')
    const assetID = String(url.searchParams.get('assetID') || '')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(assetID)) throw new HttpError(400, 'invalid Apple Books assetID')
    const library = await readLibrary()
    const existing = library.books.find(
      (book) => book.source && book.source.kind === 'apple-books' && book.source.assetID === assetID,
    )
    if (existing !== undefined) {
      sendJson(request, response, 200, { book: publicBook(existing), duplicate: true })
      return
    }
    const source = await readAppleBook(assetID)
    if (source.format !== 'epub' && source.format !== 'pdf') throw new HttpError(415, 'unsupported format')
    const same = library.books.find((book) =>
      sameShelfBook(book, { format: source.format, title: source.title, author: source.author }),
    )
    if (same !== undefined) {
      sendJson(request, response, 200, { book: publicBook(same), duplicate: true })
      return
    }
    if (!source.link || typeof source.link.path !== 'string') throw new HttpError(415, 'unsupported source')
    if (!source.bytes || source.bytes <= 0) throw new HttpError(400, 'empty book')
    if (source.bytes > MAX_IMPORT_BYTES) throw new HttpError(413, 'book is too large')
    const id = randomUUID()
    await fs.mkdir(booksDir, { recursive: true })
    const target = join(booksDir, `${id}.${source.format}`)
    try {
      await fs.symlink(source.link.path, target, source.link.kind === 'directory' ? 'dir' : 'file')
      const title = cleanText(source.title, 'Untitled', 500)
      const record = {
        id,
        title,
        author: cleanText(source.author, '', 500),
        format: source.format,
        bytes: source.bytes,
        name: cleanText(`${title}.${source.format}`, `book.${source.format}`, 300),
        addedAt: Date.now(),
        link: { kind: source.link.kind, path: source.link.path },
        source: { kind: 'apple-books', assetID },
      }
      await updateLibrary((books) => [record, ...books.filter((book) => book.id !== id)])
      sendJson(request, response, 201, { book: publicBook(record) })
    } catch (error) {
      await fs.unlink(target).catch(() => undefined)
      throw error
    }
  }

  async function importBook(request, response, url) {
    const name = cleanText(url.searchParams.get('name'), 'Untitled', 300)
    const requestedFormat = (url.searchParams.get('format') || extname(name).slice(1)).toLowerCase()
    const format = requestedFormat === 'epub' ? 'epub' : requestedFormat === 'pdf' ? 'pdf' : null
    if (format === null) throw new HttpError(415, 'only PDF and EPUB files can be imported')
    const id = randomUUID()
    await fs.mkdir(booksDir, { recursive: true })
    const target = join(booksDir, `${id}.${format}`)
    const partial = `${target}.part`
    const bytes = await receiveBody(request, partial)
    await fs.rename(partial, target)
    const record = {
      id,
      title: cleanText(url.searchParams.get('title'), titleFromName(name)),
      author: cleanText(url.searchParams.get('author'), ''),
      format,
      bytes,
      name,
      addedAt: Date.now(),
    }
    try {
      await updateLibrary((books) => [record, ...books.filter((book) => book.id !== id)])
    } catch (error) {
      await fs.rm(target, { force: true }).catch(() => undefined)
      throw error
    }
    sendJson(request, response, 201, { book: publicBook(record) })
  }

  async function updateBookMetadata(request, response, id) {
    const library = await readLibrary()
    const record = library.books.find((book) => book.id === id)
    if (record === undefined) throw new HttpError(404, 'book not found')
    const body = await readJsonBody(request, 16 * 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'metadata must be an object')
    const patch = {}
    if ('title' in body) {
      if (typeof body.title !== 'string') throw new HttpError(400, 'title must be a string')
      const title = cleanText(body.title, '', 500)
      if (title === '') throw new HttpError(400, 'title must not be empty')
      patch.title = title
    }
    if ('author' in body) {
      if (typeof body.author !== 'string') throw new HttpError(400, 'author must be a string')
      patch.author = cleanText(body.author, '', 500)
    }
    if ('status' in body) {
      if (body.status === null) patch.status = null
      else if (READING_STATUSES.includes(body.status)) patch.status = body.status
      else throw new HttpError(400, `status must be null or one of ${READING_STATUSES.join(', ')}`)
    }
    if ('tags' in body) {
      if (!Array.isArray(body.tags)) throw new HttpError(400, 'tags must be an array of tag ids')
      if (body.tags.length > TAG_LIMITS.maxPerBook) {
        throw new HttpError(400, `at most ${TAG_LIMITS.maxPerBook} tags can be attached to one book`)
      }
      const ids = []
      for (const value of body.tags) {
        if (!isTagId(value)) throw new HttpError(400, 'tags must contain tag ids')
        if (!ids.includes(value)) ids.push(value)
      }
      if (ids.length > 0) {
        // A typo must fail instead of silently dropping the assignment.
        const knownTagIds = new Set((await tagStore.list()).map((tag) => tag.id))
        const unknown = ids.find((value) => !knownTagIds.has(value))
        if (unknown !== undefined) throw new HttpError(400, `unknown tag id: ${unknown}`)
      }
      patch.tags = ids
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'nothing to update')
    let updated
    await updateLibrary((books) =>
      books.map((book) => {
        if (book.id !== id) return book
        const next = { ...book, ...patch }
        // `status: null` means "follow progress again", which is stored by
        // dropping the override rather than by keeping a null value.
        if (patch.status === null) delete next.status
        updated = next
        return next
      }),
    )
    const state = (await readStates()).books[id]
    const tagDefinitions = await readTagDefinitions()
    sendJson(request, response, 200, {
      book: publicBookView(updated, state, new Set(tagDefinitions.map((tag) => tag.id))),
    })
  }

  async function findBook(id) {
    const library = await readLibrary()
    const record = library.books.find((book) => book.id === id)
    if (record === undefined) throw new HttpError(404, 'book not found')
    return record
  }

  async function deleteBook(request, response, id) {
    const library = await readLibrary()
    const record = library.books.find((book) => book.id === id)
    if (record === undefined) throw new HttpError(404, 'book not found')
    if (FORMAT_MIME[record.format] === undefined) throw new HttpError(500, 'book record has an invalid format')
    const file = join(booksDir, `${id}.${record.format}`)
    await updateLibrary((books) => books.filter((book) => book.id !== id))
    // Only the shelf entry is removed. A symlink is unlinked, never followed;
    // a legacy copied file is unlinked; the user's original is never touched.
    let info
    try {
      info = await fs.lstat(file)
    } catch {
      info = undefined
    }
    if (info !== undefined && (info.isSymbolicLink() || info.isFile())) {
      await fs.unlink(file).catch(() => undefined)
    }
    await removeCover(record)
    await audiobooks.remove(id).catch((error) => ctx.logger.warn(error instanceof Error ? error : new Error(String(error))))
    await updateStates((books) => {
      const next = { ...books }
      delete next[id]
      return next
    }).catch((error) => ctx.logger.warn(error instanceof Error ? error : new Error(String(error))))
    sendJson(request, response, 200, { ok: true })
  }

  async function sendBookFile(request, response, id) {
    const library = await readLibrary()
    const record = library.books.find((book) => book.id === id)
    if (record === undefined) throw new HttpError(404, 'book not found')
    const mime = FORMAT_MIME[record.format]
    if (mime === undefined) throw new HttpError(415, 'unsupported book format')
    const file = join(booksDir, `${id}.${record.format}`)
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      throw new HttpError(404, 'book file is missing')
    }
    if (record.format === 'epub') {
      // Bind the browser's rendered snapshot to exactly the source served here.
      // Directory EPUBs are hashed by entry contents, independent of ZIP timestamps.
      if (!stat.isDirectory() && (!stat.isFile() || stat.size > MAX_IMPORT_BYTES)) {
        throw new HttpError(413, 'EPUB source is unavailable or exceeds 256 MB')
      }
      let stored, revision
      try {
        if (stat.isDirectory()) {
          revision = await sourceRevision(file)
          stored = await packEpubDirectory(file)
        } else {
          stored = await fs.readFile(file)
          revision = `shelf-file-v1:${createHash('sha256').update(stored).digest('hex')}`
        }
        if (revision !== await sourceRevision(file)) throw new HttpError(409, 'EPUB source changed while loading; reopen the book')
      } catch (error) {
        if (error instanceof HttpError) throw error
        if (error instanceof AppleBooksImportError) throw new HttpError(error.status, error.message)
        throw new HttpError(409, 'could not read a stable EPUB source; reopen the book')
      }
      response.writeHead(200, {
        ...baseHeaders(request),
        'Content-Type': FORMAT_MIME.epub,
        'Content-Length': stored.length,
        'X-Bookshelf-Source-Revision': revision,
        'Access-Control-Expose-Headers': 'X-Bookshelf-Source-Revision',
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.name || `${record.title}.epub`)}`,
      })
      response.end(stored)
      return
    }
    if (stat.isDirectory()) throw new HttpError(415, 'directory sources are EPUB only')
    const headers = {
      ...baseHeaders(request),
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.name || `${record.title}.${record.format}`)}`,
    }
    const range = request.headers.range
    if (typeof range === 'string' && range.startsWith('bytes=')) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      const start = match && match[1] !== '' ? Number(match[1]) : 0
      const end = match && match[2] !== '' ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        response.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` })
        response.end()
        return
      }
      response.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      })
      const stream = createReadStream(file, { start, end })
      stream.on('error', () => response.destroy())
      stream.pipe(response)
      return
    }
    response.writeHead(200, { ...headers, 'Content-Length': stat.size })
    const stream = createReadStream(file)
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  }

  async function sendAsset(request, response, pathname) {
    let relative
    try {
      relative = decodeURIComponent(pathname.slice(ASSET_PREFIX.length + 1))
    } catch {
      throw new HttpError(400, 'malformed asset path')
    }
    if (relative.includes('\0')) throw new HttpError(400, 'malformed asset path')
    const target = resolve(assetsDir, relative)
    if (target !== assetsDir && !target.startsWith(`${assetsDir}${sep}`)) {
      throw new HttpError(403, 'asset path outside the package')
    }
    let stat
    try {
      stat = await fs.stat(target)
    } catch {
      throw new HttpError(404, 'asset not found')
    }
    if (!stat.isFile()) throw new HttpError(404, 'asset not found')
    const extension = extname(target).toLowerCase()
    response.writeHead(200, {
      ...baseHeaders(request),
      'Content-Type': ASSET_TYPES.get(extension) || 'application/octet-stream',
      'Content-Length': stat.size,
      // Browser code is revalidated so a refreshed page picks up a changed
      // parser; large binary data (CMaps, fonts, WASM) stays cacheable.
      'Cache-Control': extension === '.mjs' || extension === '.js' ? 'no-cache' : 'public, max-age=3600',
    })
    const stream = createReadStream(target)
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  }

  async function migrateAppleLinks() {
    if (process.platform !== 'darwin') return
    let library
    try {
      library = await readLibrary()
    } catch {
      return
    }
    const migrated = new Map()
    for (const record of library.books) {
      if (
        record.source === undefined ||
        record.source.kind !== 'apple-books' ||
        typeof record.source.assetID !== 'string' ||
        record.link !== undefined
      ) {
        continue
      }
      try {
        const source = await readAppleBook(record.source.assetID)
        if (!source.link || !source.bytes) {
          continue
        }
        await fs.mkdir(booksDir, { recursive: true })
        const target = join(booksDir, `${record.id}.${record.format}`)
        const temporary = `${target}.link-${randomUUID()}`
        await fs.symlink(source.link.path, temporary, source.link.kind === 'directory' ? 'dir' : 'file')
        try {
          await fs.rename(temporary, target)
        } catch (error) {
          await fs.unlink(temporary).catch(() => undefined)
          throw error
        }
        migrated.set(record.id, { bytes: source.bytes, link: source.link })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (migrated.size > 0) {
      await updateLibrary((books) =>
        books.map((book) => {
          const patch = migrated.get(book.id)
          return patch === undefined ? book : { ...book, ...patch }
        }),
      )
      ctx.logger.info('bookshelf: migrated existing Apple Books imports to soft links')
    }
  }

  async function handler(request, response) {
    let url
    try {
      url = new URL(request.url ?? '/', 'http://bookshelf.invalid')
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, baseHeaders(request))
        response.end()
        return
      }
      const pathname = url.pathname
      if (pathname === `${API_PREFIX}/links/pick`) {
        if (request.method !== 'POST') throw new HttpError(405, 'method not allowed')
        await pickLinkFolder(request, response)
        return
      }
      if (pathname === `${API_PREFIX}/links/import`) {
        if (request.method !== 'POST') throw new HttpError(405, 'method not allowed')
        await importLinkBook(request, response)
        return
      }
      if (pathname === `${API_PREFIX}/apple-books` || pathname === `${API_PREFIX}/apple-books/`) {
        if (request.method !== 'GET') throw new HttpError(405, 'method not allowed')
        await listAppleBooksRoute(request, response, url)
        return
      }
      if (pathname === `${API_PREFIX}/apple-books/import`) {
        if (request.method !== 'POST') throw new HttpError(405, 'method not allowed')
        await importAppleBook(request, response, url)
        return
      }
      if (pathname === `${API_PREFIX}/capabilities`) {
        if (request.method !== 'GET') throw new HttpError(405, 'method not allowed')
        sendJson(request, response, 200, {
          platform: process.platform,
          appleBooks: process.platform === 'darwin',
        })
        return
      }
      if (pathname === `${API_PREFIX}/settings`) {
        if (request.method === 'GET') {
          await getDefaults(request, response)
          return
        }
        if (request.method === 'PUT') {
          await putDefaults(request, response)
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      if (pathname === `${API_PREFIX}/tags` || pathname === `${API_PREFIX}/tags/`) {
        if (request.method === 'GET') {
          sendJson(request, response, 200, { tags: await tagStore.list() })
          return
        }
        if (request.method === 'POST') {
          const body = await readJsonBody(request, 16 * 1024)
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'tag must be an object')
          const tag = await tagStore.create(body.name)
          sendJson(request, response, 201, { tag })
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      const tagMatch = new RegExp(`^${API_PREFIX}/tags/([0-9a-f-]{36})$`).exec(pathname)
      if (tagMatch !== null) {
        const tagId = tagMatch[1]
        if (request.method === 'PATCH') {
          const body = await readJsonBody(request, 16 * 1024)
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'tag must be an object')
          const tag = await tagStore.rename(tagId, body.name)
          sendJson(request, response, 200, { tag })
          return
        }
        if (request.method === 'DELETE') {
          // Remove the definition last: books are stripped first, so a crash in
          // between leaves no dangling reference behind.
          const existing = (await tagStore.list()).find((tag) => tag.id === tagId)
          if (existing === undefined) throw new HttpError(404, 'tag not found')
          const library = await readLibrary()
          const affected = library.books.filter(
            (book) => Array.isArray(book.tags) && book.tags.includes(tagId),
          ).length
          if (affected > 0) {
            await updateLibrary((books) =>
              books.map((book) =>
                Array.isArray(book.tags) && book.tags.includes(tagId)
                  ? { ...book, tags: book.tags.filter((value) => value !== tagId) }
                  : book,
              ),
            )
          }
          await tagStore.remove(tagId)
          sendJson(request, response, 200, { ok: true, affected, tag: existing })
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      if (pathname === `${API_PREFIX}/tts/capabilities`) {
        if (request.method !== 'GET') throw new HttpError(405, 'method not allowed')
        await tts.ready()
        const capabilities = await tts.capabilities()
        // Report only whether a key is set; never echo the value.
        capabilities.secrets = {
          deepseek: (await resolveTtsSecret('deepseek')) !== '',
          openai: (await resolveTtsSecret('openai')) !== '',
        }
        sendJson(request, response, 200, capabilities)
        return
      }
      if (pathname === `${API_PREFIX}/tts/voices`) {
        if (request.method !== 'GET') throw new HttpError(405, 'method not allowed')
        await tts.ready()
        const provider = cleanText(url.searchParams.get('provider'), '', 40)
        sendJson(request, response, 200, { voices: await tts.voices(provider) })
        return
      }
      if (pathname === `${API_PREFIX}/tts/settings`) {
        if (request.method === 'GET') {
          sendJson(request, response, 200, { settings: tts.getSettings() })
          return
        }
        if (request.method === 'PUT') {
          const body = await readJsonBody(request, 32 * 1024)
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'settings must be an object')
          const patch = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : body
          const secrets = body.secrets && typeof body.secrets === 'object' && !Array.isArray(body.secrets) ? body.secrets : undefined
          if (secrets !== undefined) await writeTtsSecrets(secrets)
          const settings = await tts.updateSettings(patch)
          sendJson(request, response, 200, { settings })
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      if (pathname === `${API_PREFIX}/tts/synthesize`) {
        if (request.method !== 'POST') throw new HttpError(405, 'method not allowed')
        const body = await readJsonBody(request, 64 * 1024)
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid synthesis request')
        await tts.ready()
        const result = await tts.synthesize({
          provider: cleanText(body.provider, '', 40),
          voice: cleanText(body.voice, '', 64),
          speed: body.speed,
          text: typeof body.text === 'string' ? body.text : '',
        })
        // Hand back a same-origin URL: browser CSP blocks blob: media, while a
        // plain Host URL plays everywhere.
        sendJson(request, response, 200, {
          url: `${API_PREFIX}/tts/audio/${result.name}`,
          mime: result.mime,
          cached: result.cached,
        })
        return
      }
      const audioMatch = new RegExp(`^${API_PREFIX}/tts/audio/([0-9a-f]{64}\\.(?:wav|mp3))$`).exec(pathname)
      if (audioMatch !== null) {
        if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'method not allowed')
        const audio = await tts.readAudio(audioMatch[1])
        if (audio === null) throw new HttpError(404, 'audio not found')
        response.writeHead(200, {
          ...baseHeaders(request),
          'Content-Type': audio.mime,
          'Content-Length': audio.audio.length,
          // The name is a content hash, so the bytes never change.
          'Cache-Control': 'public, max-age=31536000, immutable',
        })
        if (request.method === 'HEAD') response.end()
        else response.end(audio.audio)
        return
      }
      if (pathname === `${API_PREFIX}/tts/cache`) {
        if (request.method === 'GET') {
          sendJson(request, response, 200, await tts.cache.stats())
          return
        }
        if (request.method === 'DELETE') {
          sendJson(request, response, 200, await tts.cache.clear())
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      const audiobookPlan = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio/plan$`).exec(pathname)
      if (audiobookPlan !== null) {
        if (request.method !== 'POST') throw new HttpError(405, 'method not allowed')
        const record = await findBook(audiobookPlan[1])
        const body = await readJsonBody(request, 8 * 1024 * 1024)
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid audiobook plan')
        const plan = await audiobooks.plan(record.id, {
          text: typeof body.text === 'string' ? body.text : '',
          voice: cleanText(body.voice, '', 40),
          speed: body.speed,
        })
        sendJson(request, response, 200, { plan })
        return
      }
      const audiobookStart = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio/start$`).exec(pathname)
      if (audiobookStart !== null) {
        if (request.method !== 'POST') throw new HttpError(405, 'method not allowed')
        const record = await findBook(audiobookStart[1])
        const body = await readJsonBody(request, 16 * 1024)
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid audiobook request')
        const state = await audiobooks.start(record.id, { voice: cleanText(body.voice, '', 40), speed: body.speed })
        sendJson(request, response, 200, { state })
        return
      }
      const audiobookCancel = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio/cancel$`).exec(pathname)
      if (audiobookCancel !== null) {
        if (request.method !== 'POST') throw new HttpError(405, 'method not allowed')
        const record = await findBook(audiobookCancel[1])
        sendJson(request, response, 200, { state: await audiobooks.cancel(record.id) })
        return
      }
      const audiobookFile = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio/file$`).exec(pathname)
      if (audiobookFile !== null) {
        if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'method not allowed')
        const record = await findBook(audiobookFile[1])
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
          'Content-Type': 'audio/wav',
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Disposition': `inline; filename="${record.id}.wav"`,
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
        return
      }
      const audiobookState = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/audio$`).exec(pathname)
      if (audiobookState !== null) {
        if (request.method === 'GET') {
          const record = await findBook(audiobookState[1])
          sendJson(request, response, 200, { state: await audiobooks.state(record.id) })
          return
        }
        if (request.method === 'DELETE') {
          const record = await findBook(audiobookState[1])
          await audiobooks.remove(record.id)
          sendJson(request, response, 200, { ok: true })
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      if (pathname === `${API_PREFIX}/books` || pathname === `${API_PREFIX}/books/`) {
        if (request.method === 'GET') {
          await listBooks(request, response)
          return
        }
        if (request.method === 'POST') {
          await importBook(request, response, url)
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      const stateMatch = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/state$`).exec(pathname)
      if (stateMatch !== null) {
        if (request.method === 'GET') {
          await getBookState(request, response, stateMatch[1])
          return
        }
        if (request.method === 'PUT') {
          await putBookState(request, response, stateMatch[1])
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      const coverMatch = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/cover$`).exec(pathname)
      if (coverMatch !== null) {
        if (request.method === 'GET') {
          await sendCover(request, response, coverMatch[1])
          return
        }
        if (request.method === 'PUT') {
          await putCover(request, response, coverMatch[1])
          return
        }
        throw new HttpError(405, 'method not allowed')
      }
      const fileMatch = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/file$`).exec(pathname)
      if (fileMatch !== null) {
        if (request.method !== 'GET') throw new HttpError(405, 'method not allowed')
        await sendBookFile(request, response, fileMatch[1])
        return
      }
      const bookMatch = new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})$`).exec(pathname)
      if (bookMatch !== null) {
        if (request.method === 'PATCH') {
          await updateBookMetadata(request, response, bookMatch[1])
          return
        }
        if (request.method !== 'DELETE') throw new HttpError(405, 'method not allowed')
        await deleteBook(request, response, bookMatch[1])
        return
      }
      if (pathname.startsWith(`${ASSET_PREFIX}/`)) {
        if (request.method !== 'GET') throw new HttpError(405, 'method not allowed')
        await sendAsset(request, response, pathname)
        return
      }
      throw new HttpError(404, 'not found')
    } catch (error) {
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof TagStoreError
            ? error.status
            : error instanceof TtsError
              ? error.status
              : error instanceof AudiobookError
                ? error.status
                : error instanceof AppleBooksImportError
                ? error.status
                : 500
      if (status >= 500) ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      if (response.headersSent) {
        response.destroy()
        return
      }
      sendJson(request, response, status, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // The Host composition injects both services. Tests that mount only the HTTP
  // shelf pass a minimal context, so keep the sidebar capability optional there.
  if (ctx.sessionProjections && ctx.commands) {
    const sidebarSnapshots = new ShelfSidebarSnapshotController(ctx.sessionProjections, rootDir)
    ctx.effect(() => ctx.sessionProjections.register(sidebarSnapshotProjection), 'bookshelf: sidebar snapshot projection')
    ctx.effect(() => ctx.commands.register(createSidebarSnapshotCommand(sidebarSnapshots)), 'bookshelf: sidebar snapshot command')
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
    'bookshelf: http routes',
  )
  void tts.load().catch((error) => ctx.logger.warn(error instanceof Error ? error : new Error(String(error))))
  ctx.logger.info(`bookshelf: library at ${rootDir}`)
  void migrateAppleLinks().catch((error) => {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  })
}
