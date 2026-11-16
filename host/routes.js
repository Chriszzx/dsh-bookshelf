import { AppleBooksImportError } from '../apple-books.js'
import { TagStoreError } from '../tags.js'
import { AudiobookError } from '../audiobook.js'
import { TtsError } from '../tts.js'

import { API_PREFIX, HttpError, MAX_STATE_BYTES } from './http.js'
import { sanitizeSettings } from './states.js'

// Route table helpers. Every `host/*-routes.js` module returns descriptors of
// one of these shapes, and index.js composes them into one ordered table. The
// order is the dispatch order, which mirrors the original if-chain exactly.

export function exactRoute(paths, methods) {
  return { kind: 'exact', paths: Array.isArray(paths) ? paths : [paths], methods }
}

export function regexRoute(pattern, methods) {
  return { kind: 'regex', pattern, methods }
}

export function prefixRoute(prefix, methods) {
  return { kind: 'prefix', prefix, methods }
}

/**
 * Host bookkeeping endpoints that are not owned by a domain module: platform
 * capabilities, reader defaults and tag definitions.
 */
export function createBookkeepingRoutes({ http, store } = {}) {
  const { sendJson, readJsonBody } = http
  const { tagStore, readDefaults, updateDefaults, readLibrary, updateLibrary } = store

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

  async function listTags(request, response) {
    sendJson(request, response, 200, { tags: await tagStore.list() })
  }

  async function createTag(request, response) {
    const body = await readJsonBody(request, 16 * 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'tag must be an object')
    const tag = await tagStore.create(body.name)
    sendJson(request, response, 201, { tag })
  }

  async function renameTag(request, response, tagId) {
    const body = await readJsonBody(request, 16 * 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'tag must be an object')
    const tag = await tagStore.rename(tagId, body.name)
    sendJson(request, response, 200, { tag })
  }

  async function removeTag(request, response, tagId) {
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
  }

  return [
    exactRoute(`${API_PREFIX}/capabilities`, {
      GET: (request, response) => sendJson(request, response, 200, {
        platform: process.platform,
        appleBooks: process.platform === 'darwin',
      }),
    }),
    exactRoute(`${API_PREFIX}/settings`, { GET: getDefaults, PUT: putDefaults }),
    exactRoute([`${API_PREFIX}/tags`, `${API_PREFIX}/tags/`], { GET: listTags, POST: createTag }),
    regexRoute(new RegExp(`^${API_PREFIX}/tags/([0-9a-f-]{36})$`), {
      PATCH: (request, response, context) => renameTag(request, response, context.params[1]),
      DELETE: (request, response, context) => removeTag(request, response, context.params[1]),
    }),
  ]
}

/**
 * The single Host request handler: parse the URL, answer CORS preflights, walk
 * the ordered route table and turn every thrown error into the JSON error body
 * the browser expects.
 */
export function createRouteHandler({ http, routes, logger } = {}) {
  return async function handler(request, response) {
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
        response.writeHead(204, http.baseHeaders(request))
        response.end()
        return
      }
      const pathname = url.pathname
      for (const route of routes) {
        let params = null
        if (route.kind === 'exact') {
          if (!route.paths.includes(pathname)) continue
        } else if (route.kind === 'regex') {
          params = route.pattern.exec(pathname)
          if (params === null) continue
        } else if (route.kind === 'prefix') {
          if (!pathname.startsWith(route.prefix)) continue
        }
        const method = route.methods[request.method]
        if (method === undefined) throw new HttpError(405, 'method not allowed')
        await method(request, response, { url, params })
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
      if (status >= 500) logger.warn(error instanceof Error ? error : new Error(String(error)))
      if (response.headersSent) {
        response.destroy()
        return
      }
      http.sendJson(request, response, status, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
