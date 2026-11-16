// Read-aloud settings: provider identifiers, voice catalogs and the sanitiser
// that keeps a hand-edited tts.json from making the reader unusable. Provider
// transports live in providers.js, the audio cache in cache.js and the
// composition root in service.js; tts.js re-exports the public surface.

export const TTS_PROVIDERS = Object.freeze(['macos', 'windows', 'edge', 'deepseek', 'openai', 'local'])

export const TTS_LIMITS = Object.freeze({
  maxTextChars: 1000,
  maxCacheBytes: 512 * 1024 * 1024,
  maxVoiceLength: 64,
  maxUrlLength: 500,
  maxModelLength: 120,
})

export const DEEPSEEK_VOICES = Object.freeze([
  { id: 'stella', label: '海星 · 女声', lang: 'zh-CN' },
  { id: 'tide', label: '暗潮 · 男声', lang: 'zh-CN' },
])

const DEFAULT_SETTINGS = Object.freeze({
  provider: 'macos',
  // Empty means "let the provider pick", which is what automatic language
  // selection relies on.
  voice: '',
  speed: 1,
  autoPageTurn: true,
  autoVoice: true,
})

const OPENAI_FORMATS = new Set(['mp3', 'wav'])

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, number))
}

function cleanText(value, limit) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function cleanUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().slice(0, TTS_LIMITS.maxUrlLength)
  if (trimmed === '') return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return trimmed.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/**
 * Sanitised read-aloud settings. Anything unrecognised falls back to defaults so
 * a hand-edited or older file cannot make the reader unusable.
 */
export function sanitizeTtsSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const openai = source.openai && typeof source.openai === 'object' && !Array.isArray(source.openai) ? source.openai : {}
  const deepseek = source.deepseek && typeof source.deepseek === 'object' && !Array.isArray(source.deepseek) ? source.deepseek : {}
  const edge = source.edge && typeof source.edge === 'object' && !Array.isArray(source.edge) ? source.edge : {}
  const local = source.local && typeof source.local === 'object' && !Array.isArray(source.local) ? source.local : {}
  const provider = TTS_PROVIDERS.includes(source.provider) ? source.provider : DEFAULT_SETTINGS.provider
  return {
    provider,
    voice: cleanText(source.voice, TTS_LIMITS.maxVoiceLength),
    speed: Math.round(clampNumber(source.speed, 0.5, 2, DEFAULT_SETTINGS.speed) * 100) / 100,
    autoPageTurn: source.autoPageTurn !== false,
    autoVoice: source.autoVoice !== false,
    deepseek: {
      voice: DEEPSEEK_VOICES.some((voice) => voice.id === deepseek.voice) ? deepseek.voice : 'stella',
    },
    openai: {
      baseUrl: cleanUrl(openai.baseUrl),
      model: cleanText(openai.model, TTS_LIMITS.maxModelLength) || 'FunAudioLLM/CosyVoice2-0.5B',
      voice: cleanText(openai.voice, TTS_LIMITS.maxVoiceLength) || 'anna',
      format: OPENAI_FORMATS.has(openai.format) ? openai.format : 'mp3',
    },
    edge: {
      voice: cleanText(edge.voice, TTS_LIMITS.maxVoiceLength),
      pitch: Math.round(clampNumber(edge.pitch, -50, 50, 0)),
    },
    // Placeholder for a future on-device engine: persisted so the UI can round
    // trip, but nothing reads it yet.
    local: {
      endpoint: cleanUrl(local.endpoint),
      model: cleanText(local.model, TTS_LIMITS.maxModelLength),
      voice: cleanText(local.voice, TTS_LIMITS.maxVoiceLength),
      device: ['cpu', 'gpu'].includes(local.device) ? local.device : 'cpu',
    },
  }
}

export { clampNumber, cleanText }
