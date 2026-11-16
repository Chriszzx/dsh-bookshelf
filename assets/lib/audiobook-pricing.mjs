// Whole-book audiobook estimation and billing rules. Pure functions: the Host
// service and the unit tests share them, and no filesystem or network access
// lives here.

import { splitSentences, normalizeSpeakText } from '../tts-sentences.mjs'
import { DEEPSEEK_VOICES } from '../../tts/settings.js'

export const AUDIOBOOK_PROVIDER = 'deepseek'
// System voices and Edge/OpenAI are also useful for a whole book, but only
// DeepSeek publishes a per-character price, so only it shows a cost estimate.
export const AUDIOBOOK_PROVIDERS = Object.freeze(['deepseek', 'edge', 'openai', 'windows', 'macos'])
const PROVIDER_FORMAT = Object.freeze({ deepseek: 'wav', macos: 'wav', windows: 'wav', edge: 'mp3', openai: 'mp3' })
// WAV is 24 kHz/16-bit/mono; Edge returns 48 kbps MP3 and the OpenAI-compatible
// services commonly return a similar low-bitrate MP3. Used only for estimates.
const BYTES_PER_SECOND = Object.freeze({ wav: 48_000, 'mp3-edge': 6_000, 'mp3-openai': 16_000 })

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

export function estimateAudiobook({ text, speed = 1, provider = AUDIOBOOK_PROVIDER } = {}) {
  const chosen = AUDIOBOOK_PROVIDERS.includes(provider) ? provider : AUDIOBOOK_PROVIDER
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
  const format = PROVIDER_FORMAT[chosen]
  const bytesPerSecond = format === 'mp3' ? BYTES_PER_SECOND[`mp3-${chosen}`] : BYTES_PER_SECOND.wav
  const bytes = Math.round((format === 'wav' ? 44 : 0) + seconds * bytesPerSecond)
  // Only DeepSeek has a published price; other services must not show a fake one.
  const priced = chosen === 'deepseek'
  const pricePer10k = DEEPSEEK_TTS_PRICING.promo ? DEEPSEEK_TTS_PRICING.promoPer10k : DEEPSEEK_TTS_PRICING.listPer10k
  return {
    provider: chosen,
    characters,
    billedCharacters: billed,
    sentences: sentences.length,
    durationSeconds: Math.round(seconds * 10) / 10,
    bytes,
    format,
    priced,
    cost: priced ? roundMoney((billed / 10_000) * pricePer10k) : null,
    listCost: priced ? roundMoney((billed / 10_000) * DEEPSEEK_TTS_PRICING.listPer10k) : null,
    currency: priced ? DEEPSEEK_TTS_PRICING.currency : null,
    pricePer10k: priced ? pricePer10k : null,
    listPricePer10k: priced ? DEEPSEEK_TTS_PRICING.listPer10k : null,
    promo: priced ? DEEPSEEK_TTS_PRICING.promo : false,
    sampleRate: format === 'wav' ? DEEPSEEK_TTS_PRICING.sampleRate : null,
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

export function sanitizeAudiobookProvider(value) {
  return AUDIOBOOK_PROVIDERS.includes(value) ? value : AUDIOBOOK_PROVIDER
}

export function sanitizeVoice(value, provider = AUDIOBOOK_PROVIDER) {
  if (provider === 'deepseek') {
    return DEEPSEEK_VOICES.some((voice) => voice.id === value) ? value : DEEPSEEK_VOICES[0].id
  }
  // Other providers accept a voice id or an empty string ("let the provider /
  // saved settings choose"); strip control characters and bound the length.
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 64)
}
