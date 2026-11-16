import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { replaceFile } from '../assets/atomic-file.mjs'

import { HttpError } from './http.js'
import { sanitizeSettings } from './states.js'

// Durable bookshelf state: the library index, per-book reading state, reader
// defaults and the tag definitions. Every write goes through one serialized
// queue per file, so concurrent requests cannot interleave read-modify-write
// cycles, and every file is published by atomic replace.

export function createStore({ rootDir, tagStore, logger } = {}) {
  const booksDir = join(rootDir, 'books')
  const coversDir = join(rootDir, 'covers')
  const indexPath = join(rootDir, 'library.json')
  const statesPath = join(rootDir, 'state.json')
  const defaultsPath = join(rootDir, 'defaults.json')

  let pendingWrite = Promise.resolve()
  let pendingStateWrite = Promise.resolve()
  let pendingDefaultsWrite = Promise.resolve()

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

  // A damaged tags.json must not take the whole shelf down: it degrades to "no
  // custom tags" and leaves a warning. Mutations still report the real error.
  async function readTagDefinitions() {
    try {
      return await tagStore.list()
    } catch (error) {
      logger.warn(error instanceof Error ? error : new Error(String(error)))
      return []
    }
  }

  return {
    rootDir,
    booksDir,
    coversDir,
    indexPath,
    statesPath,
    defaultsPath,
    tagStore,
    readLibrary,
    updateLibrary,
    readStates,
    updateStates,
    readDefaults,
    updateDefaults,
    readTagDefinitions,
  }
}
