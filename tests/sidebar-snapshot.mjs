// Focused Host tests for the bookshelf-owned right-sidebar page snapshot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceRevision } from '../source-revision.js'
import {
  createSidebarSnapshotCommand, parseSidebarSnapshot, sidebarSnapshotProjection as projection,
  ShelfSidebarSnapshotController, SIDEBAR_MARKER,
} from '../sidebar.js'

const bookId = 'acb7e520-cd57-4356-a96e-85e7b5dd08e8'
const revision = `shelf-file-v1:${'a'.repeat(64)}`
function snapshot(overrides = {}) {
  const text = '第一段😀。\n\nSecond paragraph.'
  return {
    version: 1, snapshotId: randomUUID(), bookId, title: 'Fixture', author: 'Author', sourceRevision: revision,
    documentID: 'OPS/chapter.xhtml', chapterTitle: 'Chapter 1', capturedAt: '2026-11-05T11:00:00.000Z',
    pageMode: 'paged', pageLabel: '1 / 12', coordinateKind: 'rendered-dom-text', extractionVersion: 'rendered-dom-text-v1',
    segments: [{ documentID: 'OPS/chapter.xhtml', start: 10, end: 10 + Array.from(text).length, text }], text,
    truncated: false, coverage: {
      kind: 'visible-text', physicalPageComplete: false, status: 'captured',
      limitations: ['Rendered DOM coordinates.'],
      limits: { maxCharacters: 16000, maxSegments: 256, maxJSONBytes: 262144, maxVisitedNodes: 30000, maxScannedCodeUnits: 2000000, maxGeometryQueries: 24000 },
    }, ...overrides,
  }
}
function fixture({ cwd, source, takeSnapshot = snapshot() } = {}) {
  let state = projection.init()
  const events = [], injected = []
  const publish = (event) => {
    event = { seq: events.length, time: Date.now(), ...event }
    events.push(structuredClone(event))
    state = projection.stateSchema.parse(projection.apply(state, event))
  }
  const agent = { session: { header: { cwd } }, inject(message) { injected.push(message) } }
  const projections = { stateOf: () => state }
  const verifier = source ?? { async verify() {}, async sourceInfo() { return null } }
  const controller = new ShelfSidebarSnapshotController(projections, undefined, verifier)
  async function run(value = takeSnapshot, { action = 'prepare', dropDone = false } = {}) {
    const commandId = randomUUID()
    publish({ type: 'command/run', data: { name: 'bookshelf-snapshot', commandId } })
    const result = await createSidebarSnapshotCommand(controller).handler({
      agent, commandId, rawInput: JSON.stringify({ action, snapshot: value }), signal: new AbortController().signal,
    })
    if (!dropDone) publish({ type: 'command/done', data: { commandId, ...result } })
    const valueOut = (() => { try { return JSON.parse(result.text) } catch { return null } })()
    return { ...result, value: valueOut }
  }
  return { agent, events, injected, publish, run, get state() { return state } }
}

test('prepare writes the page file and a display-only projection without injecting', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shelf-sidebar-prepare-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const value = snapshot()
  const f = fixture({ cwd: root, source: { async verify() {}, async sourceInfo(bookId) {
    return { originalPath: '/home/reader/Books/Fixture.epub', shelfPath: `/home/reader/.dsh/bookshelf/books/${bookId}.epub` }
  } } })
  const result = await f.run(value)
  assert.equal(result.kind, 'success')
  assert.equal(result.value.marker, SIDEBAR_MARKER)
  assert.equal(result.value.file.mention, `@.dsh-bookshelf/${value.snapshotId}.md`)
  assert.equal(f.state.snapshot.snapshotId, value.snapshotId)
  assert.equal(f.injected.length, 0)
  assert.equal(projection.wire.view(f.state).text, value.text)
  const content = await readFile(join(root, '.dsh-bookshelf', `${value.snapshotId}.md`), 'utf8')
  assert.match(content, /Original book file: \/home\/reader\/Books\/Fixture\.epub/)
  assert.match(content, /Shelf soft link: \/home\/reader\/\.dsh\/bookshelf\/books\//)
  assert.match(content, /Ask the user these three questions/)
  assert.match(content, /May I use web or network tools/)
  assert.match(content, /whole book/)
  assert.match(content, /own world knowledge/)
  assert.match(content, /第一段😀/)
  assert.ok(content.indexOf('Ask the user these three questions') < content.indexOf('第一段😀'))
})

test('prepare is idempotent after source deletion and rejects a different page', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shelf-sidebar-retry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let available = true, checks = 0
  const f = fixture({ cwd: root, source: {
    async verify() { checks++; if (!available) throw new Error('gone') },
    async sourceInfo() { return null },
  } })
  const value = snapshot()
  assert.equal((await f.run(value)).kind, 'success')
  available = false
  assert.equal((await f.run(value)).kind, 'success')
  assert.equal(checks, 1)
  assert.equal(f.injected.length, 0)
  assert.equal((await f.run(snapshot())).kind, 'error')
})

test('prepare requires a workspace and validates coordinates', async t => {
  const noWorkspace = fixture()
  const missing = await noWorkspace.run(snapshot())
  assert.equal(missing.kind, 'error')
  assert.match(missing.value.message, /workspace/)
  assert.equal(noWorkspace.injected.length, 0)

  const invalid = snapshot({ segments: [{ documentID: 'OPS/chapter.xhtml', start: 0, end: 3, text: 'long' }] })
  assert.throws(() => parseSidebarSnapshot(invalid), error => error.code === 'INVALID_SNAPSHOT')
  const complete = snapshot({ coverage: { ...snapshot().coverage, physicalPageComplete: true } })
  assert.throws(() => parseSidebarSnapshot(complete), error => error.code === 'INVALID_SNAPSHOT')
})

test('projection restores the page and file from command events', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shelf-sidebar-restore-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const value = snapshot()
  const first = fixture({ cwd: root })
  await first.run(value)
  let state = projection.init()
  for (const event of first.events) state = projection.stateSchema.parse(projection.apply(state, event))
  assert.equal(state.snapshot.snapshotId, value.snapshotId)
  assert.equal(state.file.mention, `@.dsh-bookshelf/${value.snapshotId}.md`)
  assert.equal(projection.wire.view(state).text, value.text)
})

test('the real registered source provides the original and shelf addresses', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shelf-sidebar-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'original.epub')
  await writeFile(source, 'synthetic EPUB')
  await mkdir(join(root, 'books'), { recursive: true })
  await symlink(source, join(root, 'books', `${bookId}.epub`))
  await writeFile(join(root, 'library.json'), JSON.stringify({ version: 1, books: [{ id: bookId, format: 'epub', link: { kind: 'file', path: source } }] }))
  const value = snapshot({ sourceRevision: await sourceRevision(source) })
  let state = projection.init()
  const projections = { stateOf: () => state }
  const controller = new ShelfSidebarSnapshotController(projections, root)
  const commandId = randomUUID()
  state = projection.apply(state, { type: 'command/run', seq: 0, time: 1, data: { name: 'bookshelf-snapshot', commandId } })
  const result = await createSidebarSnapshotCommand(controller).handler({
    agent: { session: { header: { cwd: root } } }, commandId,
    rawInput: JSON.stringify({ action: 'prepare', snapshot: value }), signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'success')
  const content = await readFile(join(root, '.dsh-bookshelf', `${value.snapshotId}.md`), 'utf8')
  assert.match(content, new RegExp(`Original book file: ${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(content, new RegExp(`Shelf soft link: .*books/${bookId}\\.epub`))
})
