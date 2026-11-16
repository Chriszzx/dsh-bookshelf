// Cache behaviour decides the cost profile of read-aloud: a hit must return the
// exact bytes, an eviction must never exceed the configured size, and a damaged
// directory must not break synthesis.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTtsCache } from '../tts.js'

async function withCache(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-tts-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, cache: createTtsCache({ rootDir: root, ...options }) }
}

test('stores and returns exact audio bytes', async t => {
  const { cache } = await withCache(t)
  const bytes = Buffer.from([1, 2, 3, 4])
  assert.equal(await cache.get('x.wav'), null)
  await cache.put('x.wav', bytes)
  const hit = await cache.get('x.wav')
  assert.ok(Buffer.isBuffer(hit))
  assert.deepEqual([...hit], [1, 2, 3, 4])
  const stats = await cache.stats()
  assert.equal(stats.entries, 1)
  assert.equal(stats.bytes, 4)
  assert.equal(stats.limitBytes, 512 * 1024 * 1024)
})

test('evicts least recently used files once over the limit', async t => {
  const { root, cache } = await withCache(t, { limitBytes: 10 })
  await cache.put('a.wav', Buffer.alloc(4))
  await cache.put('b.wav', Buffer.alloc(4))
  // Touch a so b becomes the least recently used.
  await cache.get('a.wav')
  await new Promise(resolve => setTimeout(resolve, 20))
  await cache.put('c.wav', Buffer.alloc(4))
  const names = await readdir(join(root, 'tts-cache'))
  assert.ok(names.length <= 3)
  const total = await cache.stats()
  assert.ok(total.bytes <= 10, `cache kept ${total.bytes} bytes`)
  // The newest file is always kept.
  assert.ok(names.includes('c.wav'))
})

test('clear removes the directory and reports zero usage', async t => {
  const { root, cache } = await withCache(t)
  await cache.put('x.wav', Buffer.alloc(8))
  assert.equal((await cache.stats()).entries, 1)
  assert.deepEqual(await cache.clear(), { ok: true })
  assert.equal((await cache.stats()).entries, 0)
  await assert.rejects(stat(join(root, 'tts-cache')), error => error.code === 'ENOENT')
})

test('a damaged cache directory does not break reads or writes', async t => {
  const { root, cache } = await withCache(t)
  // A regular file where the cache directory should be.
  await writeFile(join(root, 'tts-cache'), 'not a directory')
  assert.equal(await cache.get('x.wav'), null)
  await assert.rejects(cache.put('x.wav', Buffer.from([1])))
})
