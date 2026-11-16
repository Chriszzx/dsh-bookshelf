import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { splitSentences, normalizeSpeakText } from './assets/tts-sentences.mjs'
import { replaceFile } from './assets/atomic-file.mjs'
import { DEEPSEEK_VOICES } from './tts.js'

/**
 * Whole-book audiobook rendering on the Host.
 *
 * The browser extracts the book text once and posts it here; the Host stores it
 * next to the book's audio, estimates billing from the official DeepSeek rules
 * and synthesises sentence by sentence into a single WAV. Jobs run in-process
 * because the shelf is a local single-user app: a Map plus a small state file
 * is enough, and a crash simply leaves an idle plan that can be started again.
 */

export const AUDIOBOOK_PROVIDER = 'deepseek'

export const AUDIOBOOK_LIMITS = Object.freeze({
  maxTextChars: 2_000_000,
  maxSentences: 60_000,
})

// Official DeepSeek TTS pricing: per 10,000 billed characters, list price USD
// $0.45 / CNY ¥3, limited-time 50% off. A Chinese character bills as two
// characters; everything else, including spaces and punctuation, bills as one.
// Output is 24 kHz, 16-bit, mono PCM WAV.
export const DEEPSEEK_TTS_PRICING = Object.freeze({
  currency: 'CNY',
  listPer10k: 3,
  promoPer10k: 1.5,
  promo: true,
  sampleRate: 24000,
  channels: 1,
  bitsPerSample: 16,
})

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
// Speaking-speed heuristics used only for the pre-render estimate. The real
// duration is reported from the produced WAV once rendering finishes.
const CJK_CHARS_PER_SECOND = 4.5
const LATIN_CHARS_PER_SECOND = 15

export class AudiobookError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
    this.name = 'AudiobookError'
  }
}

export function isBilledCjk(character) {
  return CJK.test(character)
}

export function billedCharacters(text) {
  let total = 0
  for (const character of String(text || '')) total += CJK.test(character) ? 2 : 1
  return total
}

export function estimateAudiobook({ text, speed = 1 } = {}) {
  const normalized = normalizeSpeakText(String(text || ''))
  const sentences = splitSentences(normalized)
  if (sentences.length === 0) throw new AudiobookError(400, '没有可朗读的文字')
  if (sentences.length > AUDIOBOOK_LIMITS.maxSentences) {
    throw new AudiobookError(413, `整书语音最多支持 ${AUDIOBOOK_LIMITS.maxSentences} 句`)
  }
  const rate = clampSpeed(speed)
  let characters = 0
  let billed = 0
  let seconds = 0
  for (const sentence of sentences) {
    let cjk = 0
    let other = 0
    for (const character of sentence) {
      if (CJK.test(character)) {
        cjk += 1
        billed += 2
      } else {
        other += 1
        billed += 1
      }
    }
    characters += cjk + other
    seconds += cjk / CJK_CHARS_PER_SECOND + other / LATIN_CHARS_PER_SECOND
  }
  seconds = Math.max(0.5, seconds / rate)
  const bytes = Math.round(44 + seconds * DEEPSEEK_TTS_PRICING.sampleRate * DEEPSEEK_TTS_PRICING.channels * (DEEPSEEK_TTS_PRICING.bitsPerSample / 8))
  const pricePer10k = DEEPSEEK_TTS_PRICING.promo ? DEEPSEEK_TTS_PRICING.promoPer10k : DEEPSEEK_TTS_PRICING.listPer10k
  return {
    provider: AUDIOBOOK_PROVIDER,
    characters,
    billedCharacters: billed,
    sentences: sentences.length,
    durationSeconds: Math.round(seconds * 10) / 10,
    bytes,
    cost: roundMoney((billed / 10_000) * pricePer10k),
    listCost: roundMoney((billed / 10_000) * DEEPSEEK_TTS_PRICING.listPer10k),
    currency: DEEPSEEK_TTS_PRICING.currency,
    pricePer10k,
    listPricePer10k: DEEPSEEK_TTS_PRICING.listPer10k,
    promo: DEEPSEEK_TTS_PRICING.promo,
    sampleRate: DEEPSEEK_TTS_PRICING.sampleRate,
    speed: rate,
  }
}

function roundMoney(value) {
  // Four decimals keeps a one-sentence estimate non-zero while staying readable.
  return Math.round(value * 10_000) / 10_000
}

export function clampSpeed(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(2, Math.max(0.5, Math.round(number * 100) / 100))
}

