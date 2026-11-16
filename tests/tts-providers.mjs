// Provider adapters are the only place that talks to a speech service. Pin the
// request shape and the error mapping here so a provider change cannot silently
// break playback in the browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEEPSEEK_TTS_URL, TtsError, sanitizeTtsSettings } from '../tts.js'

async function withService(t, { platform = process.platform, fetchImpl, run, resolveSecret, websocket } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-tts-provider-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { createTtsService } = await import('../tts.js')
  const service = createTtsService({
    rootDir: root,
    platform,
    fetchImpl: fetchImpl || (async () => { throw new Error('unexpected fetch') }),
    run,
    resolveSecret: resolveSecret || (async () => ''),
    websocket,
    logger: { warn() {}, info() {}, error() {} },
  })
  await service.load()
  return { root, service }
}

test('deepseek sends the documented request and returns WAV bytes', async t => {
  const calls = []
  const { service } = await withService(t, {
    resolveSecret: async () => 'sk-test',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response(Buffer.from('RIFFwav'), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      })
    },
  })
  const result = await service.synthesize({ provider: 'deepseek', voice: 'tide', text: '你好。', speed: 1 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, DEEPSEEK_TTS_URL)
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: '你好。', voice_id: 'tide', format: 'wav' })
  assert.equal(result.mime, 'audio/wav')
  assert.equal(result.audio.toString(), 'RIFFwav')
  assert.equal(result.cached, false)
})

test('deepseek maps provider failures to actionable errors', async t => {
  const respond = (status, body) => async () => new Response(JSON.stringify({ error: { message: body } }), { status })
  for (const [status, expected] of [[400, 422], [429, 429], [503, 503], [401, 403]]) {
    const { service } = await withService(t, { resolveSecret: async () => 'sk', fetchImpl: respond(status, 'risk') })
    await assert.rejects(
      () => service.synthesize({ provider: 'deepseek', text: '测试。' }),
      error => error instanceof TtsError && error.status === expected,
    )
  }
  const { service } = await withService(t, { resolveSecret: async () => '', fetchImpl: respond(200, '') })
  await assert.rejects(
    () => service.synthesize({ provider: 'deepseek', text: '测试。' }),
    error => error instanceof TtsError && error.status === 403,
  )
})

