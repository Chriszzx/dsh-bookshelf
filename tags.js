import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { replaceFile } from './assets/atomic-file.mjs'

/**
 * Shelf classification: the three built-in reading statuses and the user's own
 * tags.
 *
 * User tag definitions live in their own `tags.json` instead of `library.json`.
 * A 0.4.0 Host rewrites `library.json` as `{ version, books }` and would drop a
 * top-level `tags` key; keeping the taxonomy in a separate file means a
 * downgrade, or any unrelated library write, cannot destroy it. Books reference
 * tags by id, so renaming a tag is a single small write.
 *
 * The built-in statuses are not stored as tags: they are mutually exclusive
 * states, so a book carries at most one of them and no user can create or
 * remove them. A book may override its derived status; that override lives on
 * the library record as `status`, while a missing `status` follows progress.
 */

export const READING_STATUSES = Object.freeze(['unread', 'reading', 'finished'])

export const TAG_LIMITS = Object.freeze({
  maxTags: 100,
  maxPerBook: 30,
  maxNameLength: 32,
})

// A book counts as read up to its last page from this share of the text on.
// The reader offers to mark the book finished when it is closed there, and a
// progress write below it again means the reader started re-reading.
export const FINISHED_PERCENT = 0.995

const TAG_ID_PATTERN = /^[0-9a-f-]{36}$/

// Built-in category labels in both shipped locales. A custom tag may not
// shadow one of them: the shelf would show two indistinguishable tabs.
const RESERVED_LABELS = ['未读', '正在阅读', '已读完', 'Unread', 'Reading', 'Finished']

export class TagStoreError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
    this.name = 'TagStoreError'
  }
}

// Comparison form: full-width and half-width spellings, letter case, spacing
// and punctuation must not create two tags that read the same.
export function normalizeTagName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

// Storage form: collapsed whitespace, no control characters, length capped by
// code points so an emoji counts once.
export function cleanTagName(value) {
  if (typeof value !== 'string') return null
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '' || [...cleaned].length > TAG_LIMITS.maxNameLength) return null
  return cleaned
}

export const RESERVED_TAG_NAMES = new Set(RESERVED_LABELS.map(normalizeTagName))

export function isTagId(value) {
  return typeof value === 'string' && TAG_ID_PATTERN.test(value)
}

function readableTagName(value) {
  if (typeof value !== 'string') return null
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? null : cleaned
}

// Effective status: an explicit override always wins. Progress alone never
// infers "finished": reaching the last page only prompts the reader, so a book
// that was read to the end but not confirmed stays in "reading".
export function readingStatusOf(record, progress) {
  if (record && READING_STATUSES.includes(record.status)) return { status: record.status, manual: true }
  return { status: deriveReadingStatus(progress), manual: false }
}

export function deriveReadingStatus(progress) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return 'unread'
  return 'reading'
}

function validateName(rawName) {
  const name = cleanTagName(rawName)
  if (name === null) {
    throw new TagStoreError(400, `a tag name must be 1-${TAG_LIMITS.maxNameLength} characters`)
  }
  const key = normalizeTagName(name)
  if (RESERVED_TAG_NAMES.has(key)) throw new TagStoreError(409, 'that name is reserved by a built-in reading status')
  return { name, key }
}

function requireName(rawName) {
  if (typeof rawName !== 'string') throw new TagStoreError(400, 'tag name must be a string')
  return validateName(rawName)
}

function requireTagId(id) {
  if (!isTagId(id)) throw new TagStoreError(400, 'invalid tag id')
  return id
}

export function createTagStore({ rootDir } = {}) {
  if (typeof rootDir !== 'string' || rootDir === '') throw new TypeError('a root directory is required')
  const filePath = join(rootDir, 'tags.json')
  let pendingWrite = Promise.resolve()

  async function read() {
    let raw
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return { version: 1, tags: [] }
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new TagStoreError(500, 'bookshelf tags.json is not valid JSON')
    }
    if (!parsed || !Array.isArray(parsed.tags)) {
      throw new TagStoreError(500, 'bookshelf tags.json has no tags array')
    }
    // Tolerate hand-edited files: skip entries that cannot be used instead of
    // failing the whole shelf, and keep the first spelling of a duplicate. A
    // stored name is displayed as written even if it predates the length limit.
    const tags = []
    const seenIds = new Set()
    const seenNames = new Set()
    for (const item of parsed.tags) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const name = readableTagName(item.name)
      if (!isTagId(item.id) || name === null) continue
      const key = normalizeTagName(name)
      if (seenIds.has(item.id) || seenNames.has(key)) continue
      seenIds.add(item.id)
      seenNames.add(key)
      tags.push({
        id: item.id,
        name,
        createdAt: Number.isFinite(item.createdAt) ? Math.trunc(item.createdAt) : 0,
      })
    }
    return { version: 1, tags }
  }

  // Every mutation re-reads inside the queued run so concurrent requests never
  // build on a stale snapshot.
  function update(change) {
    const run = async () => {
      const current = await read()
      const next = change(current.tags.slice())
      if (!Array.isArray(next)) throw new TypeError('tag change must return an array')
      await fs.mkdir(rootDir, { recursive: true })
      const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
      await fs.writeFile(temporary, JSON.stringify({ version: 1, tags: next }, null, 2))
      await replaceFile(temporary, filePath)
      return next
    }
    const pending = pendingWrite.then(run, run)
    pendingWrite = pending.catch(() => undefined)
    return pending
  }

  async function list() {
    return (await read()).tags
  }

  async function create(rawName) {
    const { name, key } = requireName(rawName)
    const tags = await update((current) => {
      if (current.length >= TAG_LIMITS.maxTags) {
        throw new TagStoreError(409, `at most ${TAG_LIMITS.maxTags} tags are supported`)
      }
      if (current.some((tag) => normalizeTagName(tag.name) === key)) {
        throw new TagStoreError(409, 'a tag with that name already exists')
      }
      return [...current, { id: randomUUID(), name, createdAt: Date.now() }]
    })
    return tags[tags.length - 1]
  }

  async function rename(id, rawName) {
    requireTagId(id)
    const { name, key } = requireName(rawName)
    let renamed
    await update((current) => {
      const index = current.findIndex((tag) => tag.id === id)
      if (index === -1) throw new TagStoreError(404, 'tag not found')
      if (current.some((tag) => tag.id !== id && normalizeTagName(tag.name) === key)) {
        throw new TagStoreError(409, 'a tag with that name already exists')
      }
      renamed = { ...current[index], name }
      return current.map((tag) => (tag.id === id ? renamed : tag))
    })
    return renamed
  }

  async function remove(id) {
    requireTagId(id)
    let removed
    await update((current) => {
      const index = current.findIndex((tag) => tag.id === id)
      if (index === -1) throw new TagStoreError(404, 'tag not found')
      removed = current[index]
      return current.filter((tag) => tag.id !== id)
    })
    return removed
  }

  return { path: filePath, list, create, rename, remove }
}
