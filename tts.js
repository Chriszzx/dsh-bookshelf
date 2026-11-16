// Read-aloud support for the Host half.
//
// Audio is synthesised on the Host, never in the browser: provider keys stay
// here, Edge-style services need a server-side WebSocket, and every sentence is
// cached on disk so re-reading a page costs nothing. The browser only POSTs a
// sentence and plays the bytes it gets back.
//
// This module is the stable facade over `tts/`: every exported name and
// signature is unchanged for the Host routes and the tts-* unit tests.

export { TTS_PROVIDERS, TTS_LIMITS, DEEPSEEK_VOICES, sanitizeTtsSettings } from './tts/settings.js'
export { createTtsCache } from './tts/cache.js'
export { TtsError, DEEPSEEK_TTS_URL, EDGE_VOICES, edgeGecToken } from './tts/providers.js'
export { createTtsService } from './tts/service.js'
