// Real macOS system speech: no network, no key. Skipped elsewhere because the
// Host provider only exists on darwin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTtsService } from '../tts.js'

test('macOS say produces a playable WAV and caches it', { skip: process.platform !== 'darwin' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-tts-native-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createTtsService({ rootDir: root, platform: 'darwin' })
  await service.load()

  const voices = await service.voices('macos')
  assert.ok(Array.isArray(voices) && voices.length > 0, 'the system must expose at least one speech voice')
  const mandarin = voices.find((voice) => String(voice.lang).startsWith('zh'))
  const voice = (mandarin || voices[0]).id

  const first = await service.synthesize({ provider: 'macos', voice, text: '这是朗读测试。', speed: 1 })
  assert.equal(first.mime, 'audio/wav')
  assert.equal(first.cached, false)
  assert.equal(first.audio.subarray(0, 4).toString(), 'RIFF')
  assert.ok(first.audio.length > 1000, `expected real audio, got ${first.audio.length} bytes`)

  const second = await service.synthesize({ provider: 'macos', voice, text: '这是朗读测试。', speed: 1 })
  assert.equal(second.cached, true)
  assert.deepEqual([...second.audio], [...first.audio])

  // A faster reading is a different cache entry and a smaller or equal file.
  const faster = await service.synthesize({ provider: 'macos', voice, text: '这是朗读测试。', speed: 1.5 })
  assert.equal(faster.cached, false)
  assert.equal(faster.audio.subarray(0, 4).toString(), 'RIFF')
  const stats = await service.cache.stats()
  assert.ok(stats.entries >= 2)
  assert.ok(stats.bytes > 0)
})
