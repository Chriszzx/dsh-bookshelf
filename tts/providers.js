import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { DEEPSEEK_VOICES, TTS_LIMITS, clampNumber, cleanText } from './settings.js'

// Speech provider transports. Each factory returns the same contract: an id,
// a label, configured()/voices(), and synthesize() returning audio bytes.

export class TtsError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
    this.name = 'TtsError'
  }
}

export const DEEPSEEK_TTS_URL = 'https://api.deepseek.com/v1/tools/tts'

// ------------------------------------------------------------------ providers

function withTimeout(controller, ms) {
  const timer = setTimeout(() => controller.abort(), ms)
  return () => clearTimeout(timer)
}

async function readErrorBody(response) {
  let body
  try {
    body = await response.text()
  } catch {
    return ''
  }
  try {
    const parsed = JSON.parse(body)
    const message = parsed && (parsed.error?.message || parsed.message || parsed.error)
    if (typeof message === 'string' && message !== '') return message.slice(0, 300)
  } catch {
    // Not JSON; fall through to the trimmed body.
  }
  return body.trim().slice(0, 300)
}

function providerError(provider, status, message, body) {
  const detail = body !== '' ? body : message
  if (provider === 'deepseek') {
    if (status === 400) return new TtsError(422, `DeepSeek 拒绝朗读这段文字（内容审核或无有效文本）：${detail}`)
    if (status === 429) return new TtsError(429, 'DeepSeek 语音并发已满，请稍后重试')
    if (status === 503 || status === 504) return new TtsError(503, 'DeepSeek 语音服务繁忙，请稍后重试')
    if (status === 401 || status === 403) return new TtsError(403, 'DeepSeek API Key 无效或未配置')
  }
  if (status === 401 || status === 403) return new TtsError(403, `${provider}：密钥无效或未配置（${detail}）`)
  if (status === 429) return new TtsError(429, `${provider} 请求过于频繁，请稍后重试`)
  return new TtsError(502, `${provider} 合成失败（HTTP ${status}）：${detail}`)
}

