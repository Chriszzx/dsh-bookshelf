/**
 * Apple Books import source.
 *
 * Apple Books keeps EPUB imports as unpacked directories on disk and stores
 * their location in its library database. This module reads only that local
 * library metadata (title/author/format/source) and, when the user explicitly
 * imports a book, repacks the source directory into an EPUB byte stream. It
 * never changes Apple Books and never reads book text while only listing.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { zipSync } from './assets/fflate.mjs'

const execFileAsync = promisify(execFile)
const SQLITE = '/usr/bin/sqlite3'
const MAX_FILES = 10_000
const MAX_SOURCE_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const COLUMNS = 'ZASSETID, ZTITLE, ZAUTHOR, ZREADINGPROGRESS, ZCONTENTTYPE, ZPATH, ZLASTOPENDATE'

export class AppleBooksImportError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'AppleBooksImportError'
    this.code = code
    this.status = status
  }
}

function sourceRoots() {
  const home = homedir()
  return [
    join(home, 'Library/Mobile Documents/iCloud~com~apple~iBooks/Documents'),
    join(home, 'Library/Containers/com.apple.iBooksX/Data/Documents'),
  ]
}

async function libraryDatabase() {
  const directory = join(homedir(), 'Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary')
  let entries
  try {
    entries = await readdir(directory)
  } catch {
    throw new AppleBooksImportError('APPLE_BOOKS_UNAVAILABLE', '无法找到 Apple Books 书库，请确认已安装并至少打开过 Apple Books。', 503)
  }
  const name = entries
    .filter((entry) => entry.startsWith('BKLibrary') && entry.endsWith('.sqlite'))
    .sort()[0]
  if (!name) {
    throw new AppleBooksImportError('APPLE_BOOKS_UNAVAILABLE', 'Apple Books 书库尚未初始化。', 503)
  }
  return join(directory, name)
}

async function query(sql) {
  const database = await libraryDatabase()
  let stdout
  try {
    const result = await execFileAsync(SQLITE, ['-readonly', '-json', '-cmd', '.timeout 1500', database, sql], {
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
    })
    stdout = result.stdout
  } catch (error) {
    const detail = String((error && error.stderr) || (error && error.message) || '')
    if (/Operation not permitted|authorization denied|unable to open database/i.test(detail)) {
      throw new AppleBooksImportError(
        'APPLE_BOOKS_PERMISSION',
        'DSH 没有读取 Apple Books 书库的权限，请在系统设置中为 DSH 开启“完全磁盘访问”。',
        403,
      )
    }
    throw new AppleBooksImportError('APPLE_BOOKS_UNAVAILABLE', '读取 Apple Books 书库失败。', 503)
  }
  const text = String(stdout || '').trim()
  if (text === '') return []
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value : []
  } catch {
    throw new AppleBooksImportError('APPLE_BOOKS_UNAVAILABLE', 'Apple Books 书库返回了无法识别的数据。', 503)
  }
}

function text(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed === '' ? fallback : trimmed.slice(0, 2048)
}

function formatOf(contentType) {
  if (Number(contentType) === 1) return 'epub'
  if (Number(contentType) === 3) return 'pdf'
  if (Number(contentType) === 5) return 'audiobook'
  return 'unknown'
}

function dateOf(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.round((seconds + 978_307_200) * 1000)
}

function bookFromRow(row) {
  const format = formatOf(row.ZCONTENTTYPE)
  const sourcePath = typeof row.ZPATH === 'string' && row.ZPATH.trim() !== '' ? row.ZPATH.trim() : ''
  const sourceAvailable = sourcePath !== '' && existsSync(sourcePath)
  const progress = Number(row.ZREADINGPROGRESS)
  return {
    assetID: text(row.ZASSETID),
    title: text(row.ZTITLE, '未命名书籍'),
    author: text(row.ZAUTHOR),
    format,
    progress: Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0,
    lastOpened: dateOf(row.ZLASTOPENDATE),
    sourceAvailable,
    importable: sourceAvailable && (format === 'epub' || format === 'pdf'),
    sourcePath,
  }
}

function publicBook(book) {
  const { sourcePath, ...visible } = book
  return visible
}

/**
 * List Apple Books metadata without reading any book content.
 * @param {{query?: string, offset?: number, limit?: number}} options
 */
export async function listAppleBooks(options = {}) {
  const queryText = text(options.query).toLocaleLowerCase()
  const offset = Math.max(0, Number.isInteger(options.offset) ? options.offset : 0)
  const limit = Math.min(100, Math.max(1, Number.isInteger(options.limit) ? options.limit : 50))
  const rows = await query(`SELECT ${COLUMNS} FROM ZBKLIBRARYASSET`)
  const books = rows
    .map(bookFromRow)
    .filter((book) => book.assetID !== '')
    .filter((book) => queryText === '' || `${book.title} ${book.author}`.toLocaleLowerCase().includes(queryText))
    .sort((left, right) => {
      const leftDate = left.lastOpened === null ? -1 : left.lastOpened
      const rightDate = right.lastOpened === null ? -1 : right.lastOpened
      if (leftDate !== rightDate) return rightDate - leftDate
      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    })
  const page = books.slice(offset, offset + limit)
  return {
    books: page.map(publicBook),
    total: books.length,
    offset,
    nextOffset: offset + page.length < books.length ? offset + page.length : null,
  }
}

