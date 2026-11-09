// Windows denies fs.symlink without SeCreateSymbolicLinkPrivilege. The Host must
// still make folder import usable by falling back to a staged copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, lstat, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSourceLink, shouldCopyOnLinkFailure } from '../link-source.js'

function failure(code) {
  const error = new Error(code)
  error.code = code
  return error
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-link-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source.epub')
  await writeFile(source, 'book bytes')
  return { root, source, target: join(root, 'shelf.epub') }
}

test('falls back only for Windows link-permission failures', () => {
  assert.equal(shouldCopyOnLinkFailure(failure('EPERM'), 'win32'), true)
  assert.equal(shouldCopyOnLinkFailure(failure('EACCES'), 'win32'), true)
  assert.equal(shouldCopyOnLinkFailure(failure('ENOTSUP'), 'win32'), true)
  assert.equal(shouldCopyOnLinkFailure(failure('UNKNOWN'), 'win32'), true)
  assert.equal(shouldCopyOnLinkFailure(failure('EIO'), 'win32'), false)
  assert.equal(shouldCopyOnLinkFailure(failure('EPERM'), 'darwin'), false)
  assert.equal(shouldCopyOnLinkFailure(null, 'win32'), false)
})

test('creates a symbolic link when the platform allows it', async t => {
  const { source, target } = await fixture(t)
  assert.equal(await createSourceLink(source, target, { platform: 'darwin' }), 'symlink')
  assert.equal((await lstat(target)).isSymbolicLink(), true)
  assert.equal(await readFile(target, 'utf8'), 'book bytes')
})

test('copies bytes when Windows denies the symbolic link', async t => {
  const { source, target } = await fixture(t)
  const mode = await createSourceLink(source, target, {
    platform: 'win32',
    symlink: async () => { throw failure('EPERM') },
  })
  assert.equal(mode, 'copy')
  const info = await lstat(target)
  assert.equal(info.isFile(), true)
  assert.equal(info.isSymbolicLink(), false)
  assert.equal(await readFile(target, 'utf8'), 'book bytes')
  await assert.rejects(access(`${target}.copy`), error => error.code === 'ENOENT')
})

test('does not hide unrelated link failures', async t => {
  const { source, target } = await fixture(t)
  await assert.rejects(
    createSourceLink(source, target, {
      platform: 'win32',
      symlink: async () => { throw failure('EIO') },
    }),
    error => error.code === 'EIO',
  )
  await assert.rejects(access(target), error => error.code === 'ENOENT')
})

test('does not fall back on macOS', async t => {
  const { source, target } = await fixture(t)
  await assert.rejects(
    createSourceLink(source, target, {
      platform: 'darwin',
      symlink: async () => { throw failure('EPERM') },
    }),
    error => error.code === 'EPERM',
  )
  await assert.rejects(access(target), error => error.code === 'ENOENT')
})

test('cleans the staged copy when publishing it fails', async t => {
  const { source, target } = await fixture(t)
  await assert.rejects(
    createSourceLink(source, target, {
      platform: 'win32',
      symlink: async () => { throw failure('EPERM') },
      rename: async () => { throw failure('EIO') },
    }),
    error => error.code === 'EIO',
  )
  await assert.rejects(access(target), error => error.code === 'ENOENT')
  await assert.rejects(access(`${target}.copy`), error => error.code === 'ENOENT')
})