function createDeepseekProvider({ fetchImpl, resolveSecret }) {
  return {
    id: 'deepseek',
    label: 'DeepSeek 语音',
    async configured() {
      return (await resolveSecret('deepseek')) !== ''
    },
    voices() {
      return DEEPSEEK_VOICES.slice()
    },
    async synthesize({ text, voice, speed }) {
      const key = await resolveSecret('deepseek')
      if (key === '') throw new TtsError(403, 'DeepSeek API Key 未配置')
      const controller = new AbortController()
      const stop = withTimeout(controller, 60_000)
      try {
        const response = await fetchImpl(DEEPSEEK_TTS_URL, {
          method: 'POST',
          signal: controller.signal,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            voice_id: DEEPSEEK_VOICES.some((item) => item.id === voice) ? voice : 'stella',
            format: 'wav',
          }),
        })
        if (!response.ok) throw providerError('deepseek', response.status, '', await readErrorBody(response))
        const audio = Buffer.from(await response.arrayBuffer())
        if (audio.length === 0) throw new TtsError(502, 'DeepSeek 返回了空音频')
        return { audio, mime: 'audio/wav', ext: '.wav', speed }
      } catch (error) {
        if (error instanceof TtsError) throw error
        if (error && error.name === 'AbortError') throw new TtsError(504, 'DeepSeek 语音合成超时')
        throw new TtsError(502, `DeepSeek 语音连接失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        stop()
      }
    },
  }
}

function createOpenaiProvider({ fetchImpl, getSettings, resolveSecret }) {
  return {
    id: 'openai',
    label: 'OpenAI 兼容语音',
    async configured() {
      const settings = getSettings()
      return settings.openai.baseUrl !== '' && (await resolveSecret('openai')) !== ''
    },
    voices() {
      // The OpenAI speech contract has no voice-list endpoint; these are the
      // well-known names, and the settings field accepts anything else.
      // `lang` is only a hint: these voices are multilingual, and auto voice
      // selection leaves them alone.
      return [
        { id: 'alloy', label: 'alloy', lang: 'en-US' }, { id: 'echo', label: 'echo', lang: 'en-US' },
        { id: 'fable', label: 'fable', lang: 'en-US' }, { id: 'onyx', label: 'onyx', lang: 'en-US' },
        { id: 'nova', label: 'nova', lang: 'en-US' }, { id: 'shimmer', label: 'shimmer', lang: 'en-US' },
        { id: 'anna', label: 'anna（硅基流动）', lang: 'zh-CN' }, { id: 'bella', label: 'bella（硅基流动）', lang: 'zh-CN' },
      ]
    },
    async synthesize({ text, voice, speed }) {
      const settings = getSettings().openai
      if (settings.baseUrl === '') throw new TtsError(400, 'OpenAI 兼容服务的 Base URL 未配置')
      const key = await resolveSecret('openai')
      if (key === '') throw new TtsError(403, 'OpenAI 兼容服务的 API Key 未配置')
      const controller = new AbortController()
      const stop = withTimeout(controller, 60_000)
      try {
        const response = await fetchImpl(`${settings.baseUrl}/audio/speech`, {
          method: 'POST',
          signal: controller.signal,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: settings.model,
            input: text,
            voice: voice || settings.voice,
            response_format: settings.format,
            speed: Math.round(clampNumber(speed, 0.5, 2, 1) * 100) / 100,
          }),
        })
        if (!response.ok) throw providerError('openai', response.status, '', await readErrorBody(response))
        const audio = Buffer.from(await response.arrayBuffer())
        if (audio.length === 0) throw new TtsError(502, '语音服务返回了空音频')
        const type = String(response.headers.get('content-type') || '').toLowerCase()
        const mime = type.startsWith('audio/') ? type.split(';')[0] : settings.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
        const ext = mime.includes('wav') ? '.wav' : '.mp3'
        return { audio, mime, ext, speed }
      } catch (error) {
        if (error instanceof TtsError) throw error
        if (error && error.name === 'AbortError') throw new TtsError(504, '语音合成超时')
        throw new TtsError(502, `语音连接失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        stop()
      }
    },
  }
}

