// Whole-book audiobook HTTP surface with an injected DeepSeek transport. The
// fixture books are tiny, so the suite proves the whole path without producing a
// real audiobook or spending credit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from '../assets/fflate.mjs'
import { DEEPSEEK_TTS_URL } from '../tts.js'
import { apply } from '../index.js'

function makeWav(samples = 6) {
  const data = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) data.writeInt16LE(index * 10, index * 2)
  const buffer = Buffer.alloc(44 + data.length)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + data.length, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24)
  buffer.writeUInt32LE(48000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(data.length, 40)
  data.copy(buffer, 44)
  return buffer
}

function tinyEpub(title) {
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'book.opf': strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">audio-book</dc:identifier><dc:title>${title}</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>`),
    'one.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>第一句话。第二句话。</p></body></html>'),
  })
}

test('audiobook routes plan, render, download and delete with a stubbed provider', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-audiobook-api-'))
  const owned = await realpath(temporary)
  const previousHome = process.env.DSH_HOME
  const previousKey = process.env.DEEPSEEK_API_KEY
  process.env.DSH_HOME = join(temporary, 'home')
  process.env.DEEPSEEK_API_KEY = 'test-key'
  const calls = []
  let route
  apply(
    {
      effect: fn => fn(),
      webServer: { register(value) { route = value; return () => {} } },
      logger: { info() {}, warn() {}, error() {} },
    },
    {
      tts: {
        platform: 'win32',
        fetchImpl: async (url, init) => {
          calls.push({ url, body: JSON.parse(init.body) })
          return new Response(makeWav(8), { status: 200, headers: { 'content-type': 'audio/wav' } })
        },
      },
    },
  )
  const server = createServer((request, response) => route.handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    assert.equal(await realpath(temporary), owned)
    await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousKey
  })

  const origin = `http://127.0.0.1:${server.address().port}/bookshelf/api`
  const json = async (path, options = {}) => {
    const response = await fetch(origin + path, options)
    const text = await response.text()
    return { status: response.status, payload: text.startsWith('{') ? JSON.parse(text) : undefined }
  }
  const post = (path, body) => fetch(origin + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const imported = await fetch(`${origin}/books?name=audio.epub&title=Audio&format=epub`, { method: 'POST', body: tinyEpub('Audio') })
  assert.equal(imported.status, 201)
  const book = (await imported.json()).book

  const planned = await json(`/books/${book.id}/audio/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '第一句话。第二句话。', voice: 'tide', speed: 1 }),
  })
  assert.equal(planned.status, 200)
  assert.equal(planned.payload.plan.sentences, 2)
  assert.equal(planned.payload.plan.voice, 'tide')
  assert.ok(planned.payload.plan.cost > 0)
  assert.equal(planned.payload.plan.currency, 'CNY')
  assert.equal(calls.length, 0, 'planning never calls the provider')

  // Re-estimating with another voice/speed reuses the stored book text, so the
  // browser does not have to upload it again after every option change.
  const replanned = await json(`/books/${book.id}/audio/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voice: 'stella', speed: 2 }),
  })
  assert.equal(replanned.status, 200)
  assert.equal(replanned.payload.plan.voice, 'stella')
  assert.equal(replanned.payload.plan.speed, 2)
  assert.equal(replanned.payload.plan.sentences, 2)
  assert.ok(replanned.payload.plan.durationSeconds < planned.payload.plan.durationSeconds)

  // A non-DeepSeek service is available for preview but must not invent a bill.
  const unpriced = await json(`/books/${book.id}/audio/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'windows', voice: '', speed: 1 }),
  })
  assert.equal(unpriced.status, 200)
  assert.equal(unpriced.payload.plan.provider, 'windows')
  assert.equal(unpriced.payload.plan.priced, false)
  assert.equal(unpriced.payload.plan.cost, null)
  assert.equal(unpriced.payload.plan.format, 'wav')

  assert.equal((await json(`/books/${book.id}/audio/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voice: 'tide', speed: 1 }),
  })).status, 200)

  let state
  for (let attempt = 0; attempt < 200; attempt += 1) {
    state = (await json(`/books/${book.id}/audio`)).payload.state
    if (state.status === 'done' || state.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.equal(state.status, 'done', state.error)
  assert.equal(state.done, 2)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, DEEPSEEK_TTS_URL)
  assert.equal(calls[0].body.voice_id, 'tide')

  const download = await fetch(`${origin}/books/${book.id}/audio/file`)
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('content-type'), 'audio/wav')
  assert.match(download.headers.get('content-disposition'), /inline/)
  const bytes = Buffer.from(await download.arrayBuffer())
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(bytes.readUInt32LE(40), 16 * 2)
  assert.equal(download.headers.get('accept-ranges'), 'bytes')

  // Media elements stream with byte ranges; the reader relies on this to seek.
  const ranged = await fetch(`${origin}/books/${book.id}/audio/file`, { headers: { range: 'bytes=0-43' } })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-range'), `bytes 0-43/${bytes.length}`)
  assert.equal(ranged.headers.get('content-length'), '44')
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString('ascii', 0, 4), 'RIFF')
  const tooWide = await fetch(`${origin}/books/${book.id}/audio/file`, { headers: { range: `bytes=${bytes.length}-` } })
  assert.equal(tooWide.status, 416)

  assert.equal((await json(`/books/${book.id}/audio`, { method: 'DELETE' })).status, 200)
  assert.equal((await fetch(`${origin}/books/${book.id}/audio/file`)).status, 404)
  assert.equal((await json('/books/00000000-0000-0000-0000-000000000000/audio/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好。' }),
  })).status, 404)
  assert.equal((await post(`/books/${book.id}/audio/plan`, { text: '   ' })).status, 400)
})
