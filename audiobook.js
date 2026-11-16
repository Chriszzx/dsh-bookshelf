// Whole-book audiobook rendering on the Host.
//
// The browser extracts the book text once and posts it here; the Host stores it
// next to the book's audio, estimates duration/size (and DeepSeek billing when
// DeepSeek is chosen) and synthesises sentence by sentence into one file. Jobs
// run in-process because the shelf is a local single-user app: a Map plus a
// small state file is enough, and a crash simply leaves an idle plan that can be
// started again.
//
// The pure WAV/MP3 and billing helpers live in `assets/lib/audiobook-audio.mjs`
// and `assets/lib/audiobook-pricing.mjs`; this module keeps the service
// assembly and its job/state machine.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { readWav, stripMp3Tags, wavHeader } from './assets/lib/audiobook-audio.mjs'
import {
  AUDIOBOOK_LIMITS,
  AudiobookError,
  clampSpeed,
  estimateAudiobook,
  sanitizeAudiobookProvider,
  sanitizeVoice,
} from './assets/lib/audiobook-pricing.mjs'
import { replaceFile } from './assets/atomic-file.mjs'
import { splitSentences, normalizeSpeakText } from './assets/tts-sentences.mjs'

export { AudiobookError }

// ---------------------------------------------------------------------- service