const SAY_VOICE_PATTERN = /^(.+?)\s*\((.+)\)\s+([A-Za-z]{2,3}[_-][A-Za-z0-9_-]+)\s*(?:#\s*(.*))?$/

function parseSayVoices(output) {
  // `say -v '?'` lists the display name (which may itself contain parentheses,
  // and is reused across locales: "Reed (德语（德国）)", "Reed (英语（美国）)") and
  // the locale. The display name is what `say -v` accepts, so it is the id; a
  // bare name like "Reed" would always resolve to the first locale (German).
  const voices = []
  const seen = new Set()
  for (const raw of String(output).split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const hash = line.indexOf('#')
    const head = (hash === -1 ? line : line.slice(0, hash)).trim()
    const sample = hash === -1 ? '' : line.slice(hash + 1).trim()
    const match = /^(.*\S)\s{2,}([A-Za-z]{2,3}[_-][A-Za-z0-9_-]+)\s*$/.exec(head)
    if (match === null) continue
    const display = match[1].trim()
    if (display === '' || seen.has(display)) continue
    seen.add(display)
    voices.push({
      id: display,
      name: display,
      label: display,
      lang: match[2].replace('_', '-'),
      sample,
    })
  }
  return voices
}

function createMacosProvider({ platform, spawn, rootDir, run }) {
  let voicesCache = null
  let voicesAt = 0

  async function listVoices() {
    if (platform !== 'darwin') return []
    if (voicesCache !== null && Date.now() - voicesAt < 60 * 60 * 1000) return voicesCache
    try {
      const { stdout } = await run('/usr/bin/say', ['-v', '?'], { timeout: 10_000 })
      voicesCache = parseSayVoices(stdout)
      voicesAt = Date.now()
      return voicesCache
    } catch {
      return []
    }
  }

  return {
    id: 'macos',
    label: '本机语音（macOS say）',
    async configured() {
      return platform === 'darwin'
    },
    voices: listVoices,
    async synthesize({ text, voice, speed }) {
      if (platform !== 'darwin') throw new TtsError(400, '本机语音只支持 macOS')
      // The voice id is the full `say` display name, so a locale-specific voice
      // is honoured instead of silently falling back to another language.
      const name = cleanText(voice, TTS_LIMITS.maxVoiceLength)
      // say has no "speed multiplier": words per minute is the closest control.
      const rate = String(Math.round(clampNumber(175 * clampNumber(speed, 0.5, 2, 1), 90, 400)))
      const directory = join(rootDir, 'tts-tmp')
      await fs.mkdir(directory, { recursive: true })
      const target = join(directory, `${randomUUID()}.wav`)
      const speak = (voiceName) => {
        const args = voiceName === null
          ? ['-r', rate, '-o', target, '--data-format=LEI16@22050', text]
          : ['-v', voiceName, '-r', rate, '-o', target, '--data-format=LEI16@22050', text]
        return run('/usr/bin/say', args, { timeout: 60_000 })
      }
      try {
        await speak(name === '' ? null : name)
        const audio = await fs.readFile(target)
        if (audio.length === 0) throw new TtsError(502, '本机语音返回了空音频')
        return { audio, mime: 'audio/wav', ext: '.wav', speed }
      } catch (error) {
        if (error instanceof TtsError) throw error
        throw new TtsError(502, `本机语音合成失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        await fs.rm(target, { force: true }).catch(() => undefined)
      }
    },
  }
}

// ------------------------------------------------------------------ Edge TTS

// Public read-aloud credentials used by the Edge browser and by every
// open-source Edge TTS client; they are not user secrets.
const EDGE_TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const EDGE_WSS = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1'
const EDGE_CHROMIUM = process.env.BOOKSHELF_EDGE_CHROMIUM || '143.0.3650.75'
const EDGE_GEC_VERSION = process.env.BOOKSHELF_EDGE_GEC_VERSION || `1-${EDGE_CHROMIUM}`
const EDGE_WIN_EPOCH_SECONDS = 11644473600n
const EDGE_ROUNDING_TICKS = 3000000000n

// A curated subset is enough for the UI and keeps the Host offline-capable;
// the service itself accepts any voice name in this list.
export const EDGE_VOICES = Object.freeze([
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', lang: 'zh-CN', label: '晓晓 · 女声' },
  { id: 'zh-CN-XiaoxuanNeural', name: '晓萱', lang: 'zh-CN', label: '晓萱 · 女声（默认）' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', lang: 'zh-CN', label: '晓伊 · 女声' },
  { id: 'zh-CN-YunxiNeural', name: '云希', lang: 'zh-CN', label: '云希 · 男声' },
  { id: 'zh-CN-YunyangNeural', name: '云扬', lang: 'zh-CN', label: '云扬 · 男声（新闻）' },
  { id: 'zh-CN-YunjianNeural', name: '云健', lang: 'zh-CN', label: '云健 · 男声（解说）' },
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻', lang: 'zh-TW', label: '曉臻 · 女声' },
  { id: 'zh-TW-HsiaoYuNeural', name: '曉雨', lang: 'zh-TW', label: '曉雨 · 女声' },
  { id: 'zh-TW-YunJheNeural', name: '雲哲', lang: 'zh-TW', label: '雲哲 · 男声' },
  { id: 'zh-HK-HiuGaaiNeural', name: '曉佳', lang: 'zh-HK', label: '曉佳 · 女声' },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼', lang: 'zh-HK', label: '曉曼 · 女声' },
  { id: 'zh-HK-WanLungNeural', name: '雲龍', lang: 'zh-HK', label: '雲龍 · 男声' },
  { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US', label: 'Aria · female' },
  { id: 'en-US-JennyNeural', name: 'Jenny', lang: 'en-US', label: 'Jenny · female' },
  { id: 'en-US-GuyNeural', name: 'Guy', lang: 'en-US', label: 'Guy · male' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', lang: 'en-GB', label: 'Sonia · female' },
  { id: 'ja-JP-NanamiNeural', name: '七海', lang: 'ja-JP', label: '七海 · 女声' },
  { id: 'ko-KR-SunHiNeural', name: '선히', lang: 'ko-KR', label: '선히 · 女声' },
  { id: 'de-DE-KatjaNeural', name: 'Katja', lang: 'de-DE', label: 'Katja · weiblich' },
  { id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'fr-FR', label: 'Denise · féminin' },
  { id: 'es-ES-ElviraNeural', name: 'Elvira', lang: 'es-ES', label: 'Elvira · femenino' },
  { id: 'ru-RU-SvetlanaNeural', name: 'Svetlana', lang: 'ru-RU', label: 'Svetlana · женский' },
])

const LOCAL_VOICES = Object.freeze([{ id: 'default', name: '默认', lang: '*', label: '默认音色（占位）' }])

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Sec-MS-GEC = SHA256(ticks + trusted token), ticks rounded down to a
// five-minute window; a stale value is rejected with 403.
export function edgeGecToken(nowMs = Date.now()) {
  const ticks = (BigInt(Math.floor(nowMs / 1000)) + EDGE_WIN_EPOCH_SECONDS) * 10000000n
  const rounded = ticks - (ticks % EDGE_ROUNDING_TICKS)
  return createHash('sha256').update(String(rounded) + EDGE_TRUSTED_TOKEN, 'ascii').digest('hex').toUpperCase()
}

/**
 * The public read-aloud endpoint authenticates through QUERY parameters, so the
 * platform WebSocket can be used directly (the reference implementation,
 * node-edge-tts and this plugin all take this route). Protocol: speech.config
 * and SSML frames out, binary frames whose audio payload follows the
 * `Path:audio` marker, and a text `turn.end` frame when finished.
 */
function createEdgeProvider({ WebSocketImpl }) {
  const makeSocket = (url, headers) => new WebSocketImpl(url, { headers })

  function variantFor(voice, text, speed) {
    const locale = String(voice).split('-').slice(0, 2).join('-') || 'zh-CN'
    const rate = Math.round((clampNumber(speed, 0.5, 2, 1) - 1) * 100)
    return { locale, rate: `${rate >= 0 ? '+' : ''}${rate}%`, pitch: '+0Hz', volume: '+0%' }
  }

  function speakOnce({ chosen, text, speed }) {
    return new Promise((resolve, reject) => {
      const connectionId = randomBytes(16).toString('hex')
      const url = `${EDGE_WSS}?Ocp-Apim-Subscription-Key=${EDGE_TRUSTED_TOKEN}`
        + `&Sec-MS-GEC=${edgeGecToken()}`
        + `&Sec-MS-GEC-Version=${EDGE_GEC_VERSION}`
        + `&ConnectionId=${connectionId}`
      let socket
      try {
        socket = makeSocket(url, {
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_CHROMIUM.split('.')[0]}.0.0.0 Safari/537.36 Edg/${EDGE_CHROMIUM.split('.')[0]}.0.0.0`,
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
        })
      } catch (error) {
        reject(new TtsError(502, `Edge 语音合成失败：${error instanceof Error ? error.message : String(error)}`))
        return
      }
      socket.binaryType = 'arraybuffer'
      const chunks = []
      let settled = false
      let pendingError = null
      let errorTimer = null
      const timer = setTimeout(() => {
        finish(new TtsError(504, 'Edge 语音服务没有在 20 秒内返回音频'))
      }, 20_000)
      function closeSocket() {
        try {
          socket.close()
        } catch {
          // Already gone.
        }
      }
      function finish(error) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (errorTimer !== null) clearTimeout(errorTimer)
        closeSocket()
        if (error) {
          reject(error instanceof TtsError ? error : new TtsError(502, `Edge 语音合成失败：${error instanceof Error ? error.message : String(error)}`))
          return
        }
        const audio = Buffer.concat(chunks)
        if (audio.length < 100) {
          reject(new TtsError(502, `Edge 语音服务返回的音频过短（${audio.length} 字节）`))
          return
        }
        resolve({ audio, mime: 'audio/mpeg', ext: '.mp3', speed })
      }
      socket.onopen = () => {
        const { locale, rate, pitch, volume } = variantFor(chosen, text, speed)
        const config = {
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        }
        const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts"'
          + ` xml:lang="${escapeXml(locale)}"><voice name="${escapeXml(chosen)}">`
          + `<prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}" volume="${escapeXml(volume)}">`
          + `${escapeXml(text)}</prosody></voice></speak>`
        socket.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`)
        socket.send(`X-RequestId:${randomBytes(16).toString('hex')}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`)
      }
      socket.onmessage = (event) => {
        if (settled) return
        const data = event && event.data
        if (typeof data === 'string') {
          if (data.includes('Path:turn.end')) finish(null)
          return
        }
        if (data === undefined || data === null) return
        const raw = Buffer.from(data)
        const marker = Buffer.from('Path:audio\r\n')
        const index = raw.indexOf(marker)
        if (index >= 0) {
          const payload = raw.subarray(index + marker.length)
          if (payload.length > 0) chunks.push(payload)
        } else if (raw.length > 0) {
          chunks.push(raw)
        }
      }
      socket.onerror = (event) => {
        pendingError = new Error(`Edge 连接出错${event && event.message ? `：${event.message}` : ''}`)
        if (errorTimer !== null) clearTimeout(errorTimer)
        errorTimer = setTimeout(() => finish(pendingError), 1200)
      }
      socket.onclose = (event) => {
        if (settled) return
        const code = event && event.code
        const reason = event && event.reason ? ` ${String(event.reason).slice(0, 100)}` : ''
        finish(pendingError || new Error(`Edge 连接提前关闭（${code ?? '未知状态'}）${reason}`))
      }
    })
  }

  return {
    id: 'edge',
    label: 'Edge 语音（微软，无需 Key）',
    async configured() {
      return typeof WebSocketImpl === 'function'
    },
    async voices() {
      return EDGE_VOICES.slice()
    },
    async synthesize({ text, voice, speed }) {
      if (typeof WebSocketImpl !== 'function') {
        throw new TtsError(501, '当前 Node 运行时不支持 WebSocket，Edge 语音不可用')
      }
      const chosen = EDGE_VOICES.some((item) => item.id === voice) ? voice : EDGE_VOICES[0].id
      let lastError = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await speakOnce({ chosen, text, speed })
        } catch (error) {
          lastError = error
          const message = error instanceof Error ? error.message : String(error)
          // A removed voice or an auth rejection will not improve on retry.
          if (/401|403|1007|Unsupported voice|不支持/i.test(message)) break
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800))
        }
      }
      throw lastError instanceof TtsError
        ? lastError
        : new TtsError(502, `Edge 语音合成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
    },
  }
}

