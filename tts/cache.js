import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { replaceFile } from '../assets/atomic-file.mjs'

import { TTS_LIMITS } from './settings.js'

// ---------------------------------------------------------------- audio cache

/**
 * Sentence-level audio cache. Files are named by a hash of everything that
 * affects the bytes, so a hit needs no metadata lookup; eviction is by mtime
 * once the directory exceeds the configured size.
 */
export function createTtsCache({ rootDir, limitBytes = TTS_LIMITS.maxCacheBytes } = {}) {
  if (typeof rootDir !== 'string' || rootDir === '') throw new TypeError('a cache directory is required')
  const dir = join(rootDir, 'tts-cache')
  let totalBytes = 0
  let scanned = false
  let pendingScan = null

  async function scan() {
    if (scanned) return
    totalBytes = 0
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        try {
          const info = await fs.stat(join(dir, entry.name))
          totalBytes += info.size
        } catch {
          // A vanished file is fine; the next put re-checks the total.
        }
      }
      scanned = true
    } catch (error) {
      // A missing directory is the normal first run; a file squatting on the
      // path means caching is unavailable, which must not break playback.
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EACCES')) {
        scanned = true
        return
      }
      throw error
    }
  }

  async function ensure() {
    if (scanned) return
    if (pendingScan === null) pendingScan = scan().finally(() => { pendingScan = null })
    await pendingScan
  }

  async function evict() {
    if (totalBytes <= limitBytes) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const files = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const path = join(dir, entry.name)
      try {
        const info = await fs.stat(path)
        files.push({ path, size: info.size, at: info.mtimeMs })
      } catch {
        // Ignore races with concurrent eviction.
      }
    }
    files.sort((left, right) => left.at - right.at)
    for (const file of files) {
      if (totalBytes <= limitBytes) break
      try {
        await fs.rm(file.path, { force: true })
        totalBytes -= file.size
      } catch {
        // Leave it; a later put tries again.
      }
    }
  }

  async function get(name) {
    await ensure()
    try {
      const buffer = await fs.readFile(join(dir, name))
      // Refresh recency so the LRU keeps what is being read now.
      const now = new Date()
      await fs.utimes(join(dir, name), now, now).catch(() => undefined)
      return buffer
    } catch {
      return null
    }
  }

  async function put(name, buffer) {
    await ensure()
    await fs.mkdir(dir, { recursive: true })
    const target = join(dir, name)
    let previous = 0
    try {
      previous = (await fs.stat(target)).size
    } catch {
      previous = 0
    }
    const temporary = `${target}.${randomUUID()}.part`
    await fs.writeFile(temporary, buffer)
    await replaceFile(temporary, target)
    totalBytes += buffer.length - previous
    await evict()
  }

  async function stats() {
    await ensure()
    let entries = 0
    try {
      const list = await fs.readdir(dir)
      entries = list.length
    } catch {
      entries = 0
    }
    return { entries, bytes: Math.max(0, totalBytes), limitBytes }
  }

  async function clear() {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    totalBytes = 0
    scanned = true
    return { ok: true }
  }

  return { dir, get, put, stats, clear }
}
