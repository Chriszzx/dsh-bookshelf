import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { AppleBooksImportError, packEpubDirectory } from '../apple-books.js'
import { sourceRevision } from '../source-revision.js'
import { FINISHED_PERCENT, isTagId, READING_STATUSES, readingStatusOf, TAG_LIMITS } from '../tags.js'

import { API_PREFIX, COVER_TYPES, FORMAT_MIME, HttpError, MAX_COVER_BYTES, MAX_IMPORT_BYTES, MAX_STATE_BYTES } from './http.js'
import { exactRoute, regexRoute } from './routes.js'
import { cleanText, sanitizeBookmarks, sanitizeProgress, sanitizeSettings } from './states.js'

// Book records: import, metadata, covers, file serving and per-book state
// routes. Helpers shared with the link and Apple Books routes are exported.

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

export { sameShelfBook, publicBook, titleFromName }

export function createLibraryHandlers({ http, store, audiobooks, logger } = {}) {
  const { sendJson, baseHeaders, readJsonBody, receiveBody } = http
  const { booksDir, coversDir, readLibrary, readStates, updateLibrary, updateStates, tagStore, readTagDefinitions } = store

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
    await audiobooks.remove(id).catch((error) => logger.warn(error instanceof Error ? error : new Error(String(error))))
    await updateStates((books) => {
      const next = { ...books }
      delete next[id]
      return next
    }).catch((error) => logger.warn(error instanceof Error ? error : new Error(String(error))))
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

  const routes = [
    exactRoute([`${API_PREFIX}/books`, `${API_PREFIX}/books/`], {
      GET: (request, response) => listBooks(request, response),
      POST: (request, response, context) => importBook(request, response, context.url),
    }),
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/state$`), {
      GET: (request, response, context) => getBookState(request, response, context.params[1]),
      PUT: (request, response, context) => putBookState(request, response, context.params[1]),
    }),
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/cover$`), {
      GET: (request, response, context) => sendCover(request, response, context.params[1]),
      PUT: (request, response, context) => putCover(request, response, context.params[1]),
    }),
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})/file$`), {
      GET: (request, response, context) => sendBookFile(request, response, context.params[1]),
    }),
    regexRoute(new RegExp(`^${API_PREFIX}/books/([0-9a-f-]{36})$`), {
      PATCH: (request, response, context) => updateBookMetadata(request, response, context.params[1]),
      DELETE: (request, response, context) => deleteBook(request, response, context.params[1]),
    }),
  ]
  return { routes, findBook }
}