export function sanitizeVoice(value) {
  return DEEPSEEK_VOICES.some((voice) => voice.id === value) ? value : DEEPSEEK_VOICES[0].id
}

// --------------------------------------------------------------------- WAV I/O

function readWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) throw new AudiobookError(502, '语音服务返回的 WAV 不完整')
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new AudiobookError(502, '语音服务没有返回 WAV 数据')
  }
  let offset = 12
  let format = null
  let pcm = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = Math.min(buffer.length, start + size)
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      }
    } else if (id === 'data') {
      pcm = buffer.subarray(start, end)
    }
    offset = start + size + (size % 2)
  }
  if (format === null || pcm === null) throw new AudiobookError(502, '语音服务返回的 WAV 缺少格式或数据段')
  if (format.audioFormat !== 1) throw new AudiobookError(502, '整书语音只支持 PCM WAV')
  return { format, pcm }
}

function wavHeader(format, dataBytes) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(format.channels, 22)
  header.writeUInt32LE(format.sampleRate, 24)
  header.writeUInt32LE(format.sampleRate * format.channels * (format.bitsPerSample / 8), 28)
  header.writeUInt16LE(format.channels * (format.bitsPerSample / 8), 32)
  header.writeUInt16LE(format.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

export function mergeWavBuffers(buffers) {
  const parts = []
  let format = null
  let dataBytes = 0
  for (const buffer of buffers) {
    const parsed = readWav(buffer)
    if (format === null) format = parsed.format
    else if (parsed.format.channels !== format.channels || parsed.format.sampleRate !== format.sampleRate || parsed.format.bitsPerSample !== format.bitsPerSample) {
      throw new AudiobookError(502, '语音片段格式不一致，无法合并')
    }
    parts.push(parsed.pcm)
    dataBytes += parsed.pcm.length
  }
  if (format === null) throw new AudiobookError(502, '没有可合并的语音')
  return Buffer.concat([wavHeader(format, dataBytes), ...parts])
}

// ---------------------------------------------------------------------- service

export function createAudiobookService({ rootDir, tts, logger = console } = {}) {
  if (typeof rootDir !== 'string' || rootDir === '') throw new TypeError('a root directory is required')
  if (!tts || typeof tts.synthesize !== 'function') throw new TypeError('a tts service is required')
  const root = join(rootDir, 'audiobooks')
  const jobs = new Map()

  const bookDir = (id) => join(root, id)
  const sourcePath = (id) => join(bookDir(id), 'source.txt')
  const planPath = (id) => join(bookDir(id), 'plan.json')
  const audioPath = (id) => join(bookDir(id), 'book.wav')
  const metaPath = (id) => join(bookDir(id), 'book.json')

  async function readJson(path) {
    try {
      return JSON.parse(await fs.readFile(path, 'utf8'))
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async function writeJson(path, value) {
    await fs.mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await fs.writeFile(temporary, JSON.stringify(value, null, 2))
    await replaceFile(temporary, path)
  }

  async function readSource(id) {
    try {
      return await fs.readFile(sourcePath(id), 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async function plan(id, { text, voice, speed } = {}) {
    let normalized = typeof text === 'string' ? normalizeSpeakText(text) : ''
    if (normalized === '') normalized = (await readSource(id)) || ''
    if (normalized === '') throw new AudiobookError(400, '缺少要朗读的书籍文本')
    if (normalized.length > AUDIOBOOK_LIMITS.maxTextChars) {
      throw new AudiobookError(413, `整书语音最多支持 ${AUDIOBOOK_LIMITS.maxTextChars} 个字符`)
    }
    const estimate = estimateAudiobook({ text: normalized, speed })
    const value = {
      ...estimate,
      voice: sanitizeVoice(voice),
      updatedAt: new Date().toISOString(),
    }
    await fs.mkdir(bookDir(id), { recursive: true })
    const sourceTemp = `${sourcePath(id)}.${process.pid}.tmp`
    await fs.writeFile(sourceTemp, normalized)
    await replaceFile(sourceTemp, sourcePath(id))
    const planTemp = `${planPath(id)}.${process.pid}.tmp`
    await fs.writeFile(planTemp, JSON.stringify(value, null, 2))
    await replaceFile(planTemp, planPath(id))
    return value
  }

  async function jobState(id) {
    const job = jobs.get(id)
    const planValue = await readJson(planPath(id))
    let audio = null
    try {
      const info = await fs.stat(audioPath(id))
      const meta = await readJson(metaPath(id))
      audio = { bytes: info.size, name: `${id}.wav`, updatedAt: (meta && meta.finishedAt) || info.mtime.toISOString(), seconds: meta && Number.isFinite(meta.seconds) ? meta.seconds : null }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
    if (job) {
      return {
        status: job.status,
        done: job.done,
        total: job.total,
        characters: job.characters,
        bytes: job.bytes,
        error: job.error || '',
        voice: job.voice,
        speed: job.speed,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt || null,
        plan: planValue,
        audio,
      }
    }
    return {
      status: audio === null ? 'idle' : 'done',
      done: audio === null ? 0 : (planValue ? planValue.sentences : 0),
      total: planValue ? planValue.sentences : 0,
      characters: planValue ? planValue.characters : 0,
      bytes: audio ? audio.bytes : 0,
      error: '',
      voice: planValue ? planValue.voice : '',
      speed: planValue ? planValue.speed : 1,
      startedAt: null,
      finishedAt: audio ? audio.updatedAt : null,
      plan: planValue,
      audio,
    }
  }

  async function start(id, { voice, speed } = {}) {
    const running = jobs.get(id)
    if (running && (running.status === 'running' || running.status === 'cancelling')) {
      throw new AudiobookError(409, '这本书的整书语音正在生成')
    }
    const source = await readSource(id)
    if (source === null) throw new AudiobookError(409, '请先估算这本书再生成')
    const sentences = splitSentences(source)
    if (sentences.length === 0) throw new AudiobookError(400, '没有可朗读的文字')
    if (sentences.length > AUDIOBOOK_LIMITS.maxSentences) throw new AudiobookError(413, '整书语音句子过多')
    const rate = clampSpeed(speed)
    const chosenVoice = sanitizeVoice(voice)
    const job = {
      status: 'running',
      done: 0,
      total: sentences.length,
      characters: 0,
      bytes: 44,
      error: '',
      voice: chosenVoice,
      speed: rate,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      cancelled: false,
    }
    jobs.set(id, job)
    void render(id, sentences, job).catch((error) => {
      logger.warn?.(`bookshelf: audiobook render failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return jobState(id)
  }

  async function render(id, sentences, job) {
    const temporary = join(bookDir(id), 'book.tmp.wav')
    let handle = null
    let format = null
    let dataBytes = 0
    try {
      await fs.mkdir(bookDir(id), { recursive: true })
      handle = await fs.open(temporary, 'w')
      await handle.write(Buffer.alloc(44))
      for (let index = 0; index < sentences.length; index += 1) {
        if (job.cancelled) throw new AudiobookError(499, '已取消')
        const result = await tts.synthesize({
          provider: AUDIOBOOK_PROVIDER,
          voice: job.voice,
          speed: job.speed,
          text: sentences[index],
        })
        const parsed = readWav(result.audio)
        if (format === null) format = parsed.format
        if (parsed.pcm.length > 0) {
          await handle.write(parsed.pcm)
          dataBytes += parsed.pcm.length
        }
        job.done = index + 1
        job.characters += [...sentences[index]].length
        job.bytes = 44 + dataBytes
      }
      await handle.write(wavHeader(format, dataBytes), 0, 44, 0)
      await handle.close()
      handle = null
      await replaceFile(temporary, audioPath(id))
      job.status = 'done'
      job.finishedAt = new Date().toISOString()
      job.bytes = 44 + dataBytes
      await writeJson(metaPath(id), {
        voice: job.voice,
        speed: job.speed,
        sentences: sentences.length,
        bytes: 44 + dataBytes,
        seconds: format ? Math.round((dataBytes / (format.sampleRate * format.channels * (format.bitsPerSample / 8))) * 10) / 10 : null,
        finishedAt: job.finishedAt,
      })
    } catch (error) {
      job.status = job.cancelled ? 'cancelled' : 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      job.finishedAt = new Date().toISOString()
      if (handle !== null) await handle.close().catch(() => undefined)
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      if (job.status === 'failed') logger.warn?.(`bookshelf: audiobook ${id} failed: ${job.error}`)
    }
  }

  function cancel(id) {
    const job = jobs.get(id)
    if (!job || job.status !== 'running') return jobState(id)
    job.cancelled = true
    job.status = 'cancelling'
    return jobState(id)
  }

  async function file(id) {
    try {
      const info = await fs.stat(audioPath(id))
      return { path: audioPath(id), bytes: info.size }
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async function remove(id) {
    const job = jobs.get(id)
    if (job && job.status === 'running') job.cancelled = true
    jobs.delete(id)
    await fs.rm(bookDir(id), { recursive: true, force: true })
  }

  return { plan, start, state: jobState, cancel, file, remove }
}
