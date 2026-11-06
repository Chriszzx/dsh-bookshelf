// Native conversation handoff. The operation outlives the reader component;
// retries retain the exact target Session and immutable snapshot.
export const DISCUSSION_BRIDGE_VERSION = 5
export const PENDING_DISCUSSION_KEY = ['bookshelf', 'pending', 'v1'].join('.')
export const RETURN_TO_BOOK_KEY = ['bookshelf', 'open', 'v1'].join('.')
export const DRAFT_SEED_PREFIX = ['bookshelf', 'draft', 'v1'].join('.')

function unwrap(result) {
  if (!result?.ok) throw new Error(result?.error?.message || 'The conversation service refused the operation.')
  return result.value
}
function load(storage) {
  try {
    const value = JSON.parse(storage?.getItem(PENDING_DISCUSSION_KEY) || 'null')
    return value?.snapshot?.snapshotId && value.workspaceId && value.requestedSessionId ? value : null
  } catch { return null }
}

export function createDiscussionBridge({ remote, uiWorkspace, layout, storage, onPrepared, onOpened, randomUUID = () => crypto.randomUUID() }) {
  let pending = load(storage)
  let running = false
  const lifetime = new AbortController()
  function save() {
    try {
      if (pending) storage?.setItem(PENDING_DISCUSSION_KEY, JSON.stringify(pending))
      else storage?.removeItem(PENDING_DISCUSSION_KEY)
    } catch { /* In-memory retries remain available when browser storage is full. */ }
  }
  return {
    get pending() { return pending },
    get running() { return running },
    discard() {
      if (running) throw new Error('A discussion is still being prepared.')
      const sessionId = pending?.sessionId
      if (typeof sessionId === 'string') {
        try { storage?.removeItem(`${DRAFT_SEED_PREFIX}.${sessionId}`) } catch {}
      }
      pending = null
      save()
    },
    dispose() { lifetime.abort() },
    async start({ workspaceId, snapshot, retry = false }) {
      if (running) throw new Error('A discussion is already being prepared.')
      if (lifetime.signal.aborted) throw new Error('The bookshelf is no longer available.')
      if (!remote?.session?.create || !remote?.commands?.execute || !uiWorkspace?.openSession) {
        throw new Error('The native conversation services are not available. Reload DSH after enabling the Books plugin.')
      }
      if (!retry) {
        if (typeof workspaceId !== 'string' || !workspaceId || !snapshot?.snapshotId || !snapshot.text?.trim()) {
          throw new Error('Choose a workspace and capture visible text before creating a discussion.')
        }
        if (pending) throw new Error('A previous discussion needs to be retried or dismissed first.')
        pending = { workspaceId, snapshot, requestedSessionId: randomUUID(), sessionId: null }
        save()
      }
      if (!pending) throw new Error('There is no discussion to retry.')
      const operation = pending
      const navigation = layout.beginNavigation()
      running = true
      try {
        // Creation uses an operation-owned fresh identity; never choose a catalog blank.
        if (!operation.sessionId) {
          const created = unwrap(await remote.session.create({ workspaceId: operation.workspaceId, sessionId: operation.requestedSessionId }))
          lifetime.signal.throwIfAborted()
          if (!created?.sessionId) throw new Error('Session creation returned no identity.')
          operation.sessionId = created.sessionId
          save()
        }
        const execution = unwrap(await remote.commands.execute(operation.sessionId,
          '/bookshelf-snapshot ' + JSON.stringify({ action: 'prepare', snapshot: operation.snapshot }), [], lifetime.signal))
        if (!execution || execution.result?.kind !== 'success') {
          let message = execution?.result?.text || 'Books snapshot support is unavailable. Reload the Books plugin and retry.'
          try { message = JSON.parse(message).message || message } catch {}
          throw new Error(message)
        }
        const envelope = JSON.parse(execution.result.text)
        if (envelope.marker !== 'bookshelf-page-snapshot-v1' || envelope.snapshot?.snapshotId !== operation.snapshot.snapshotId ||
            typeof envelope.file?.mention !== 'string' || envelope.file.mention === '') {
          throw new Error('Books returned an unexpected page file. The conversation has not been opened.')
        }
        // The file reference and prompt are seeded into the new composer.
        // Nothing is sent; the user writes the actual question and submits it.
        try { onPrepared?.({ sessionId: operation.sessionId, snapshotId: operation.snapshot.snapshotId, file: envelope.file }) } catch { /* The composer fallback remains. */ }
        try {
          storage?.setItem(`${DRAFT_SEED_PREFIX}.${operation.sessionId}`, JSON.stringify({
            mention: envelope.file.mention, label: envelope.file.label || '', path: envelope.file.path || '',
          }))
        } catch { /* The conversation remains usable; only the draft chip is missing. */ }
        // An unrelated navigation cancels only the UI commit; the saved conversation remains valid.
        const result = { sessionId: operation.sessionId, snapshotId: operation.snapshot.snapshotId, opened: !navigation.aborted && !lifetime.signal.aborted }
        if (result.opened) {
          uiWorkspace.openSession(result.sessionId)
          try { onOpened?.(result.sessionId, result.snapshotId) } catch { /* The composer keeps the file reference. */ }
        }
        pending = null
        save()
        return result
      } finally { running = false }
    },
  }
}
