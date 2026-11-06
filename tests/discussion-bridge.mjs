import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDiscussionBridge, PENDING_DISCUSSION_KEY, DRAFT_SEED_PREFIX } from '../assets/discussion.mjs'

const capture = () => ({ snapshotId: randomUUID(), text: 'Visible page 😀', bookId: randomUUID() })
function fixture({ storage = new Map(), failCreate = false, failCommand = false, failOpen = false, deferred } = {}) {
  const calls = { create: [], command: [], open: [] }
  let navigation
  const backing = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  const remote = {
    session: { async create(request, ...extra) {
      assert.equal(extra.length, 0, 'session/create takes exactly one argument')
      calls.create.push(request)
      // Creation is a blank session; no turn, no context injection.
      if (failCreate) { failCreate = false; throw new Error('creation response lost') }
      return { ok: true, value: { sessionId: request.sessionId } }
    } },
    commands: { async execute(id, line, attachments, signal) {
      assert.ok(signal instanceof AbortSignal, 'command execution carries its caller cancellation')
      const payload = JSON.parse(line.slice('/bookshelf-snapshot '.length))
      calls.command.push({ id, payload, attachments })
      const file = { path: `.dsh-bookshelf/${payload.snapshot.snapshotId}.md`, mention: `@.dsh-bookshelf/${payload.snapshot.snapshotId}.md`, label: 'Fixture · 1 / 2' }
      if (deferred) await deferred.promise
      if (failCommand) { failCommand = false; throw new Error('command response lost') }
      return { ok: true, value: { result: { kind: 'success', text: JSON.stringify({ marker: 'bookshelf-page-snapshot-v1', snapshot: payload.snapshot, file }) } } }
    } },
  }
  const options = { remote, storage: backing, randomUUID,
    uiWorkspace: { openSession(id) { if (failOpen) { failOpen = false; throw new Error('navigation not ready') }; calls.open.push(id) } },
    layout: { beginNavigation() { navigation?.abort(); navigation = new AbortController(); return navigation.signal } } }
  const seedKey = sessionId => `${DRAFT_SEED_PREFIX}.${sessionId}`
  const seed = sessionId => { try { return JSON.parse(storage.get(seedKey(sessionId)) || 'null') } catch { return null } }
  return { calls, storage, seedKey, seed, options, bridge: createDiscussionBridge(options), supersede: () => navigation.abort() }
}

test('new UUID target, exact workspace, page file prepare precedes navigation', async () => {
  const f = fixture(), snapshot = capture()
  const result = await f.bridge.start({ workspaceId: 'chosen-workspace', snapshot })
  assert.equal(f.calls.create[0].workspaceId, 'chosen-workspace')
  assert.match(f.calls.create[0].sessionId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(f.calls.command[0].payload, { action: 'prepare', snapshot })
  assert.deepEqual(f.calls.command[0].attachments, [])
  assert.deepEqual(f.calls.open, [result.sessionId])
  assert.equal(f.bridge.pending, null)
  assert.equal(f.storage.has(PENDING_DISCUSSION_KEY), false)
  assert.deepEqual(f.seed(result.sessionId), { mention: `@.dsh-bookshelf/${snapshot.snapshotId}.md`, label: 'Fixture · 1 / 2', path: `.dsh-bookshelf/${snapshot.snapshotId}.md` })
})
test('lost command response retries same target and immutable snapshot after coordinator reload', async () => {
  const f = fixture({ failCommand: true }), snapshot = capture()
  await assert.rejects(f.bridge.start({ workspaceId: 'workspace', snapshot }), /response lost/)
  assert.equal(f.calls.open.length, 0)
  const restored = createDiscussionBridge(f.options)
  await assert.rejects(restored.start({ workspaceId: 'other-workspace', snapshot: capture() }), /previous discussion/)
  await restored.start({ retry: true })
  assert.equal(f.calls.create.length, 1)
  assert.deepEqual(f.calls.command[0], f.calls.command[1])
  assert.ok(f.seed(f.calls.create[0].sessionId))
  assert.equal(f.calls.open.length, 1)
})
test('lost creation response retries operation-owned UUID rather than minting another', async () => {
  const f = fixture({ failCreate: true }), snapshot = capture()
  await assert.rejects(f.bridge.start({ workspaceId: 'workspace', snapshot }), /creation response lost/)
  await createDiscussionBridge(f.options).start({ retry: true })
  assert.deepEqual(f.calls.create[0], f.calls.create[1])
  assert.equal(f.calls.open.length, 1)
})
test('double click and discard cannot overlap an active operation', async () => {
  const deferred = Promise.withResolvers(), f = fixture({ deferred }), snapshot = capture()
  const first = f.bridge.start({ workspaceId: 'workspace', snapshot })
  await assert.rejects(f.bridge.start({ workspaceId: 'workspace', snapshot }), /already being prepared/)
  assert.throws(() => f.bridge.discard(), /still being prepared/)
  deferred.resolve(); await first
  assert.equal(f.calls.create.length, 1)
  assert.equal(f.calls.command.length, 1)
})
test('unrelated navigation prevents late UI takeover but keeps saved session', async () => {
  const deferred = Promise.withResolvers(), f = fixture({ deferred })
  const operation = f.bridge.start({ workspaceId: 'workspace', snapshot: capture() })
  f.supersede(); deferred.resolve()
  const result = await operation
  assert.equal(result.opened, false)
  assert.equal(f.calls.open.length, 0)
  assert.ok(f.seed(f.calls.create[0].sessionId))
})
test('failed navigation retains retry target without duplicate context', async () => {
  const f = fixture({ failOpen: true })
  await assert.rejects(f.bridge.start({ workspaceId: 'workspace', snapshot: capture() }), /navigation not ready/)
  await f.bridge.start({ retry: true })
  assert.equal(f.calls.create.length, 1)
  assert.equal(f.calls.open.length, 1)
  assert.ok(f.seed(f.calls.create[0].sessionId))
})
test('missing choice and disposed plugin never create a session', async () => {
  const f = fixture()
  await assert.rejects(f.bridge.start({ workspaceId: '', snapshot: capture() }), /Choose a workspace/)
  f.bridge.dispose()
  await assert.rejects(f.bridge.start({ workspaceId: 'workspace', snapshot: capture() }), /no longer available/)
  assert.equal(f.calls.create.length, 0)
})
test('discard removes a prepared page-file seed before the session is opened', async () => {
  const f = fixture({ failOpen: true })
  await assert.rejects(f.bridge.start({ workspaceId: 'workspace', snapshot: capture() }), /navigation not ready/)
  const sessionId = f.calls.create[0].sessionId
  assert.ok(f.seed(sessionId))
  f.bridge.discard()
  assert.equal(f.seed(sessionId), null)
  assert.equal(f.bridge.pending, null)
  assert.equal(f.storage.has(PENDING_DISCUSSION_KEY), false)
})
