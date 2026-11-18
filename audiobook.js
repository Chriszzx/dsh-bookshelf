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

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { readWav, stripMp3Tags, wavHeader } from './assets/lib/audiobook-audio.mjs'
import {
  AUDIOBOOK_LIMITS,
  AudiobookError,
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
  const planning = new Map()
  const starting = new Map()
  const removing = new Map()

  const bookDir = (id) => join(root, id)
  const sourcePath = (id) => join(bookDir(id), 'source.txt')
  const planPath = (id) => join(bookDir(id), 'plan.json')
  const audioPath = (id, ext) => join(bookDir(id), `book${ext}`)
  const metaPath = (id) => join(bookDir(id), 'book.json')
  const hashSource = (text) => createHash('sha256').update(text).digest('hex')

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

  async function writePlan(id, { text, voice, speed, provider }) {
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
      id: randomUUID(),
      sourceHash: hashSource(normalized),
      voice: sanitizeVoice(voice, chosenProvider),
      updatedAt: new Date().toISOString(),
    }
    await fs.mkdir(bookDir(id), { recursive: true })
    const sourceTemp = `${sourcePath(id)}.${process.pid}.tmp`
    await fs.writeFile(sourceTemp, normalized)
    await replaceFile(sourceTemp, sourcePath(id))
    await writeJson(planPath(id), value)
    return value
  }

  async function plan(id, options = {}) {
    if (removing.has(id)) throw new AudiobookError(409, '正在删除整书语音，请稍后重新估算')
    const previous = planning.get(id) || Promise.resolve()
    const pending = previous.catch(() => undefined).then(() => writePlan(id, options))
    planning.set(id, pending)
    try {
      return await pending
    } finally {
      if (planning.get(id) === pending) planning.delete(id)
    }
  }

  // Older renders wrote book.wav with a meta file that had no extension; keep
  // those playable instead of forgetting them after the format field appeared.
  async function resolveAudio(id) {
    const meta = await readJson(metaPath(id))
    let ext = meta && (meta.ext === '.wav' || meta.ext === '.mp3') ? meta.ext : null
    if (ext === null) {
      // Older renders wrote book.wav with a meta file that had no extension;
      // probe both audio names instead of assuming WAV so a finished render can
      // never look missing between the audio rename and the meta write.
      for (const candidate of ['.wav', '.mp3']) {
        try {
          await fs.stat(audioPath(id, candidate))
          ext = candidate
          break
        } catch (error) {
          if (!error || error.code !== 'ENOENT') throw error
        }
      }
      if (ext === null) return null
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
        plan: job.plan,
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

  async function start(id, { planId } = {}) {
    if (!planId) throw new AudiobookError(409, '请先重新估算这本书再生成')
    if (removing.has(id)) throw new AudiobookError(409, '正在删除整书语音，请稍后重新估算')
    const pending = starting.get(id)
    if (pending?.planId === planId) return pending.result
    const running = jobs.get(id)
    if (running?.plan.id === planId && ['running', 'cancelling', 'done'].includes(running.status)) {
      return jobState(id)
    }
    if (pending || running?.status === 'running' || running?.status === 'cancelling') {
      throw new AudiobookError(409, '这本书的整书语音正在生成')
    }
    // Reserve the start before another request can interleave with disk reads.
    const result = beginRender(id, planId)
    starting.set(id, { planId, result })
    try {
      return await result
    } finally {
      starting.delete(id)
    }
  }

  async function beginRender(id, planId) {
    const [source, planValue, existing] = await Promise.all([
      readSource(id),
      readJson(planPath(id)),
      resolveAudio(id),
    ])
    if (removing.has(id) || source === null || planValue?.id !== planId || planValue.sourceHash !== hashSource(source)) {
      throw new AudiobookError(409, '整书语音估算已变更，请重新打开并确认估算')
    }
    if (existing?.meta?.planId === planId) return jobState(id)
    const sentences = splitSentences(source)
    if (sentences.length === 0) throw new AudiobookError(400, '没有可朗读的文字')
    if (sentences.length > AUDIOBOOK_LIMITS.maxSentences) throw new AudiobookError(413, '整书语音句子过多')
    const job = {
      status: 'running',
      done: 0,
      total: sentences.length,
      characters: 0,
      bytes: 0,
      error: '',
      plan: planValue,
      provider: planValue.provider,
      voice: planValue.voice,
      speed: planValue.speed,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      cancelled: false,
    }
    jobs.set(id, job)
    job.completion = render(id, sentences, job).catch((error) => {
      logger.warn?.(`bookshelf: audiobook render failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return jobState(id)
  }

  async function render(id, sentences, job) {
    const temporary = join(bookDir(id), 'book.tmp')
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
      if (job.cancelled) throw new AudiobookError(499, '已取消')
      await fs.rm(audioPath(id, ext === '.wav' ? '.mp3' : '.wav'), { force: true }).catch(() => undefined)
      await replaceFile(temporary, audioPath(id, ext))
      const finishedAt = new Date().toISOString()
      const seconds = ext === '.wav' && wavFormat
        ? Math.round((dataBytes / (wavFormat.sampleRate * wavFormat.channels * (wavFormat.bitsPerSample / 8))) * 10) / 10
        : job.plan.durationSeconds
      // Publish the meta before reporting completion: `file()` resolves the
      // audio through this file, so flipping the state first would open a window
      // where a finished render looks missing to a concurrent reader.
      await writeJson(metaPath(id), {
        planId: job.plan.id,
        provider: job.provider,
        voice: job.voice,
        speed: job.speed,
        sentences: sentences.length,
        bytes: job.bytes,
        seconds,
        ext,
        mime: ext === '.wav' ? 'audio/wav' : 'audio/mpeg',
        format: ext.slice(1),
        finishedAt,
      })
      job.finishedAt = finishedAt
      job.status = 'done'
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error)
      job.finishedAt = new Date().toISOString()
      if (handle !== null) await handle.close().catch(() => undefined)
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      job.status = job.cancelled ? 'cancelled' : 'failed'
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
    if (removing.has(id)) return removing.get(id)
    const pending = Promise.resolve().then(async () => {
      const job = jobs.get(id)
      if (job && job.status === 'running') {
        job.cancelled = true
        job.status = 'cancelling'
      }
      await Promise.allSettled([job?.completion, starting.get(id)?.result, planning.get(id)])
      await fs.rm(bookDir(id), { recursive: true, force: true })
      jobs.delete(id)
    })
    removing.set(id, pending)
    try {
      await pending
    } finally {
      removing.delete(id)
    }
  }

  return { plan, start, state: jobState, cancel, file, remove }
}
