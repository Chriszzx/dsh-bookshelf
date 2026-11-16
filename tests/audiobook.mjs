// Whole-book audiobook estimation and rendering. The TTS service is injected,
// so no test talks to DeepSeek or spends money.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  billedCharacters,
  estimateAudiobook,
  mergeWavBuffers,
  createAudiobookService,
} from '../audiobook.js'
import { splitSentences } from '../assets/tts-sentences.mjs'

function makeWav(samples, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
  const dataBytes = samples * channels * (bitsPerSample / 8)
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28)
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE((index % 100) - 50, 44 + index * 2)
  return buffer
}

async function withService(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-audiobook-'))
  const owned = await realpath(temporary)
  try {
    await run(temporary)
  } finally {
    assert.equal(await realpath(temporary), owned)
    await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

function stubTts({ delayMs = 0, failOn = -1, samples = 4 } = {}) {
  const calls = []
  return {
    calls,
    async synthesize({ text, voice, speed }) {
      calls.push({ text, voice, speed })
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (calls.length === failOn) throw new Error('provider exploded')
      return { audio: makeWav(samples + calls.length), mime: 'audio/wav', ext: '.wav' }
    },
  }
}

test('billing counts a Chinese character as two characters', () => {
  assert.equal(billedCharacters('你好'), 4)
  assert.equal(billedCharacters('Hi 你好!'), 8)
  assert.equal(billedCharacters(''), 0)
})

test('estimate reports characters, sentences, duration, size and cost', () => {
  const text = '第一句话。\n第二句话。\nThird sentence.'
  const estimate = estimateAudiobook({ text, speed: 1 })
  assert.equal(estimate.sentences, 3)
  assert.ok(estimate.characters > 0 && estimate.characters <= estimate.billedCharacters)
  assert.equal(
    estimate.billedCharacters,
    splitSentences(text).reduce((sum, sentence) => sum + billedCharacters(sentence), 0),
  )
  assert.ok(estimate.durationSeconds > 0)
  assert.ok(estimate.bytes > 44)
  assert.equal(estimate.currency, 'CNY')
  assert.equal(estimate.pricePer10k, 1.5)
  assert.equal(estimate.listCost, Math.round((estimate.billedCharacters / 10_000) * 3 * 10_000) / 10_000)
  assert.equal(estimate.cost, Math.round((estimate.billedCharacters / 10_000) * 1.5 * 10_000) / 10_000)
  const faster = estimateAudiobook({ text, speed: 2 })
  assert.ok(faster.durationSeconds < estimate.durationSeconds)
  assert.ok(faster.bytes < estimate.bytes)
  assert.equal(faster.cost, estimate.cost)
})

test('estimate rejects empty text', () => {
  assert.throws(() => estimateAudiobook({ text: '   \n  ' }), /没有可朗读的文字/)
})

test('mergeWavBuffers writes one canonical PCM WAV', () => {
  const merged = mergeWavBuffers([makeWav(3), makeWav(5)])
  assert.equal(merged.toString('ascii', 0, 4), 'RIFF')
  assert.equal(merged.toString('ascii', 8, 12), 'WAVE')
  assert.equal(merged.readUInt16LE(20), 1)
  assert.equal(merged.readUInt32LE(24), 24000)
  assert.equal(merged.readUInt16LE(22), 1)
  assert.equal(merged.readUInt16LE(34), 16)
  assert.equal(merged.readUInt32LE(40), (3 + 5) * 2)
  assert.equal(merged.length, 44 + (3 + 5) * 2)
})

test('mergeWavBuffers rejects a format change', () => {
  assert.throws(() => mergeWavBuffers([makeWav(2), makeWav(2, { sampleRate: 16000 })]), /格式不一致/)
})

test('service plans, renders and serves one WAV without a real provider', async () => {
  await withService(async (root) => {
    const tts = stubTts({ samples: 3 })
    const service = createAudiobookService({ rootDir: root, tts, logger: { warn() {} } })
    const planned = await service.plan('book-1', { text: '第一句。第二句。', voice: 'tide', speed: 1 })
    assert.equal(planned.voice, 'tide')
    assert.equal(planned.sentences, 2)
    assert.equal(await service.state('book-1').then((state) => state.status), 'idle')

    const started = await service.start('book-1', { voice: 'tide', speed: 1 })
    assert.equal(started.status, 'running')
    let state
    for (let attempt = 0; attempt < 100; attempt += 1) {
      state = await service.state('book-1')
      if (state.status === 'done' || state.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(state.status, 'done', state.error)
    assert.equal(state.done, 2)
    assert.equal(tts.calls.length, 2)
    assert.deepEqual(tts.calls.map((call) => call.voice), ['tide', 'tide'])

    const file = await service.file('book-1')
    assert.ok(file && file.bytes > 44)
    const audio = await readFile(file.path)
    assert.equal(audio.toString('ascii', 0, 4), 'RIFF')
    assert.equal(audio.readUInt32LE(40), (4 + 5) * 2)
    assert.equal((await stat(join(root, 'audiobooks', 'book-1', 'source.txt'))).size > 0, true)

    await service.remove('book-1')
    assert.equal(await service.file('book-1'), null)
  })
})

test('service cancels a running render and keeps no audio file', async () => {
  await withService(async (root) => {
    const service = createAudiobookService({ rootDir: root, tts: stubTts({ delayMs: 40 }), logger: { warn() {} } })
    await service.plan('book-2', { text: '一。二。三。四。', voice: 'stella', speed: 1 })
    await service.start('book-2', { voice: 'stella', speed: 1 })
    await service.cancel('book-2')
    let state
    for (let attempt = 0; attempt < 100; attempt += 1) {
      state = await service.state('book-2')
      if (state.status === 'cancelled' || state.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(state.status, 'cancelled')
    assert.equal(await service.file('book-2'), null)
  })
})

test('service reports provider failures without leaving a partial WAV', async () => {
  await withService(async (root) => {
    const service = createAudiobookService({ rootDir: root, tts: stubTts({ failOn: 2 }), logger: { warn() {} } })
    await service.plan('book-3', { text: '一。二。三。', voice: 'stella', speed: 1 })
    await service.start('book-3', { voice: 'stella', speed: 1 })
    let state
    for (let attempt = 0; attempt < 100; attempt += 1) {
      state = await service.state('book-3')
      if (state.status === 'failed' || state.status === 'done') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(state.status, 'failed')
    assert.match(state.error, /provider exploded/)
    assert.equal(await service.file('book-3'), null)
  })
})
