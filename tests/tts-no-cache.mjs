// Selection read-aloud must never enter the sentence cache: its audio goes to a
// scratch directory, the LRU statistics stay untouched, and stale scratch files
// are pruned by age. The default (cached) path is verified alongside, so a
// regression in either direction fails here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { createTtsService } from '../tts.js'

const TEN_MINUTES = 10 * 60 * 1000
const SCRATCH_NAME = /^[0-9a-f]{64}\.wav$/

function makeRun() {
  return async (command, args) => {
    if (args[0] === '-v' && args[1] === '?') {
      return { stdout: 'Tingting (中文（中国大陆）)     zh_CN    # 你好！我叫婷婷。\n' }
    }
    const out = args[args.indexOf('-o') + 1]
    if (typeof out === 'string' && out.endsWith('.wav')) {
      await writeFile(out, Buffer.from('RIFFmockwav'))
    }
    return { stdout: '' }
  }
}

async function makeService(t) {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-tts-no-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createTtsService({
    rootDir: root,
    platform: 'darwin',
    run: makeRun(),
    logger: { warn() {} },
  })
  await service.load()
  return { root, service }
}

async function listDir(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

test('the default path still caches sentences', async t => {
  const { root, service } = await makeService(t)

  const first = await service.synthesize({ provider: 'macos', text: '默认缓存。', speed: 1 })
  assert.equal(first.cached, false)
  assert.match(first.name, /^[0-9a-f]{64}\.wav$/)
  assert.equal(first.mime, 'audio/wav')

  const second = await service.synthesize({ provider: 'macos', text: '默认缓存。', speed: 1 })
  assert.equal(second.cached, true)
  assert.equal(second.name, first.name)

  // `cache: true` and a missing field are exactly the default path.
  const explicit = await service.synthesize({ provider: 'macos', text: '默认缓存。', speed: 1, cache: true })
  assert.equal(explicit.cached, true)
  // Only a literal `false` opts out; an older client sending anything else keeps
  // the cached behaviour.
  const loose = await service.synthesize({ provider: 'macos', text: '默认缓存。', speed: 1, cache: 'false' })
  assert.equal(loose.cached, true)

  const stats = await service.cache.stats()
  assert.equal(stats.entries, 1)
  assert.ok(stats.bytes > 0)
  assert.deepEqual(await listDir(join(root, 'tts-scratch')), [])

  const audio = await service.readAudio(second.name)
  assert.equal(audio.mime, 'audio/wav')
  assert.equal(audio.audio.toString(), 'RIFFmockwav')
})

test('cache:false writes scratch audio and never touches the LRU cache', async t => {
  const { root, service } = await makeService(t)

  const result = await service.synthesize({ provider: 'macos', text: '选区朗读。', speed: 1, cache: false })
  assert.equal(result.cached, false)
  assert.match(result.name, SCRATCH_NAME)
  assert.equal(result.mime, 'audio/wav')

  // No disk-cache entry and no LRU accounting at all.
  assert.deepEqual(await listDir(join(root, 'tts-cache')), [])
  assert.deepEqual(await service.cache.stats(), { entries: 0, bytes: 0, limitBytes: 512 * 1024 * 1024 })

  // The audio is written to the scratch directory and is served by the reader
  // that backs /tts/audio/...
  assert.deepEqual(await listDir(join(root, 'tts-scratch')), [result.name])
  const audio = await service.readAudio(result.name)
  assert.equal(audio.mime, 'audio/wav')
  assert.equal(audio.audio.toString(), 'RIFFmockwav')

  // Playing scratch audio does not count as a cache hit either.
  assert.deepEqual(await service.cache.stats(), { entries: 0, bytes: 0, limitBytes: 512 * 1024 * 1024 })

  // The same sentence again is never a cache hit: every request gets its own
  // scratch name.
  const again = await service.synthesize({ provider: 'macos', text: '选区朗读。', speed: 1, cache: false })
  assert.equal(again.cached, false)
  assert.notEqual(again.name, result.name)
  assert.equal((await listDir(join(root, 'tts-cache'))).length, 0)
  assert.equal((await service.cache.stats()).entries, 0)

  // Unknown or unsafe names are rejected before touching the filesystem.
  assert.equal(await service.readAudio('0'.repeat(64) + '.wav'), null)
  assert.equal(await service.readAudio('../../etc/passwd'), null)
  assert.equal(await service.readAudio('not-a-hash.wav'), null)
})

test('stale scratch files are pruned at startup and on every uncached synthesis', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-tts-no-cache-tll-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const scratchDir = join(root, 'tts-scratch')
  await mkdir(scratchDir, { recursive: true })
  const stale = join(scratchDir, 'a'.repeat(64) + '.wav')
  const fresh = join(scratchDir, 'b'.repeat(64) + '.wav')
  const old = new Date(Date.now() - TEN_MINUTES - 60 * 1000)
  await writeFile(stale, 'old-audio')
  await writeFile(fresh, 'new-audio')
  await utimes(stale, old, old)

  // Service startup prunes once.
  const service = createTtsService({
    rootDir: root,
    platform: 'darwin',
    run: makeRun(),
    logger: { warn() {} },
  })
  await service.load()
  assert.equal(existsSync(stale), false)
  assert.equal(existsSync(fresh), true)

  // Every uncached synthesis prunes again.
  const late = join(scratchDir, 'c'.repeat(64) + '.wav')
  await writeFile(late, 'late-audio')
  await utimes(late, old, old)
  const result = await service.synthesize({ provider: 'macos', text: '再读一句。', speed: 1, cache: false })
  assert.equal(existsSync(late), false)
  assert.equal(existsSync(join(scratchDir, result.name)), true)
  assert.equal(existsSync(fresh), true)
})

