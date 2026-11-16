import { spawn as spawnProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { replaceFile } from '../assets/atomic-file.mjs'

import { createTtsCache } from './cache.js'
import {
  createDeepseekProvider,
  createEdgeProvider,
  createLocalProvider,
  createMacosProvider,
  createOpenaiProvider,
  createWindowsProvider,
  TtsError,
  defaultRun,
} from './providers.js'
import { TTS_LIMITS, TTS_PROVIDERS, clampNumber, cleanText, sanitizeTtsSettings } from './settings.js'

/**
 * Read-aloud service: provider registry, sentence-sized synthesis, cache.
 */
export function createTtsService({
  rootDir,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  spawn = spawnProcess,
  run = null,
  resolveSecret = async () => '',
  websocket = null,
  logger = console,
} = {}) {
  if (typeof rootDir !== 'string' || rootDir === '') throw new TypeError('a root directory is required')
  const settingsPath = join(rootDir, 'tts.json')
  const cache = createTtsCache({ rootDir })
  let settings = sanitizeTtsSettings(undefined)
  let pendingWrite = Promise.resolve()
  let readyPromise = Promise.resolve()

  const providers = new Map()
  providers.set('deepseek', createDeepseekProvider({ fetchImpl, resolveSecret }))
  providers.set('openai', createOpenaiProvider({ fetchImpl, getSettings: () => settings, resolveSecret }))
  providers.set('macos', createMacosProvider({ platform, spawn, rootDir, run: run ?? defaultRun(spawn) }))
  providers.set('windows', createWindowsProvider({ platform, run: run ?? defaultRun(spawn), rootDir }))
  providers.set('edge', createEdgeProvider({ WebSocketImpl: websocket || globalThis.WebSocket }))
  providers.set('local', createLocalProvider())

  async function readSettingsFile() {
    try {
      const raw = await fs.readFile(settingsPath, 'utf8')
      const parsed = JSON.parse(raw)
      settings = withPlatformProvider(sanitizeTtsSettings(parsed && parsed.settings ? parsed.settings : parsed))
    } catch (error) {
      if (error && error.code !== 'ENOENT') logger.warn?.(`bookshelf: could not read tts.json: ${error.message}`)
      settings = withPlatformProvider(sanitizeTtsSettings(undefined))
    }
    return settings
  }

  function updateSettings(patch) {
    const merged = sanitizeTtsSettings({
      ...settings,
      ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}),
      openai: {
        ...settings.openai,
        ...(patch && patch.openai && typeof patch.openai === 'object' && !Array.isArray(patch.openai) ? patch.openai : {}),
      },
      deepseek: {
        ...settings.deepseek,
        ...(patch && patch.deepseek && typeof patch.deepseek === 'object' && !Array.isArray(patch.deepseek) ? patch.deepseek : {}),
      },
      edge: {
        ...settings.edge,
        ...(patch && patch.edge && typeof patch.edge === 'object' && !Array.isArray(patch.edge) ? patch.edge : {}),
      },
      local: {
        ...settings.local,
        ...(patch && patch.local && typeof patch.local === 'object' && !Array.isArray(patch.local) ? patch.local : {}),
      },
    })
    const runWrite = async () => {
      settings = merged
      await fs.mkdir(rootDir, { recursive: true })
      const temporary = `${settingsPath}.${process.pid}.tmp`
      await fs.writeFile(temporary, JSON.stringify({ version: 1, settings: merged }, null, 2))
      await replaceFile(temporary, settingsPath)
      return merged
    }
    const pending = pendingWrite.then(runWrite, runWrite)
    pendingWrite = pending.catch(() => undefined)
    return pending
  }

  function getSettings() {
    return settings
  }

  function provider(id) {
    const found = providers.get(id)
    if (found === undefined) throw new TtsError(400, `unknown TTS provider: ${id}`)
    return found
  }

  function cacheName(providerId, voice, speed, text) {
    const hash = createHash('sha256')
      .update(`${providerId}\u0000${voice}\u0000${String(speed)}\u0000${text}`)
      .digest('hex')
    return hash
  }

  async function synthesize({ provider: providerId, voice, text, speed }) {
    if (providerId !== undefined && providerId !== '' && !TTS_PROVIDERS.includes(providerId)) {
      throw new TtsError(400, `unknown TTS provider: ${providerId}`)
    }
    const id = providerId !== undefined && providerId !== '' ? providerId : settings.provider
    if (!providerAvailable(id)) {
      throw new TtsError(400, `${providers.get(id)?.label || id} 在当前系统上不可用`)
    }
    const selected = provider(id)
    const target = selected
    if (typeof text !== 'string') throw new TtsError(400, 'text is required')
    const utterance = text.replace(/\s+/g, ' ').trim()
    if (utterance === '') throw new TtsError(400, 'text is required')
    if (utterance.length > TTS_LIMITS.maxTextChars) {
      throw new TtsError(413, `a sentence may be at most ${TTS_LIMITS.maxTextChars} characters`)
    }
    const rate = Math.round(clampNumber(speed, 0.5, 2, settings.speed) * 100) / 100
    const voiceId = cleanText(voice, TTS_LIMITS.maxVoiceLength) || settings.voice
    const name = cacheName(id, voiceId, rate, utterance)
    // A broken cache directory must degrade to "no cache", not to a failed read.
    try {
      const cached = await cache.get(`${name}.wav`)
      if (cached !== null) return { audio: cached, mime: 'audio/wav', ext: '.wav', name: `${name}.wav`, cached: true }
      const cachedMp3 = await cache.get(`${name}.mp3`)
      if (cachedMp3 !== null) return { audio: cachedMp3, mime: 'audio/mpeg', ext: '.mp3', name: `${name}.mp3`, cached: true }
    } catch (error) {
      logger.warn?.(`bookshelf: TTS cache read failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    const result = await target.synthesize({ text: utterance, voice: voiceId, speed: rate })
    if (!result || !Buffer.isBuffer(result.audio) || result.audio.length === 0) {
      throw new TtsError(502, '语音服务没有返回音频')
    }
    try {
      await cache.put(`${name}${result.ext}`, result.audio)
    } catch (error) {
      logger.warn?.(`bookshelf: TTS cache write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { audio: result.audio, mime: result.mime, ext: result.ext, name: `${name}${result.ext}`, cached: false }
  }

  const PLATFORM_PROVIDERS = { macos: 'darwin', windows: 'win32' }

  // Whether a provider can run here at all: the system-voice providers are
  // bound to their OS, the cloud ones and the placeholder are not.
  function providerAvailable(id) {
    const required = PLATFORM_PROVIDERS[id]
    return required === undefined || required === platform
  }

  function defaultProviderFor(platformName) {
    if (platformName === 'win32') return 'windows'
    if (platformName === 'darwin') return 'macos'
    return 'edge'
  }

  // A settings file moved between machines can name a provider this OS cannot
  // run; fall back to the platform default instead of failing every sentence.
  function withPlatformProvider(value) {
    if (providerAvailable(value.provider)) return value
    return { ...value, provider: defaultProviderFor(platform), voice: '' }
  }

  async function capabilities() {
    const list = []
    for (const id of TTS_PROVIDERS) {
      const item = providers.get(id)
      let voices = []
      try {
        voices = await item.voices()
      } catch {
        voices = []
      }
      list.push({
        id,
        label: item.label,
        configured: await item.configured(),
        available: providerAvailable(id),
        platforms: PLATFORM_PROVIDERS[id] === undefined ? ['*'] : [PLATFORM_PROVIDERS[id]],
        voices,
        supports: { speed: true, autoVoice: id === 'macos' || id === 'windows' || id === 'edge' },
      })
    }
    return {
      providers: list,
      settings,
      cache: await cache.stats(),
      platform,
      defaultProvider: defaultProviderFor(platform),
    }
  }

  const AUDIO_NAME = /^[0-9a-f]{64}\.(wav|mp3)$/

  // Audio is played from a same-origin URL, so the browser media element only
  // needs the plain Host URL: no blob:, no CSP exception.
  async function readAudio(name) {
    if (typeof name !== 'string' || !AUDIO_NAME.test(name)) return null
    const audio = await cache.get(name)
    if (audio === null) return null
    return { audio, mime: name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }
  }

  async function voices(providerId) {
    if (providerId !== undefined && providerId !== '') return provider(providerId).voices()
    const all = {}
    for (const id of TTS_PROVIDERS) all[id] = await providers.get(id).voices()
    return all
  }

  return {
    load() {
      readyPromise = readSettingsFile()
      return readyPromise
    },
    ready() {
      return readyPromise
    },
    getSettings,
    updateSettings,
    capabilities,
    voices,
    readAudio,
    synthesize,
    cache,
  }
}
