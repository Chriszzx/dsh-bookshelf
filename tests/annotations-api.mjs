// Host-side annotation persistence: `state.annotations` is stored next to
// bookmarks and settings, sanitised with the same shared model the Reader builds,
// and a malformed entry is dropped instead of failing the whole write.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

async function startHost(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-annotations-api-'))
  const owned = await realpath(temporary)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(temporary, 'home')
  let route
  apply({
    effect: fn => fn(),
    webServer: { register(value) { route = value; return () => {} } },
    logger: { info() {}, warn() {}, error() {} },
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

  const home = process.env.DSH_HOME
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
  const imported = await json('/books?name=alpha.epub&title=Alpha&format=epub', { method: 'POST', body: 'alpha' })
  assert.equal(imported.status, 201)
  return {
    home,
    book: imported.payload.book,
    statePath: `/books/${imported.payload.book.id}/state`,
    json,
    send,
  }
}

function annotation(overrides = {}) {
  return {
    id: 'an_test0001',
    type: 'highlight',
    chapterIndex: 2,
    start: 10,
    end: 24,
    quote: '第一处标注原文',
    prefix: '前文',
    suffix: '后文',
    color: '#FFD23F',
    strength: 0.5,
    thickness: 3,
    underlineStyle: 'dashed',
    createdAt: 1710000000000,
    ...overrides,
  }
}

test('annotation state round-trips without disturbing progress, bookmarks or settings', async t => {
  const { json, send, statePath, home, book } = await startHost(t)

  // Progress, bookmarks and settings are the baseline an annotation write must
  // leave alone.
  const baselinePut = await send('PUT', statePath, {
    progress: { chapterIndex: 4, percent: 0.25 },
    bookmarks: [{ id: 'bm_first0001', label: '第一页', format: 'epub', chapterIndex: 1, percent: 0.1, createdAt: 1700000000000 }],
    settings: { theme: 'dark', fontSize: 18 },
  })
  assert.equal(baselinePut.status, 200)
  const baseline = baselinePut.payload.state
  assert.equal(baseline.progress.chapterIndex, 4)
  assert.equal(baseline.bookmarks.length, 1)
  assert.equal(baseline.settings.theme, 'dark')

  // A legal annotation is normalised, echoed back and persisted to state.json.
  const put = await send('PUT', statePath, {
    annotations: [annotation({ quote: '  第一处标注原文  ', color: '#FFD23F' })],
  })
  assert.equal(put.status, 200)
  const stored = put.payload.state.annotations
  assert.deepEqual(stored, [{
    id: 'an_test0001',
    type: 'highlight',
    chapterIndex: 2,
    start: 10,
    end: 24,
    quote: '第一处标注原文',
    prefix: '前文',
    suffix: '后文',
    color: '#ffd23f',
    strength: 0.5,
    thickness: 3,
    underlineStyle: 'dashed',
    createdAt: 1710000000000,
    label: '第一处标注原文',
  }])

  // The annotations-only patch left the other fields exactly as they were.
  const after = (await json(statePath)).payload.state
  assert.deepEqual(after.progress, baseline.progress)
  assert.deepEqual(after.bookmarks, baseline.bookmarks)
  assert.deepEqual(after.settings, baseline.settings)
  assert.deepEqual(after.annotations, stored)

  const onDisk = JSON.parse(await readFile(join(home, 'bookshelf', 'state.json'), 'utf8'))
  assert.deepEqual(onDisk.books[book.id].annotations, stored)

  // Malformed entries are dropped one by one; the rest of the batch still lands.
  const mixed = await send('PUT', statePath, {
    annotations: [
      annotation({ id: 'an_keep0001', quote: '保留这一条' }),
      null,
      'not-an-object',
      42,
      { type: 'strikethrough', chapterIndex: 0, start: 0, end: 4, quote: '未知类型' },
      { type: 'highlight', chapterIndex: -1, start: 0, end: 4, quote: '负数章节' },
      { type: 'highlight', chapterIndex: 0, start: 5, end: 5, quote: '空范围' },
      { type: 'highlight', chapterIndex: 0, start: 0, end: 4, quote: '' },
      {
        type: 'highlight',
        chapterIndex: 0,
        start: 0,
        end: 4,
        quote: '颜色非法',
        color: 'javascript:alert(1)',
        strength: 99,
        thickness: -3,
        underlineStyle: 'zigzag',
      },
      { type: 'underline', chapterIndex: 1, start: 4, end: 9, quote: '第二条' },
      // The same id twice keeps only the first entry.
      { type: 'highlight', id: 'an_dup00001', chapterIndex: 2, start: 0, end: 3, quote: '重复甲' },
      { type: 'underline', id: 'an_dup00001', chapterIndex: 3, start: 0, end: 3, quote: '重复乙' },
    ],
  })
  assert.equal(mixed.status, 200)
  const kept = mixed.payload.state.annotations
  assert.deepEqual(kept.map(item => item.quote), ['保留这一条', '颜色非法', '第二条', '重复甲'])
  // Out-of-range style fields clamp to the documented bounds instead of failing
  // the entry, and an unknown colour falls back to the default.
  assert.equal(kept[1].color, '#ffd23f')
  assert.equal(kept[1].strength, 0.9)
  assert.equal(kept[1].thickness, 1)
  assert.equal(kept[1].underlineStyle, 'solid')

  // A non-array value is a client error, exactly like bookmarks.
  assert.equal((await send('PUT', statePath, { annotations: 'nope' })).status, 400)
  assert.equal((await send('PUT', statePath, { annotations: { 0: annotation() } })).status, 400)
  assert.equal((await send('PUT', statePath, { annotations: null })).status, 400)
  // Failed writes changed nothing.
  assert.deepEqual((await json(statePath)).payload.state.annotations, kept)

  // The per-book annotation style (plan §4.1) is kept with the other settings so
  // a selection created after a reload uses the same style.
  const stylePut = await send('PUT', statePath, {
    settings: {
      theme: 'dark',
      fontSize: 18,
      annotationStyle: { mode: 'underline', color: '#00ff88', strength: 0.6, thickness: 4, underlineStyle: 'wavy' },
    },
  })
  assert.equal(stylePut.status, 200)
  assert.deepEqual(stylePut.payload.state.settings.annotationStyle, {
    mode: 'underline',
    color: '#00ff88',
    strength: 0.6,
    thickness: 4,
    underlineStyle: 'wavy',
  })
  assert.equal(stylePut.payload.state.settings.theme, 'dark')
  const badStyle = await send('PUT', statePath, {
    settings: { annotationStyle: { mode: 'ghost', color: 'red', strength: 4, thickness: 99 } },
  })
  assert.equal(badStyle.status, 200)
  assert.deepEqual(badStyle.payload.state.settings.annotationStyle, {
    mode: 'highlight',
    color: '#ffd23f',
    strength: 0.9,
    thickness: 6,
    underlineStyle: 'solid',
  })
})

test('annotation lists are capped at 1000 entries per book', async t => {
  const { send, statePath, home, book } = await startHost(t)

  const many = Array.from({ length: 1200 }, (_, index) => ({
    type: index % 2 === 0 ? 'highlight' : 'underline',
    chapterIndex: index % 50,
    start: index * 4,
    end: index * 4 + 3,
    quote: `第${index}处标注`,
  }))
  const put = await send('PUT', statePath, { annotations: many })
  assert.equal(put.status, 200)
  assert.equal(put.payload.state.annotations.length, 1000)
  // Truncation keeps the first valid entries in order.
  assert.equal(put.payload.state.annotations[0].quote, '第0处标注')
  assert.equal(put.payload.state.annotations.at(-1).quote, '第999处标注')

  const onDisk = JSON.parse(await readFile(join(home, 'bookshelf', 'state.json'), 'utf8'))
  assert.equal(onDisk.books[book.id].annotations.length, 1000)
})
