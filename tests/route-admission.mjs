import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouteHandler, exactRoute } from '../host/routes.js'
import { inject } from '../index.js'

test('bookshelf admits the DSH operator before dispatch, including asset and preflight requests', async () => {
  assert.ok(inject.includes('connection'))
  const requests = []
  let calls = 0
  const handler = createRouteHandler({
    connection: {
      admit(request) {
        requests.push(request)
        return request.admission
      },
    },
    http: { baseHeaders: () => ({}) },
    routes: [exactRoute(['/bookshelf/api/books', '/bookshelf/assets/fixture.mjs'], {
      GET(_req, res) { calls++; res.writeHead(200); res.end() },
      POST(_req, res) { calls++; res.writeHead(201); res.end() },
    })],
  })
  async function send(method, url, admission) {
    const request = { method, url, admission }
    const result = {}
    await handler(request, {
      writeHead(status, headers) { Object.assign(result, { status, headers }) },
      end() { result.ended = true },
    })
    assert.equal(requests.at(-1), request)
    assert.equal(result.ended, true)
    return result
  }
  assert.deepEqual(await send('POST', '/bookshelf/api/books', { rejection: 401 }), {
    status: 401, headers: { 'Cache-Control': 'no-store' }, ended: true,
  })
  assert.equal((await send('GET', '/bookshelf/assets/fixture.mjs', { rejection: 403 })).status, 403)
  assert.equal((await send('OPTIONS', '/bookshelf/api/books', { rejection: 403 })).status, 403)
  assert.equal((await send('GET', '/bookshelf/api/books', { peer: { principal: { kind: 'guest' } } })).status, 403)
  assert.equal((await send('GET', '/bookshelf/api/books', {})).status, 403)
  assert.equal(calls, 0)

  const owner = { peer: { principal: { kind: 'owner' } } }
  assert.equal((await send('GET', '/bookshelf/assets/fixture.mjs', owner)).status, 200)
  assert.equal((await send('OPTIONS', '/bookshelf/api/books', owner)).status, 204)
  assert.equal((await send('POST', '/bookshelf/api/books', { peer: {} })).status, 201)
  assert.equal(calls, 2)
})