test('openai-compatible provider builds the speech request from settings', async t => {
  let seen
  const { service } = await withService(t, {
    resolveSecret: async name => (name === 'openai' ? 'sk-openai' : ''),
    fetchImpl: async (url, init) => {
      seen = { url, body: JSON.parse(init.body), auth: init.headers.authorization }
      return new Response(Buffer.from('ID3mp3'), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    },
  })
  await service.updateSettings({
    provider: 'openai',
    openai: { baseUrl: 'https://api.siliconflow.cn/v1/', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'anna', format: 'mp3' },
  })
  const result = await service.synthesize({ provider: 'openai', voice: 'bella', text: 'Hello.', speed: 1.25 })
  assert.equal(seen.url, 'https://api.siliconflow.cn/v1/audio/speech')
  assert.equal(seen.auth, 'Bearer sk-openai')
  assert.deepEqual(seen.body, {
    model: 'FunAudioLLM/CosyVoice2-0.5B', input: 'Hello.', voice: 'bella', response_format: 'mp3', speed: 1.25,
  })
  assert.equal(result.mime, 'audio/mpeg')
  assert.equal(result.ext, '.mp3')
})

test('repeat requests hit the cache instead of the provider', async t => {
  let calls = 0
  const { service } = await withService(t, {
    resolveSecret: async () => 'sk',
    fetchImpl: async () => {
      calls += 1
      return new Response(Buffer.from('RIFFwav'), { status: 200 })
    },
  })
  const first = await service.synthesize({ provider: 'deepseek', text: '缓存命中。', speed: 1 })
  const second = await service.synthesize({ provider: 'deepseek', text: '缓存命中。', speed: 1 })
  assert.equal(calls, 1)
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.deepEqual([...second.audio], [...first.audio])
  // A different speed or voice is a different cache entry.
  await service.synthesize({ provider: 'deepseek', text: '缓存命中。', speed: 1.5 })
  await service.synthesize({ provider: 'deepseek', voice: 'tide', text: '缓存命中。', speed: 1 })
  assert.equal(calls, 3)
})

test('macos provider synthesises through say and cleans up', async t => {
  const commands = []
  const { root, service } = await withService(t, {
    platform: 'darwin',
    run: async (command, args) => {
      commands.push({ command, args })
      if (args[0] === '-v' && args[1] === '?') {
        return { stdout: 'Tingting (中文（中国大陆）)     zh_CN    # 你好！我叫婷婷。\nSamantha (English (US))  en_US  # Hello.\n' }
      }
      return { stdout: '' }
    },
  })
  const voices = await service.voices('macos')
  assert.equal(voices.length, 2)
  // The display name is the id because `say` reuses names across locales.
  assert.equal(voices[0].id, 'Tingting (中文（中国大陆）)')
  assert.equal(voices[0].lang, 'zh-CN')
  assert.equal(voices[1].id, 'Samantha (English (US))')
  assert.equal(voices[1].lang, 'en-US')
  assert.ok(commands.every(call => call.command === '/usr/bin/say'))

  // synthesize needs the file written by run; a second service does that.
  const { writeFile } = await import('node:fs/promises')
  const { createTtsService } = await import('../tts.js')
  const writer = createTtsService({
    rootDir: join(root, 'writer'),
    platform: 'darwin',
    run: async (command, args) => {
      const out = args[args.indexOf('-o') + 1]
      await writeFile(out, Buffer.from('RIFFwav'))
      commands.push({ command, args })
      return { stdout: '' }
    },
  })
  await writer.load()
  const result = await writer.synthesize({ provider: 'macos', voice: 'Tingting (中文（中国大陆）)', text: '你好。', speed: 1 })
  assert.equal(result.mime, 'audio/wav')
  assert.equal(result.audio.toString(), 'RIFFwav')
  const sayCall = commands.find(call => call.args.includes('-o'))
  assert.ok(sayCall.args.includes('--data-format=LEI16@22050'))
  assert.ok(sayCall.args.includes('Tingting (中文（中国大陆）)'), 'the locale-specific voice is spoken verbatim')
  assert.ok(sayCall.args.includes('-r'))
  assert.equal(sayCall.args[sayCall.args.length - 1], '你好。')
})

test('a missing macOS voice fails loudly instead of switching language', async t => {
  const calls = []
  const run = async (command, args) => {
    if (args[0] === '-v' && args[1] === '?') return { stdout: 'Tingting (中文（中国大陆）)  zh_CN  # 你好。\n' }
    calls.push(args)
    if (args.includes('-v')) throw new Error('Voice not found')
    const out = args[args.indexOf('-o') + 1]
    const { writeFile } = await import('node:fs/promises')
    await writeFile(out, Buffer.from('RIFFdefault'))
    return { stdout: '' }
  }
  const { service } = await withService(t, { platform: 'darwin', run })
  await assert.rejects(
    () => service.synthesize({ provider: 'macos', voice: 'NoSuchVoice (xx_XX)', text: '回退。', speed: 1 }),
    /本机语音合成失败/,
  )
  assert.equal(calls.length, 1, 'no silent fallback to the system voice')
})

test('edge provider drives the read-aloud websocket protocol', async t => {
  const sockets = []
  class FakeSocket {
    constructor(url, options) {
      this.url = url
      this.options = options
      this.sent = []
      this.closed = false
      sockets.push(this)
    }
    send(value) { this.sent.push(value) }
    close() { this.closed = true }
  }
  const { service } = await withService(t, { platform: 'linux', websocket: FakeSocket })
  const synth = service.synthesize({ provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural', text: '你好。', speed: 1.25 })
  // The provider fetches a token and waits for settings before it opens the
  // socket; one macrotask is not enough under a loaded runner.
  const started = Date.now()
  while (sockets.length === 0 && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(sockets.length, 1)
  const socket = sockets[0]
  assert.ok(socket.url.startsWith('wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?'))
  assert.ok(socket.url.includes('Ocp-Apim-Subscription-Key='))
  assert.match(socket.url, /Sec-MS-GEC=[0-9A-F]{64}/)
  assert.match(socket.url, /Sec-MS-GEC-Version=1-/)
  assert.match(socket.url, /ConnectionId=[0-9a-f]{32}/)
  assert.equal(socket.options.headers.Origin, 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold')
  assert.ok(socket.options.headers['User-Agent'].includes('Edg/'))
  socket.onopen()
  assert.equal(socket.sent.length, 2)
  assert.ok(socket.sent[0].includes('Path:speech.config'))
  assert.ok(socket.sent[0].includes('audio-24khz-48kbitrate-mono-mp3'))
  assert.ok(socket.sent[0].includes('"wordBoundaryEnabled":"true"'))
  assert.ok(!socket.sent[0].includes('X-Timestamp'), 'the endpoint rejects a timestamp header')
  assert.ok(socket.sent[1].includes('Path:ssml'))
  assert.ok(socket.sent[1].includes('xml:lang="zh-CN"'))
  assert.ok(socket.sent[1].includes('name="zh-CN-XiaoxiaoNeural"'))
  assert.ok(socket.sent[1].includes('rate="+25%"'))
  assert.ok(socket.sent[1].includes('你好。'))
  const audio = Buffer.alloc(200, 7)
  socket.onmessage({ data: Buffer.concat([Buffer.from('X-RequestId:1\r\nPath:audio\r\n'), audio]) })
  socket.onmessage({ data: 'X-RequestId:1\r\nPath:turn.end\r\n\r\n' })
  const result = await synth
  assert.equal(result.mime, 'audio/mpeg')
  assert.equal(result.ext, '.mp3')
  assert.equal(result.audio.length, 200)
  assert.equal(result.audio[0], 7)
  assert.equal(socket.closed, true)
})

test('edge does not retry a removed voice', async t => {
  const sockets = []
  class FakeSocket {
    constructor() {
      this.closed = false
      this.sent = []
      sockets.push(this)
    }
    send(value) { this.sent.push(value) }
    close() { this.closed = true }
  }
  const { service } = await withService(t, { platform: 'linux', websocket: FakeSocket })
  const synth = service.synthesize({ provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural', text: '你好。', speed: 1 })
  // The provider fetches a token and waits for settings before it opens the
  // socket; a single macrotask is not enough under a loaded test runner.
  const started = Date.now()
  while (sockets.length === 0 && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(sockets[0], 'edge socket was created')
  sockets[0].onclose({ code: 1007, reason: 'Unsupported voice' })
  await assert.rejects(() => synth, /Unsupported voice|1007/)
  assert.equal(sockets.length, 1)
})

test('edge gec token rolls over on a five minute window', async () => {
  const { edgeGecToken } = await import('../tts.js')
  const base = Date.UTC(2026, 10, 16, 12, 0, 0)
  assert.equal(edgeGecToken(base), edgeGecToken(base + 60_000))
  assert.notEqual(edgeGecToken(base), edgeGecToken(base + 6 * 60_000))
  assert.match(edgeGecToken(base), /^[0-9A-F]{64}$/)
})

test('windows system voices are listed and spoken through SAPI', async t => {
  const { writeFile } = await import('node:fs/promises')
  const commands = []
  const { service } = await withService(t, {
    platform: 'win32',
    run: async (command, args) => {
      commands.push({ command, args })
      const script = args[args.indexOf('-Command') + 1] || ''
      if (script.includes('GetInstalledVoices')) {
        return { stdout: JSON.stringify([
          { name: 'Microsoft Huihui Desktop', culture: 'zh-CN', gender: 'Female' },
          { name: 'Microsoft David Desktop', culture: 'en-US', gender: 'Male' },
        ]) }
      }
      const match = /SetOutputToWaveFile\('([^']+)'\)/.exec(script)
      if (match) await writeFile(match[1], Buffer.from('RIFFwindows'))
      return { stdout: '' }
    },
  })
  const voices = await service.voices('windows')
  assert.equal(voices.length, 2)
  assert.equal(voices[0].id, 'Microsoft Huihui Desktop')
  assert.equal(voices[0].lang, 'zh-CN')
  assert.equal(voices[1].lang, 'en-US')
  assert.ok(commands.every(call => call.command === 'powershell.exe'))

  const result = await service.synthesize({ provider: 'windows', voice: 'Microsoft Huihui Desktop', text: '你好。', speed: 1.5 })
  assert.equal(result.mime, 'audio/wav')
  assert.equal(result.audio.toString(), 'RIFFwindows')
  const sayScript = commands[commands.length - 1].args[commands.commands ? 0 : commands.length - 1]
})

test('the Windows provider only runs on Windows and carries the SAPI rate', async t => {
  const { writeFile } = await import('node:fs/promises')
  const scripts = []
  const { service } = await withService(t, {
    platform: 'win32',
    run: async (command, args) => {
      const script = args[args.indexOf('-Command') + 1] || ''
      scripts.push(script)
      const match = /SetOutputToWaveFile\('([^']+)'\)/.exec(script)
      if (match) await writeFile(match[1], Buffer.from('RIFFwindows'))
      return { stdout: '' }
    },
  })
  await service.synthesize({ provider: 'windows', voice: "Reader's voice", text: 'It sounded like a bell, didn\'t it?', speed: 0.5 })
  const script = scripts[scripts.length - 1]
  assert.ok(script.includes('SelectVoice(\'Reader\'\'s voice\')'), 'voice name is quoted safely')
  assert.ok(script.includes('$s.Rate = -5'), 'speed 0.5 maps to SAPI rate -5')
  assert.ok(script.includes('$s.Speak(\'It sounded like a bell, didn\'\'t it?\')'), 'text is quoted safely')

  const { service: darwinService } = await withService(t, { platform: 'darwin', run: async () => ({ stdout: '' }) })
  await assert.rejects(
    () => darwinService.synthesize({ provider: 'windows', voice: '', text: '你好。', speed: 1 }),
    /当前系统上不可用/,
  )
})

test('settings follow the platform when the saved provider is foreign', async t => {
  const { root } = await withService(t, { platform: 'darwin', run: async () => ({ stdout: '' }) })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(root, 'tts.json'), JSON.stringify({ settings: { provider: 'windows', voice: 'Microsoft Huihui Desktop' } }))
  const { createTtsService } = await import('../tts.js')
  const onWindows = createTtsService({ rootDir: root, platform: 'win32', run: async () => ({ stdout: '' }) })
  await onWindows.load()
  assert.equal(onWindows.getSettings().provider, 'windows')
  const onMac = createTtsService({ rootDir: root, platform: 'darwin', run: async () => ({ stdout: '' }) })
  await onMac.load()
  assert.equal(onMac.getSettings().provider, 'macos', 'a foreign provider falls back to the platform default')
  assert.equal(onMac.getSettings().voice, '')
})

test('local model provider is a saved placeholder that cannot speak yet', async t => {
  const { service } = await withService(t, { platform: 'darwin', run: async () => ({ stdout: '' }) })
  const listed = await service.capabilities()
  const local = listed.providers.find(item => item.id === 'local')
  assert.ok(local, 'local provider is advertised')
  assert.equal(local.configured, false)
  assert.equal((await service.voices('local')).length, 1)
  await assert.rejects(
    () => service.synthesize({ provider: 'local', voice: 'default', text: '你好。', speed: 1 }),
    /尚未实现/,
  )
  const updated = await service.updateSettings({ local: { endpoint: 'http://127.0.0.1:8000', model: 'piper', voice: 'x', device: 'gpu' } })
  assert.deepEqual(updated.local, { endpoint: 'http://127.0.0.1:8000', model: 'piper', voice: 'x', device: 'gpu' })
})

test('every provider is listed with language metadata and availability', async t => {
  const { service } = await withService(t, {
    platform: 'darwin',
    run: async (command, args) => {
      if (args[0] === '-v' && args[1] === '?') {
        return { stdout: 'Tingting (中文（中国大陆）)  zh_CN  # 你好。\nReed (德语（德国）)  de_DE  # Hallo.\nReed (英语（美国）)  en_US  # Hello.\n' }
      }
      return { stdout: '' }
    },
  })
  const capabilities = await service.capabilities()
  assert.deepEqual(capabilities.providers.map(item => item.id), ['macos', 'windows', 'edge', 'deepseek', 'openai', 'local'])
  assert.equal(capabilities.platform, 'darwin')
  assert.equal(capabilities.defaultProvider, 'macos')
  const macos = capabilities.providers.find(item => item.id === 'macos')
  assert.equal(macos.available, true)
  assert.equal(macos.voices.length, 3)
  assert.equal(new Set(macos.voices.map(voice => voice.id)).size, 3, 'Reed keeps one id per locale')
  const windows = capabilities.providers.find(item => item.id === 'windows')
  assert.equal(windows.available, false)
  const edge = capabilities.providers.find(item => item.id === 'edge')
  assert.equal(edge.available, true)
  assert.ok(edge.voices.length > 5)
  for (const provider of capabilities.providers) {
    for (const voice of provider.voices) {
      assert.equal(typeof voice.lang, 'string')
      assert.ok(voice.lang.length > 0)
    }
  }
})

test('rejects unknown providers and oversized or empty text', async t => {
  const { service } = await withService(t, { platform: 'darwin', run: async () => ({ stdout: '' }) })
  await assert.rejects(() => service.synthesize({ provider: 'nope', text: 'x' }), error => error.status === 400)
  await assert.rejects(() => service.synthesize({ provider: 'macos', text: '' }), error => error.status === 400)
  await assert.rejects(() => service.synthesize({ provider: 'macos', text: 'x'.repeat(1001) }), error => error.status === 413)
})

test('settings sanitisation clamps every field', () => {
  assert.deepEqual(sanitizeTtsSettings(undefined), {
    provider: 'macos', voice: '', speed: 1, autoPageTurn: true, autoVoice: true,
    deepseek: { voice: 'stella' },
    openai: { baseUrl: '', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'anna', format: 'mp3' },
    edge: { voice: '', pitch: 0 },
    local: { endpoint: '', model: '', voice: '', device: 'cpu' },
  })
  const cleaned = sanitizeTtsSettings({
    provider: 'nope', voice: '  ', speed: 9, autoPageTurn: 'no',
    deepseek: { voice: 'ghost' },
    openai: { baseUrl: 'ftp://x', model: '', voice: '', format: 'ogg' },
  })
  assert.equal(cleaned.provider, 'macos')
  assert.equal(cleaned.voice, '')
  assert.equal(cleaned.speed, 2)
  assert.equal(cleaned.autoPageTurn, true)
  assert.equal(cleaned.autoVoice, true)
  assert.equal(cleaned.deepseek.voice, 'stella')
  assert.equal(cleaned.openai.baseUrl, '')
  assert.equal(cleaned.openai.format, 'mp3')
  const trimmed = sanitizeTtsSettings({ openai: { baseUrl: 'https://example.com/v1///' } })
  assert.equal(trimmed.openai.baseUrl, 'https://example.com/v1')
})

test('synthesised settings persist across a reload', async t => {
  const { root, service } = await withService(t, { platform: 'darwin', run: async () => ({ stdout: '' }) })
  await service.updateSettings({ provider: 'openai', voice: 'nova', speed: 1.5, autoPageTurn: false })
  const { createTtsService } = await import('../tts.js')
  const reopened = createTtsService({ rootDir: root, platform: 'darwin', run: async () => ({ stdout: '' }) })
  await reopened.load()
  assert.deepEqual(reopened.getSettings(), {
    provider: 'openai', voice: 'nova', speed: 1.5, autoPageTurn: false, autoVoice: true,
    deepseek: { voice: 'stella' },
    openai: { baseUrl: '', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'anna', format: 'mp3' },
    edge: { voice: '', pitch: 0 },
    local: { endpoint: '', model: '', voice: '', device: 'cpu' },
  })
})