export function createAudiobookService({ rootDir, tts, logger = console } = {}) {
  if (typeof rootDir !== 'string' || rootDir === '') throw new TypeError('a root directory is required')
  if (!tts || typeof tts.synthesize !== 'function') throw new TypeError('a tts service is required')
  const root = join(rootDir, 'audiobooks')
  const jobs = new Map()

  const bookDir = (id) => join(root, id)
  const sourcePath = (id) => join(bookDir(id), 'source.txt')
  const planPath = (id) => join(bookDir(id), 'plan.json')
  const audioPath = (id, ext) => join(bookDir(id), `book${ext}`)
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

  async function plan(id, { text, voice, speed, provider } = {}) {
    const chosenProvider = sanitizeAudiobookProvider(provider)
    let normalized = typeof text === 'string' ? normalizeSpeakText(text) : ''
    if (normalized === '') normalized = (await readSource(id)) || ''
    if (normalized === '') throw new AudiobookError(400, '缺少要朗读的书籍文本')
    if (normalized.length > AUDIOBOOK_LIMITS.maxTextChars) {
      throw new AudiobookError(413, `整书语音最多支持 ${AUDIOBOOK_LIMITS.maxTextChars} 个字符`)
    }
    const estimate = estimateAudiobook({ text: normalized, speed, provider: chosenProvider })
    const value = {
      ...estimate,
      voice: sanitizeVoice(voice, chosenProvider),
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

  // Older renders wrote book.wav with a meta file that had no extension; keep
  // those playable instead of forgetting them after the format field appeared.
  async function resolveAudio(id) {
    const meta = await readJson(metaPath(id))
    let ext = meta && (meta.ext === '.wav' || meta.ext === '.mp3') ? meta.ext : null
    if (ext === null) {
      try {
        await fs.stat(audioPath(id, '.wav'))
        ext = '.wav'
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error
        return null
      }
    }
    try {
      const info = await fs.stat(audioPath(id, ext))
      return { info, ext, meta }
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async function jobState(id) {
    const job = jobs.get(id)
    const planValue = await readJson(planPath(id))
    let audio = null
    const resolved = await resolveAudio(id)
    if (resolved !== null) {
      const { info, ext, meta } = resolved
      audio = {
        bytes: info.size,
        name: `${id}${ext}`,
        ext,
        mime: (meta && meta.mime) || (ext === '.wav' ? 'audio/wav' : 'audio/mpeg'),
        provider: (meta && meta.provider) || '',
        updatedAt: (meta && meta.finishedAt) || info.mtime.toISOString(),
        seconds: meta && Number.isFinite(meta.seconds) ? meta.seconds : null,
      }
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

  async function start(id, { voice, speed, provider } = {}) {
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
    const chosenProvider = sanitizeAudiobookProvider(provider)
    const chosenVoice = sanitizeVoice(voice, chosenProvider)
    const job = {
      status: 'running',
      done: 0,
      total: sentences.length,
      characters: 0,
      bytes: 0,
      error: '',
      provider: chosenProvider,
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
    const temporary = join(bookDir(id), 'book.tmp')
    const planValue = await readJson(planPath(id))
    let handle = null
    let ext = null
    let wavFormat = null
    let dataBytes = 0
    try {
      await fs.mkdir(bookDir(id), { recursive: true })
      handle = await fs.open(temporary, 'w')
      for (let index = 0; index < sentences.length; index += 1) {
        if (job.cancelled) throw new AudiobookError(499, '已取消')
        const result = await tts.synthesize({
          provider: job.provider,
          voice: job.voice,
          speed: job.speed,
          text: sentences[index],
        })
        const chunkExt = result.mime === 'audio/mpeg' || result.ext === '.mp3' ? '.mp3' : '.wav'
        if (ext === null) {
          ext = chunkExt
          if (ext === '.wav') {
            wavFormat = readWav(result.audio).format
            await handle.write(Buffer.alloc(44))
          }
        } else if (ext !== chunkExt) {
          throw new AudiobookError(502, '语音服务返回了混合格式，无法合并')
        }
        if (ext === '.wav') {
          const parsed = readWav(result.audio)
          if (parsed.format.channels !== wavFormat.channels || parsed.format.sampleRate !== wavFormat.sampleRate || parsed.format.bitsPerSample !== wavFormat.bitsPerSample) {
            throw new AudiobookError(502, '语音片段格式不一致，无法合并')
          }
          if (parsed.pcm.length > 0) {
            await handle.write(parsed.pcm)
            dataBytes += parsed.pcm.length
          }
        } else {
          const payload = stripMp3Tags(result.audio)
          if (payload.length > 0) {
            await handle.write(payload)
            dataBytes += payload.length
          }
        }
        job.done = index + 1
        job.characters += [...sentences[index]].length
        job.bytes = (ext === '.wav' ? 44 : 0) + dataBytes
      }
      if (ext === null) throw new AudiobookError(502, '没有可合并的语音')
      if (ext === '.wav') {
        await handle.write(wavHeader(wavFormat, dataBytes), 0, 44, 0)
        job.bytes = 44 + dataBytes
      } else {
        job.bytes = dataBytes
      }
      await handle.close()
      handle = null
      await fs.rm(audioPath(id, ext === '.wav' ? '.mp3' : '.wav'), { force: true }).catch(() => undefined)
      await replaceFile(temporary, audioPath(id, ext))
      job.status = 'done'
      job.finishedAt = new Date().toISOString()
      const seconds = ext === '.wav' && wavFormat
        ? Math.round((dataBytes / (wavFormat.sampleRate * wavFormat.channels * (wavFormat.bitsPerSample / 8))) * 10) / 10
        : planValue && Number.isFinite(planValue.durationSeconds) ? planValue.durationSeconds : null
      await writeJson(metaPath(id), {
        provider: job.provider,
        voice: job.voice,
        speed: job.speed,
        sentences: sentences.length,
        bytes: job.bytes,
        seconds,
        ext,
        mime: ext === '.wav' ? 'audio/wav' : 'audio/mpeg',
        format: ext.slice(1),
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
    const resolved = await resolveAudio(id)
    if (resolved === null) return null
    const { info, ext, meta } = resolved
    return {
      path: audioPath(id, ext),
      bytes: info.size,
      ext,
      mime: (meta && meta.mime) || (ext === '.wav' ? 'audio/wav' : 'audio/mpeg'),
      name: `${id}${ext}`,
      seconds: meta && Number.isFinite(meta.seconds) ? meta.seconds : null,
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