async function assertApprovedSource(path) {
  let target
  try {
    target = await realpath(path)
  } catch {
    throw new AppleBooksImportError('APPLE_BOOKS_SOURCE_UNAVAILABLE', '这本书的本地源文件不可用。', 404)
  }
  for (const root of sourceRoots()) {
    let rootReal
    try {
      rootReal = await realpath(root)
    } catch {
      continue
    }
    if (target === rootReal || target.startsWith(`${rootReal}${sep}`)) return target
  }
  throw new AppleBooksImportError('APPLE_BOOKS_SOURCE_UNAVAILABLE', '这本书的源文件不在 Apple Books 书库目录中。', 403)
}

async function collectFiles(directory, base, output, state) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    throw new AppleBooksImportError('APPLE_BOOKS_SOURCE_UNAVAILABLE', '无法读取这本书的 EPUB 目录。', 404)
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('._') || entry.name === '.DS_Store') continue
    const full = join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await collectFiles(full, base, output, state)
      continue
    }
    if (!entry.isFile()) continue
    state.files += 1
    if (state.files > MAX_FILES) {
      throw new AppleBooksImportError('APPLE_BOOKS_TOO_LARGE', '这本书的文件数量过多，无法导入。', 413)
    }
    const info = await stat(full)
    state.bytes += info.size
    if (state.bytes > MAX_SOURCE_BYTES) {
      throw new AppleBooksImportError('APPLE_BOOKS_TOO_LARGE', '这本书超过 256 MB，无法导入。', 413)
    }
    output[relative(base, full).split(sep).join('/')] = new Uint8Array(await readFile(full))
  }
}

export async function packEpubDirectory(root) {
  const files = {}
  const state = { files: 0, bytes: 0 }
  await collectFiles(root, root, files, state)
  const hasContainer = Object.keys(files).some((name) => name.toLowerCase() === 'meta-inf/container.xml')
  if (!hasContainer) {
    throw new AppleBooksImportError('APPLE_BOOKS_SOURCE_UNAVAILABLE', '无法识别这本书的 EPUB 目录。', 415)
  }
  const archive = { mimetype: [new TextEncoder().encode('application/epub+zip'), { level: 0 }] }
  for (const [name, data] of Object.entries(files)) {
    if (name !== 'mimetype') archive[name] = data
  }
  let bytes
  try {
    bytes = zipSync(archive, { level: 6 })
  } catch {
    throw new AppleBooksImportError('APPLE_BOOKS_SOURCE_UNAVAILABLE', '重新打包 EPUB 失败。', 500)
  }
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw new AppleBooksImportError('APPLE_BOOKS_TOO_LARGE', '这本书超过 256 MB，无法导入。', 413)
  }
  return bytes
}

/**
 * Read one Apple Books source. No metadata or content is returned to a caller
 * until the user explicitly imports this asset.
 */
export async function readAppleBook(assetID) {
  if (typeof assetID !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(assetID)) {
    throw new AppleBooksImportError('APPLE_BOOKS_INVALID_ID', '无效的 Apple Books 书籍标识。', 400)
  }
  const rows = await query(`SELECT ${COLUMNS} FROM ZBKLIBRARYASSET WHERE ZASSETID = '${assetID}' LIMIT 1`)
  if (rows.length === 0) {
    throw new AppleBooksImportError('APPLE_BOOKS_NOT_FOUND', 'Apple Books 中没有这本书。', 404)
  }
  const book = bookFromRow(rows[0])
  if (book.format === 'audiobook' || book.format === 'unknown') {
    throw new AppleBooksImportError('APPLE_BOOKS_UNSUPPORTED', '暂时只能导入 EPUB 或 PDF。', 415)
  }
  if (book.sourcePath === '' || !book.sourceAvailable) {
    throw new AppleBooksImportError('APPLE_BOOKS_SOURCE_UNAVAILABLE', '这本书尚未下载到本机，无法导入。', 404)
  }
  const source = await assertApprovedSource(book.sourcePath)
  const info = await stat(source)
  if (book.format === 'epub') {
    if (info.isDirectory()) {
      const packed = await packEpubDirectory(source)
      return { title: book.title, author: book.author, format: 'epub', bytes: packed.length, link: { kind: 'directory', path: source } }
    }
    if (!info.isFile()) {
      throw new AppleBooksImportError('APPLE_BOOKS_SOURCE_UNAVAILABLE', '这本书的 EPUB 源不可用。', 404)
    }
    if (info.size > MAX_SOURCE_BYTES) {
      throw new AppleBooksImportError('APPLE_BOOKS_TOO_LARGE', '这本书超过 256 MB，无法导入。', 413)
    }
    return { title: book.title, author: book.author, format: 'epub', bytes: info.size, link: { kind: 'file', path: source } }
  }
  if (!info.isFile()) {
    throw new AppleBooksImportError('APPLE_BOOKS_SOURCE_UNAVAILABLE', '这本书的 PDF 源不可用。', 404)
  }
  if (info.size > MAX_SOURCE_BYTES) {
    throw new AppleBooksImportError('APPLE_BOOKS_TOO_LARGE', '这本书超过 256 MB，无法导入。', 413)
  }
  return { title: book.title, author: book.author, format: 'pdf', bytes: info.size, link: { kind: 'file', path: source } }
}