const POWERSHELL = 'powershell.exe'

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Windows system voices through the .NET System.Speech API: same contract as
 * the macOS `say` provider, different engine and voice identifiers.
 */
function createWindowsProvider({ platform, run, rootDir }) {
  let voicesCache = null
  let voicesAt = 0
  const available = platform === 'win32'

  async function listVoices() {
    if (!available) return []
    if (voicesCache !== null && Date.now() - voicesAt < 60 * 60 * 1000) return voicesCache
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      "$s.GetInstalledVoices() | ForEach-Object { $i = $_.VoiceInfo; [pscustomobject]@{ name = $i.Name; culture = $i.Culture.Name; gender = [string]$i.Gender } } | ConvertTo-Json -Compress",
    ].join('; ')
    try {
      const { stdout } = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20_000 })
      const parsed = JSON.parse(String(stdout || '[]').trim() || '[]')
      const list = Array.isArray(parsed) ? parsed : [parsed]
      voicesCache = list
        .map((item) => ({
          id: String(item.name || ''),
          name: String(item.name || ''),
          label: `${item.name}${item.culture ? ` · ${item.culture}` : ''}`,
          lang: String(item.culture || '').replace('_', '-'),
          gender: item.gender ? String(item.gender) : '',
        }))
        .filter((voice) => voice.id !== '')
      voicesAt = Date.now()
      return voicesCache
    } catch {
      return []
    }
  }

  return {
    id: 'windows',
    label: '本机语音（Windows SAPI）',
    async configured() {
      return available
    },
    voices: listVoices,
    async synthesize({ text, voice, speed }) {
      if (!available) throw new TtsError(400, '本机语音（Windows）只支持 Windows')
      const name = cleanText(voice, TTS_LIMITS.maxVoiceLength)
      // SAPI rate is an integer from -10 (slowest) to 10 (fastest).
      const rate = Math.round(Math.min(10, Math.max(-10, (clampNumber(speed, 0.5, 2, 1) - 1) * 10)))
      const directory = join(rootDir, 'tts-tmp')
      await fs.mkdir(directory, { recursive: true })
      const target = join(directory, `${randomUUID()}.wav`)
      const script = [
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        name === '' ? '' : `$s.SelectVoice(${powershellQuote(name)})`,
        `$s.Rate = ${rate}`,
        `$s.SetOutputToWaveFile(${powershellQuote(target)})`,
        `$s.Speak(${powershellQuote(text)})`,
        '$s.Dispose()',
      ].filter(Boolean).join('; ')
      try {
        await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 60_000 })
        const audio = await fs.readFile(target)
        if (audio.length === 0) throw new TtsError(502, '本机语音返回了空音频')
        return { audio, mime: 'audio/wav', ext: '.wav', speed }
      } catch (error) {
        if (error instanceof TtsError) throw error
        throw new TtsError(502, `本机语音合成失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        await fs.rm(target, { force: true }).catch(() => undefined)
      }
    },
  }
}

function createLocalProvider() {
  return {
    id: 'local',
    label: '本地 TTS 模型（占位，尚未实现）',
    async configured() {
      return false
    },
    async voices() {
      return LOCAL_VOICES.slice()
    },
    async synthesize() {
      throw new TtsError(501, '本地 TTS 模型尚未实现：当前只保留配置界面。')
    },
  }
}

function defaultRun(spawnImpl) {
  return (command, args, options = {}) =>
    new Promise((resolvePromise, rejectPromise) => {
      const child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const timer = options.timeout
        ? setTimeout(() => {
            child.kill('SIGKILL')
            rejectPromise(new Error(`${command} timed out`))
          }, options.timeout)
        : null
      child.stdout?.on('data', (chunk) => { stdout += chunk })
      child.stderr?.on('data', (chunk) => { stderr += chunk })
      child.once('error', (error) => {
        if (timer !== null) clearTimeout(timer)
        rejectPromise(error)
      })
      child.once('close', (code) => {
        if (timer !== null) clearTimeout(timer)
        if (code === 0) resolvePromise({ stdout, stderr })
        else rejectPromise(new Error(stderr.trim() || `${command} exited with ${code}`))
      })
    })
}

export {
  createDeepseekProvider,
  createOpenaiProvider,
  createMacosProvider,
  createEdgeProvider,
  createWindowsProvider,
  createLocalProvider,
  defaultRun,
}
