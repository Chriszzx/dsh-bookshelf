import { randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { replaceFile } from '../assets/atomic-file.mjs'

import { TTS_LIMITS } from './settings.js'

// Audio synthesized for a read-aloud selection is deliberately not cached: it is
// written to `tts-scratch/` and pruned by age instead of by the LRU size budget,
// so a one-off selection can neither evict a cached sentence nor inflate the
// cache statistics. Scratch names are generated in-process only.
const SCRATCH_TTL_MS = 10 * 60 * 1000
const AUDIO_NAME = /^[0-9a-f]{64}\.(?:wav|mp3)$/

// ---------------------------------------------------------------- audio cache

/**
 * Sentence-level audio cache. Files are named by a hash of everything that
 * affects the bytes, so a hit needs no metadata lookup; eviction is by mtime
 * once the directory exceeds the configured size.
 */
export function createTtsCache({ rootDir, limitBytes = TTS_LIMITS.maxCacheBytes, scratchTtlMs = SCRATCH_TTL_MS } = {}) {
  if (typeof rootDir !== 'string' || rootDir === '') throw new TypeError('a cache directory is required')
  const dir = join(rootDir, 'tts-cache')
  const scratchDir = join(rootDir, 'tts-scratch')
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

  // --------------------------------------------------------------- scratch audio
  // The uncached path: files live in their own directory, are never counted in
  // `stats()` and are evicted by age rather than by the LRU budget. A fixed TTL
  // keeps a long reading session from filling the disk with one-off sentences.

  function scratchName(ext) {
    if (ext !== '.wav' && ext !== '.mp3') throw new TypeError('scratch audio must be .wav or .mp3')
    return `${randomBytes(32).toString('hex')}${ext}`
  }

  function scratchPath(name) {
    if (typeof name !== 'string' || !AUDIO_NAME.test(name)) return null
    return join(scratchDir, name)
  }

  async function cleanScratch(now = Date.now()) {
    let entries
    try {
      entries = await fs.readdir(scratchDir, { withFileTypes: true })
    } catch {
      // A missing scratch directory is the normal state before the first
      // uncached synthesis; there is nothing to clean then.
      return 0
    }
    let removed = 0
    for (const entry of entries) {
      const path = scratchPath(entry.name)
      if (path === null || !entry.isFile()) continue
      try {
        const info = await fs.stat(path)
        if (now - info.mtimeMs <= scratchTtlMs) continue
        await fs.rm(path, { force: true })
        removed += 1
      } catch {
        // A concurrent cleanup already removed it, or it is unreadable.
      }
    }
    return removed
  }

  async function getScratch(name) {
    const path = scratchPath(name)
    if (path === null) return null
    try {
      const buffer = await fs.readFile(path)
      // Recency means "last played", matching the cached-audio recency rule: a
      // sentence being listened to right now is not pruned mid-playback.
      const now = new Date()
      await fs.utimes(path, now, now).catch(() => undefined)
      return buffer
    } catch {
      return null
    }
  }

  async function putScratch(name, buffer) {
    const path = scratchPath(name)
    if (path === null) throw new TypeError('invalid scratch audio name')
    await fs.mkdir(scratchDir, { recursive: true })
    await fs.writeFile(path, buffer)
  }

  return {
    dir,
    scratchDir,
    get,
    put,
    stats,
    clear,
    scratch: { dir: scratchDir, name: scratchName, get: getScratch, put: putScratch, clean: cleanScratch },
  }
}
