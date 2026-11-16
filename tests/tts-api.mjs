// The read-aloud HTTP surface: the browser sends one sentence and gets audio
// bytes back; settings and secrets stay on the Host. Providers are injected so
// no test ever reaches a real speech service.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

function makeRun() {
  return async (command, args) => {
    if (args[0] === '-v' && args[1] === '?') {
      return { stdout: 'Tingting (中文（中国大陆）)     zh_CN    # 你好！我叫婷婷。\nMeijia (中文（台湾）)  zh_TW  # 你好，我叫美佳。\n' }
    }
    const out = args[args.indexOf('-o') + 1]
    if (typeof out === 'string' && out.endsWith('.wav')) {
      await writeFile(out, Buffer.from('RIFFmockwav'))
    }
    return { stdout: '' }
  }
}

test('read-aloud routes expose capabilities, audio bytes and settings', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-tts-api-'))
  const owned = await realpath(temporary)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(temporary, 'home')
  let route
  apply(
    {
      effect: fn => fn(),
      webServer: { register(value) { route = value; return () => {} } },
      logger: { info() {}, warn() {}, error() {} },
    },
    { tts: { platform: 'darwin', run: makeRun() } },
  )
  const server = createServer((request, response) => route.handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    assert.equal(await realpath(temporary), owned)
    await rm(owned, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  const origin = `http://127.0.0.1:${server.address().port}/bookshelf/api`
  const json = async (path, options = {}) => {
    const response = await fetch(origin + path, options)
    const text = await response.text()
    return { status: response.status, text, payload: text.startsWith('{') ? JSON.parse(text) : undefined }
  }
  const send = (method, path, body) => fetch(origin + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const synthesize = (body) => fetch(origin + '/tts/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  // Capabilities describe every provider without leaking any secret.
  const capabilities = await json('/tts/capabilities')
  assert.equal(capabilities.status, 200)
  assert.deepEqual(capabilities.payload.providers.map(provider => provider.id), ['macos', 'windows', 'edge', 'deepseek', 'openai', 'local'])
  const providerById = Object.fromEntries(capabilities.payload.providers.map(provider => [provider.id, provider]))
  assert.equal(providerById.macos.configured, true)
  assert.equal(providerById.macos.available, true)
  assert.equal(providerById.windows.configured, false)
  assert.equal(providerById.windows.available, false)
  assert.equal(providerById.edge.available, true)
  assert.equal(providerById.local.configured, false)
  assert.equal(capabilities.payload.defaultProvider, 'macos')
  assert.deepEqual(capabilities.payload.settings, {
    provider: 'macos', voice: '', speed: 1, autoPageTurn: true, autoVoice: true,
    deepseek: { voice: 'stella' },
    openai: { baseUrl: '', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'anna', format: 'mp3' },
    edge: { voice: '', pitch: 0 },
    local: { endpoint: '', model: '', voice: '', device: 'cpu' },
  })
  assert.deepEqual(capabilities.payload.secrets, { deepseek: false, openai: false })
  assert.equal(capabilities.payload.cache.entries, 0)

  // The macOS voice list comes from the injected `say -v '?'`.
  const voices = await json('/tts/voices?provider=macos')
  assert.deepEqual(voices.payload.voices.map(voice => voice.id), ['Tingting (中文（中国大陆）)', 'Meijia (中文（台湾）)'])
  assert.equal(voices.payload.voices[0].lang, 'zh-CN')
  assert.equal(voices.payload.voices[1].lang, 'zh-TW')

  // One sentence in, one same-origin audio URL out (blob: media is blocked by
  // the host page CSP), and the URL serves the cached bytes.
  const first = await synthesize({ provider: 'macos', voice: 'Tingting (中文（中国大陆）)', text: '第一句。', speed: 1 })
  assert.equal(first.status, 200)
  const firstPayload = await first.json()
  assert.equal(firstPayload.mime, 'audio/wav')
  assert.equal(firstPayload.cached, false)
  assert.match(firstPayload.url, /^\/bookshelf\/api\/tts\/audio\/[0-9a-f]{64}\.wav$/)
  const serverOrigin = `http://127.0.0.1:${server.address().port}`
  const audioResponse = await fetch(serverOrigin + firstPayload.url)
  assert.equal(audioResponse.status, 200)
  assert.equal(audioResponse.headers.get('content-type'), 'audio/wav')
  assert.equal(Buffer.from(await audioResponse.arrayBuffer()).toString(), 'RIFFmockwav')
  assert.equal((await fetch(serverOrigin + '/bookshelf/api/tts/audio/' + '0'.repeat(64) + '.wav')).status, 404)
  assert.equal((await fetch(serverOrigin + '/bookshelf/api/tts/audio/not-a-hash.wav')).status, 404)
  const second = await synthesize({ provider: 'macos', voice: 'Tingting (中文（中国大陆）)', text: '第一句。', speed: 1 })
  assert.equal((await second.json()).cached, true)

  // Validation failures carry actionable statuses.
  assert.equal((await synthesize({ provider: 'macos', text: '' })).status, 400)
  assert.equal((await synthesize({ provider: 'macos', text: 'x'.repeat(1001) })).status, 413)
  assert.equal((await synthesize({ provider: 'ghost', text: 'x' })).status, 400)
  assert.equal((await send('POST', '/tts/synthesize', [])).status, 400)

  // Settings round-trip and persist to tts.json.
  const updated = await send('PUT', '/tts/settings', {
    settings: { provider: 'openai', voice: 'nova', speed: 1.5, autoPageTurn: false },
    secrets: { deepseek: 'sk-hidden' },
  })
  assert.equal(updated.status, 200)
  const saved = await (await fetch(origin + '/tts/settings')).json()
  assert.equal(saved.settings.provider, 'openai')
  assert.equal(saved.settings.voice, 'nova')
  assert.equal(saved.settings.speed, 1.5)
  const stored = JSON.parse(await readFile(join(process.env.DSH_HOME, 'bookshelf', 'tts.json'), 'utf8'))
  assert.equal(stored.settings.provider, 'openai')

  // The secret is stored but never echoed back.
  const afterSecret = await json('/tts/capabilities')
  assert.deepEqual(afterSecret.payload.secrets, { deepseek: true, openai: false })
  assert.equal(afterSecret.text.includes('sk-hidden'), false)

  // Cache can be cleared.
  const cleared = await (await fetch(origin + '/tts/cache', { method: 'DELETE' })).json()
  assert.deepEqual(cleared, { ok: true })
  assert.equal((await json('/tts/capabilities')).payload.cache.entries, 0)
})