test('POST /tts/synthesize forwards cache:false to a playable scratch URL', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-tts-no-cache-api-'))
  const owned = await realpath(temporary)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(temporary, 'home')
  let route
  apply(
    {
      effect: fn => fn(),
      webServer: { register(value) { route = value; return () => {} } },
      logger: { info() {}, warn() {}, error() {} },
    },
    { tts: { platform: 'darwin', run: makeRun() } },
  )
  const server = createServer((request, response) => route.handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    assert.equal(await realpath(temporary), owned)
    await rm(owned, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  const base = `http://127.0.0.1:${server.address().port}`
  const origin = `${base}/bookshelf/api`
  const synthesize = body => fetch(origin + '/tts/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const stats = async () => (await fetch(origin + '/tts/cache')).json()

  const response = await synthesize({ provider: 'macos', text: '选区句子。', cache: false })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.cached, false)
  assert.match(payload.url, /^\/bookshelf\/api\/tts\/audio\/[0-9a-f]{64}\.wav$/)

  // The same-origin URL serves the scratch bytes.
  const audio = await fetch(base + payload.url)
  assert.equal(audio.status, 200)
  assert.equal(audio.headers.get('content-type'), 'audio/wav')
  assert.equal(Buffer.from(await audio.arrayBuffer()).toString(), 'RIFFmockwav')

  // Uncached audio produces no LRU entries or statistics.
  assert.deepEqual(await stats(), { entries: 0, bytes: 0, limitBytes: 512 * 1024 * 1024 })

  // Default requests still cache and still hit.
  const cachedFirst = await (await synthesize({ provider: 'macos', text: '默认句子。' })).json()
  const cachedSecond = await (await synthesize({ provider: 'macos', text: '默认句子。' })).json()
  assert.equal(cachedFirst.cached, false)
  assert.equal(cachedSecond.cached, true)
  assert.equal((await stats()).entries, 1)

  // Repeating the selection command stays uncached and gets a new URL.
  const repeat = await (await synthesize({ provider: 'macos', text: '选区句子。', cache: false })).json()
  assert.equal(repeat.cached, false)
  assert.notEqual(repeat.url, payload.url)
  assert.equal((await stats()).entries, 1)
})
