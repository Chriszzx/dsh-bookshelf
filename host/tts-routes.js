import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { replaceFile } from '../assets/atomic-file.mjs'

import { API_PREFIX, HttpError } from './http.js'
import { exactRoute, regexRoute } from './routes.js'
import { cleanText } from './states.js'

/**
 * Read-aloud secrets: a pasted key is stored in a 0600 file under the bookshelf
 * directory; an environment variable or a credential store entry with the same
 * name still applies as a fallback. Keys never leave the Host.
 */
export function createTtsSecrets({ rootDir, getService } = {}) {
  const ttsSecretsPath = join(rootDir, 'tts-secrets.json')
  let secretsCache = null
  let pendingSecretWrite = Promise.resolve()

  async function readTtsSecrets() {
    if (secretsCache !== null) return secretsCache
    try {
      const parsed = JSON.parse(await fs.readFile(ttsSecretsPath, 'utf8'))
      secretsCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      secretsCache = {}
    }
    return secretsCache
  }

  function writeTtsSecrets(patch) {
    const run = async () => {
      const current = await readTtsSecrets()
      const next = { ...current }
      for (const [name, value] of Object.entries(patch)) {
        if (typeof value === 'string' && value.trim() !== '') next[name] = value.trim()
        else delete next[name]
      }
      secretsCache = next
      await fs.mkdir(rootDir, { recursive: true })
      const temporary = `${ttsSecretsPath}.${process.pid}.tmp`
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 })
      await fs.chmod(temporary, 0o600).catch(() => undefined)
      await replaceFile(temporary, ttsSecretsPath)
      return next
    }
    const pending = pendingSecretWrite.then(run, run)
    pendingSecretWrite = pending.catch(() => undefined)
    return pending
  }

  async function resolveTtsSecret(name) {
    const stored = (await readTtsSecrets())[name]
    if (typeof stored === 'string' && stored !== '') return stored
    const envName = name === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'BOOKSHELF_TTS_OPENAI_KEY'
    const fromEnv = process.env[envName]
    if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
    try {
      const credentials = getService('credentials')
      const hit = credentials && typeof credentials.resolve === 'function' ? await credentials.resolve(envName) : undefined
      if (hit && typeof hit.value === 'string' && hit.value !== '') return hit.value
    } catch {
      // The credential store is optional; a missing service is not an error.
    }
    return ''
  }

  return { resolveSecret: resolveTtsSecret, writeSecrets: writeTtsSecrets }
}

/** Read-aloud HTTP surface: capabilities, voices, settings, audio, cache. */
export function createTtsRoutes({ http, tts, secrets } = {}) {
  const { sendJson, readJsonBody, baseHeaders } = http
  const { resolveSecret, writeSecrets } = secrets

  async function capabilities(request, response) {
    await tts.ready()
    const value = await tts.capabilities()
    // Report only whether a key is set; never echo the value.
    value.secrets = {
      deepseek: (await resolveSecret('deepseek')) !== '',
      openai: (await resolveSecret('openai')) !== '',
    }
    sendJson(request, response, 200, value)
  }

  async function voices(request, response, url) {
    await tts.ready()
    const provider = cleanText(url.searchParams.get('provider'), '', 40)
    sendJson(request, response, 200, { voices: await tts.voices(provider) })
  }

  async function getSettings(request, response) {
    sendJson(request, response, 200, { settings: tts.getSettings() })
  }

  async function putSettings(request, response) {
    const body = await readJsonBody(request, 32 * 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'settings must be an object')
    const patch = body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : body
    const secretPatch = body.secrets && typeof body.secrets === 'object' && !Array.isArray(body.secrets) ? body.secrets : undefined
    if (secretPatch !== undefined) await writeSecrets(secretPatch)
    const settings = await tts.updateSettings(patch)
    sendJson(request, response, 200, { settings })
  }

  async function synthesize(request, response) {
    const body = await readJsonBody(request, 64 * 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid synthesis request')
    await tts.ready()
    const result = await tts.synthesize({
      provider: cleanText(body.provider, '', 40),
      voice: cleanText(body.voice, '', 64),
      speed: body.speed,
      text: typeof body.text === 'string' ? body.text : '',
    })
    // Hand back a same-origin URL: browser CSP blocks blob: media, while a
    // plain Host URL plays everywhere.
    sendJson(request, response, 200, {
      url: `${API_PREFIX}/tts/audio/${result.name}`,
      mime: result.mime,
      cached: result.cached,
    })
  }

  async function sendAudio(request, response, name) {
    const audio = await tts.readAudio(name)
    if (audio === null) throw new HttpError(404, 'audio not found')
    response.writeHead(200, {
      ...baseHeaders(request),
      'Content-Type': audio.mime,
      'Content-Length': audio.audio.length,
      // The name is a content hash, so the bytes never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    if (request.method === 'HEAD') response.end()
    else response.end(audio.audio)
  }

  async function cacheStats(request, response) {
    sendJson(request, response, 200, await tts.cache.stats())
  }

  async function clearCache(request, response) {
    sendJson(request, response, 200, await tts.cache.clear())
  }

  return [
    exactRoute(`${API_PREFIX}/tts/capabilities`, { GET: capabilities }),
    exactRoute(`${API_PREFIX}/tts/voices`, {
      GET: (request, response, context) => voices(request, response, context.url),
    }),
    exactRoute(`${API_PREFIX}/tts/settings`, { GET: getSettings, PUT: putSettings }),
    exactRoute(`${API_PREFIX}/tts/synthesize`, { POST: synthesize }),
    regexRoute(new RegExp(`^${API_PREFIX}/tts/audio/([0-9a-f]{64}\\.(?:wav|mp3))$`), {
      GET: (request, response, context) => sendAudio(request, response, context.params[1]),
      HEAD: (request, response, context) => sendAudio(request, response, context.params[1]),
    }),
    exactRoute(`${API_PREFIX}/tts/cache`, { GET: cacheStats, DELETE: clearCache }),
  ]
}
