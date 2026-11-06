// The platform capability route must describe the Host's real platform and
// never expose the Apple Books import on non-macOS installations.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('capabilities declare the running platform and Apple Books availability', async t => {
  const home = await mkdtemp(join(tmpdir(), 'bookshelf-platform-'))
  const previousHome = process.env.DSH_HOME
  t.after(async () => {
    await rm(home, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  process.env.DSH_HOME = home
  let route
  const { apply } = await import('../index.js')
  apply({
    effect: fn => fn(),
    webServer: { register(value) { route = value; return () => {} } },
    logger: { info() {}, warn() {}, error() {} },
  })
  assert.equal(typeof route?.handler, 'function')
  const request = { method: 'GET', url: '/bookshelf/api/capabilities', headers: {} }
  const chunks = []
  const response = {
    headersSent: false,
    writeHead() {}, end(value) { chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value))) },
    on() {}, destroy() {},
  }
  await route.handler(request, response)
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  assert.equal(payload.platform, process.platform)
  assert.equal(payload.appleBooks, process.platform === 'darwin')
})
