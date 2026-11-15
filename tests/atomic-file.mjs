import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { replaceFile } from '../assets/atomic-file.mjs'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-atomic-'))
  const owned = await realpath(root)
  try {
    const target = join(root, 'state.json'), source = join(root, 'state.json.tmp')
    await writeFile(target, JSON.stringify({ page: 2 }))
    await writeFile(source, JSON.stringify({ page: 3 }))
    await run({ source, target })
  } finally {
    assert.equal(await realpath(root), owned)
    await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

for (const code of ['EPERM', 'EBUSY']) {
  test('retries a temporary Windows ' + code + ' without changing the old state first', () => fixture(async ({ source, target }) => {
    let calls = 0
    const delays = []
    await replaceFile(source, target, {
      platform: 'win32',
      rename: async (from, to) => {
        calls += 1
        assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { page: 2 })
        if (calls <= 2) throw Object.assign(new Error('temporarily locked'), { code })
        await rename(from, to)
      },
      sleep: async ms => { delays.push(ms); await delay(ms) },
    })
    assert.ok(calls >= 3 && calls <= 7)
    assert.deepEqual(delays.slice(0, 2), [25, 50])
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { page: 3 })
    await assert.rejects(readFile(source), { code: 'ENOENT' })
  }))
}

test('permanent Windows locking is bounded and preserves both complete files', () => fixture(async ({ source, target }) => {
  let calls = 0
  const error = Object.assign(new Error('still locked'), { code: 'EPERM' })
  await assert.rejects(replaceFile(source, target, {
    platform: 'win32', rename: async () => { calls += 1; throw error }, sleep: async () => {},
  }), value => value === error)
  assert.equal(calls, 7)
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { page: 2 })
  assert.deepEqual(JSON.parse(await readFile(source, 'utf8')), { page: 3 })
}))

for (const [platform, code] of [['darwin', 'EPERM'], ['win32', 'ENOENT'], ['win32', 'EACCES']]) {
  test(platform + ' ' + code + ' is reported without a retry', async () => {
    let calls = 0
    const error = Object.assign(new Error('unrelated failure'), { code })
    await assert.rejects(replaceFile('source', 'target', {
      platform, rename: async () => { calls += 1; throw error },
      sleep: async () => { assert.fail('unexpected retry') },
    }), value => value === error)
    assert.equal(calls, 1)
  })
}
