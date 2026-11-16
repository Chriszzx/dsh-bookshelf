import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname, join, sep } from 'node:path'

import { createSourceLink } from '../link-source.js'

import { API_PREFIX, HttpError, MAX_IMPORT_BYTES } from './http.js'
import { publicBook, titleFromName } from './library.js'
import { exactRoute } from './routes.js'
import { cleanText } from './states.js'

// Linking a book that stays in the user folder instead of being copied into
// the shelf: folder picking, a short-lived selection token, and link import.

export function createLinkRoutes({ http, store, directoryPickerController, logger } = {}) {
  const { sendJson, readJsonBody } = http
  const { booksDir, readLibrary, updateLibrary } = store

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
    if (!directoryPickerController || typeof directoryPickerController.pick !== 'function') {
      throw new HttpError(503, 'the native folder picker is unavailable')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000)
    let selected
    try {
      selected = await directoryPickerController.pick(controller.signal)
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
      if (mode === 'copy') logger.info('bookshelf: symbolic link denied; stored a shelf copy')
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

  return [
    exactRoute(`${API_PREFIX}/links/pick`, {
      POST: (request, response) => pickLinkFolder(request, response),
    }),
    exactRoute(`${API_PREFIX}/links/import`, {
      POST: (request, response) => importLinkBook(request, response),
    }),
  ]
}
