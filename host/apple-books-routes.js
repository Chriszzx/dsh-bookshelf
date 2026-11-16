import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { listAppleBooks, readAppleBook } from '../apple-books.js'

import { API_PREFIX, HttpError, MAX_IMPORT_BYTES } from './http.js'
import { publicBook, sameShelfBook } from './library.js'
import { exactRoute } from './routes.js'
import { cleanText } from './states.js'

// Apple Books import (macOS only): list the local store, symlink a chosen
// book into the shelf, and migrate records imported before links existed.

export function createAppleBooksRoutes({ http, store, logger } = {}) {
  const { sendJson } = http
  const { booksDir, readLibrary, updateLibrary } = store

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
        logger.warn(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (migrated.size > 0) {
      await updateLibrary((books) =>
        books.map((book) => {
          const patch = migrated.get(book.id)
          return patch === undefined ? book : { ...book, ...patch }
        }),
      )
      logger.info('bookshelf: migrated existing Apple Books imports to soft links')
    }
  }

  const routes = [
    exactRoute([`${API_PREFIX}/apple-books`, `${API_PREFIX}/apple-books/`], {
      GET: (request, response, context) => listAppleBooksRoute(request, response, context.url),
    }),
    exactRoute(`${API_PREFIX}/apple-books/import`, {
      POST: (request, response, context) => importAppleBook(request, response, context.url),
    }),
  ]
  return { routes, migrateAppleLinks }
}
