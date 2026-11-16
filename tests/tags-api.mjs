// The tag API is the contract the shelf client relies on: definitions live in
// tags.json, assignments and status overrides on library records, and the list
// route merges progress into one effective status per book.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

test('tag definitions, assignments and status overrides round-trip through the Host', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-tags-api-'))
  const owned = await realpath(temporary)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(temporary, 'home')
  const home = process.env.DSH_HOME
  const warnings = []
  let route
  apply({
    effect: fn => fn(),
    webServer: { register(value) { route = value; return () => {} } },
    logger: { info() {}, warn(error) { warnings.push(String(error)) }, error() {} },
  })
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
    const payload = await response.json()
    return { status: response.status, payload }
  }
  const send = (method, path, body) => json(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const statePath = id => `/books/${id}/state`
  const books = async () => (await json('/books')).payload
  const bookOf = (payload, id) => payload.books.find(book => book.id === id)

  // Two imported books start with no tags and no progress at all.
  const first = (await json('/books?name=alpha.epub&title=Alpha&format=epub', { method: 'POST', body: 'alpha' })).payload.book
  const second = (await json('/books?name=beta.epub&title=Beta&format=epub', { method: 'POST', body: 'beta' })).payload.book
  let payload = await books()
  assert.deepEqual(payload.tags, [])
  assert.equal(bookOf(payload, first.id).status, 'unread')
  assert.equal(bookOf(payload, first.id).statusManual, false)
  assert.deepEqual(bookOf(payload, first.id).tags, [])
  assert.equal(typeof bookOf(payload, first.id).progress, 'object')

  // Progress alone moves the derived status to reading.
  assert.equal((await send('PUT', statePath(first.id), {
    progress: { format: 'epub', chapterIndex: 3, percent: 0.4, updatedAt: Date.now() },
  })).status, 200)
  payload = await books()
  assert.equal(bookOf(payload, first.id).status, 'reading')

  // Create, validate and rename definitions.
  const psychology = (await send('POST', '/tags', { name: ' 心理学 ' })).payload.tag
  assert.equal(psychology.name, '心理学')
  assert.equal((await send('POST', '/tags', { name: '心理学' })).status, 409)
  assert.equal((await send('POST', '/tags', { name: '已读完' })).status, 409)
  assert.equal((await send('POST', '/tags', { name: '   ' })).status, 400)
  assert.equal((await send('POST', '/tags', {})).status, 400)
  const closeReading = (await send('POST', '/tags', { name: '精读' })).payload.tag
  assert.equal((await json('/tags')).payload.tags.length, 2)

  assert.equal((await send('PATCH', `/tags/${psychology.id}`, { name: '心理学与认知' })).payload.tag.name, '心理学与认知')
  assert.equal((await send('PATCH', `/tags/${closeReading.id}`, { name: '心理学与认知' })).status, 409)
  assert.equal((await send('PATCH', '/tags/00000000-0000-4000-8000-000000000000', { name: '甲' })).status, 404)
  assert.equal((await send('PATCH', `/tags/${closeReading.id}`, { name: '已读完' })).status, 409)

  // Assignments keep the selected ids, deduplicate them and reject typos.
  let assigned = await send('PATCH', `/books/${first.id}`, { tags: [psychology.id, closeReading.id, psychology.id] })
  assert.equal(assigned.status, 200)
  assert.deepEqual(assigned.payload.book.tags, [psychology.id, closeReading.id])
  payload = await books()
  assert.deepEqual(bookOf(payload, first.id).tags, [psychology.id, closeReading.id])
  assert.deepEqual(bookOf(payload, second.id).tags, [])
  assert.equal((await send('PATCH', `/books/${first.id}`, { tags: ['00000000-0000-4000-8000-000000000000'] })).status, 400)
  assert.equal((await send('PATCH', `/books/${first.id}`, { tags: ['nope'] })).status, 400)
  assert.equal((await send('PATCH', `/books/${first.id}`, { tags: 'nope' })).status, 400)
  assert.equal((await send('PATCH', `/books/${first.id}`, {
    tags: Array.from({ length: 31 }, () => psychology.id),
  })).status, 400)

  // Finishing is explicit: the last page alone does not set the status, but a
  // manual mark outlives progress and only null restores the derived value.
  assert.equal((await send('PUT', statePath(first.id), {
    progress: { format: 'epub', chapterIndex: 9, percent: 1, updatedAt: Date.now() },
  })).status, 200)
  assert.equal(bookOf(await books(), first.id).status, 'reading')
  let overridden = await send('PATCH', `/books/${first.id}`, { status: 'finished' })
  assert.equal(overridden.payload.book.status, 'finished')
  assert.equal(overridden.payload.book.statusManual, true)
  payload = await books()
  assert.equal(bookOf(payload, first.id).status, 'finished')
  assert.equal((await send('PATCH', `/books/${first.id}`, { status: 'reading' })).payload.book.status, 'reading')
  assert.equal((await send('PATCH', `/books/${first.id}`, { status: 'nonsense' })).status, 400)
  const automatic = await send('PATCH', `/books/${first.id}`, { status: null })
  assert.equal(automatic.payload.book.status, 'reading')
  assert.equal(automatic.payload.book.statusManual, false)

  // Re-reading below the last page clears a finished override automatically,
  // while staying at the last page or saving only settings keeps it.
  assert.equal((await send('PATCH', `/books/${first.id}`, { status: 'finished' })).status, 200)
  assert.equal((await send('PUT', statePath(first.id), {
    settings: { fontSize: 16 },
  })).status, 200)
  payload = await books()
  assert.equal(bookOf(payload, first.id).status, 'finished')
  assert.equal((await send('PUT', statePath(first.id), {
    progress: { format: 'epub', chapterIndex: 9, percent: 0.999, updatedAt: Date.now() },
  })).status, 200)
  payload = await books()
  assert.equal(bookOf(payload, first.id).status, 'finished')
  assert.equal((await send('PUT', statePath(first.id), {
    progress: { format: 'epub', chapterIndex: 4, percent: 0.5, updatedAt: Date.now() },
  })).status, 200)
  payload = await books()
  assert.equal(bookOf(payload, first.id).status, 'reading')
  assert.equal(bookOf(payload, first.id).statusManual, false)
  const rereadLibrary = JSON.parse(await readFile(join(home, 'bookshelf', 'library.json'), 'utf8'))
  assert.equal('status' in rereadLibrary.books.find(book => book.id === first.id), false)

  // Deleting a tag strips its assignments everywhere and reports the count.
  const removed = await send('DELETE', `/tags/${psychology.id}`, undefined)
  assert.equal(removed.status, 200)
  assert.equal(removed.payload.affected, 1)
  assert.deepEqual(removed.payload.tag.name, '心理学与认知')
  assert.deepEqual((await json('/tags')).payload.tags.map(tag => tag.id), [closeReading.id])
  payload = await books()
  assert.deepEqual(bookOf(payload, first.id).tags, [closeReading.id])
  assert.equal((await send('DELETE', `/tags/${psychology.id}`, undefined)).status, 404)
  assert.equal((await send('DELETE', '/tags/not-a-tag-id', undefined)).status, 404)

  // Deleting a book must never remove tag definitions.
  assert.equal((await json(`/books/${first.id}`, { method: 'DELETE' })).status, 200)
  assert.deepEqual((await json('/tags')).payload.tags.map(tag => tag.id), [closeReading.id])

  // A damaged taxonomy file degrades the shelf instead of failing it, while
  // mutations keep reporting the real problem.
  await writeFile(join(home, 'bookshelf', 'tags.json'), '{not json')
  payload = await books()
  assert.deepEqual(payload.tags, [])
  assert.equal(bookOf(payload, second.id).status, 'unread')
  assert.equal((await send('POST', '/tags', { name: '新标签' })).status, 500)
  assert.ok(warnings.some(line => /tags\.json is not valid JSON/.test(line)))

  // Unknown ids left in a record by an older hand edit are hidden, not fatal.
  await writeFile(join(home, 'bookshelf', 'tags.json'), JSON.stringify({ version: 1, tags: [] }))
  const libraryPath = join(home, 'bookshelf', 'library.json')
  const library = JSON.parse(await readFile(libraryPath, 'utf8'))
  library.books = library.books.map(book => ({ ...book, tags: ['11111111-1111-4111-8111-111111111111'] }))
  await writeFile(libraryPath, JSON.stringify(library, null, 2))
  payload = await books()
  assert.deepEqual(bookOf(payload, second.id).tags, [])
})
