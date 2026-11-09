// Folder listing and duplicate detection must expose whether a shelf entry is a
// real soft link or the Windows copy fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import * as fs from 'node:fs'
import { access, lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { apply } from '../index.js'

test('folder listing and duplicate import report the copy fallback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-link-mode-'))
  const previousHome = process.env.DSH_HOME
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  process.env.DSH_HOME = join(root, 'home')

  const folder = join(root, 'folder')
  await mkdir(folder, { recursive: true })
  const source = join(folder, 'copy.epub')
  await writeFile(source, 'epub bytes')
  const resolved = await realpath(source)
  const libraryDir = join(process.env.DSH_HOME, 'bookshelf')
  await mkdir(libraryDir, { recursive: true })
  const id = randomUUID()
  await writeFile(
    join(libraryDir, 'library.json'),
    JSON.stringify({
      version: 1,
      books: [{
        id,
        title: 'Copy Book',
        author: '',
        format: 'epub',
        bytes: 10,
        name: 'copy.epub',
        addedAt: 1,
        link: { kind: 'file', path: resolved, mode: 'copy' },
      }],
    }),
  )

  let route
  apply({
    effect: fn => fn(),
    webServer: { register(value) { route = value; return () => {} } },
    directoryPickerController: { async pick() { return folder } },
    logger: { info() {}, warn() {}, error() {} },
  })
  assert.equal(typeof route?.handler, 'function')

  const server = createServer((request, response) => route.handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`

  const picked = await fetch(`${origin}/bookshelf/api/links/pick`, { method: 'POST' })
  assert.equal(picked.status, 200)
  const session = await picked.json()
  assert.equal(session.files.length, 1)
  assert.equal(session.files[0].linked, true)
  assert.equal(session.files[0].mode, 'copy')

  const duplicate = await fetch(`${origin}/bookshelf/api/links/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: session.token, name: 'copy.epub' }),
  })
  assert.equal(duplicate.status, 200)
  const result = await duplicate.json()
  assert.equal(result.duplicate, true)
  assert.equal(result.mode, 'copy')
})

test('the host copies a folder import when Windows denies the symbolic link', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bookshelf-link-fallback-'))
  const previousHome = process.env.DSH_HOME
  const previousPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const previousSymlink = fs.promises.symlink
  t.after(async () => {
    fs.promises.symlink = previousSymlink
    Object.defineProperty(process, 'platform', previousPlatform)
    await rm(root, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  process.env.DSH_HOME = join(root, 'home')

  const folder = join(root, 'folder')
  await mkdir(folder, { recursive: true })
  const source = join(folder, 'fallback.epub')
  await writeFile(source, 'fallback bytes')

  // Exercise the real route with the exact failure Windows reports without
  // SeCreateSymbolicLinkPrivilege.
  Object.defineProperty(process, 'platform', { value: 'win32' })
  fs.promises.symlink = async () => {
    const error = new Error('EPERM: operation not permitted, symlink')
    error.code = 'EPERM'
    throw error
  }

  let route
  apply({
    effect: fn => fn(),
    webServer: { register(value) { route = value; return () => {} } },
    directoryPickerController: { async pick() { return folder } },
    logger: { info() {}, warn() {}, error() {} },
  })

  const server = createServer((request, response) => route.handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const picked = await fetch(`${origin}/bookshelf/api/links/pick`, { method: 'POST' })
    assert.equal(picked.status, 200)
    const session = await picked.json()
    assert.equal(session.files.length, 1)

    const imported = await fetch(`${origin}/bookshelf/api/links/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: session.token, name: 'fallback.epub' }),
    })
    assert.equal(imported.status, 201)
    const result = await imported.json()
    assert.equal(result.mode, 'copy')
    assert.equal(result.book.title, 'fallback')

    const library = JSON.parse(await readFile(join(process.env.DSH_HOME, 'bookshelf', 'library.json'), 'utf8'))
    assert.equal(library.books.length, 1)
    assert.equal(library.books[0].link.mode, 'copy')
    assert.equal(library.books[0].link.path, await realpath(source))

    const shelfFile = join(process.env.DSH_HOME, 'bookshelf', 'books', `${result.book.id}.epub`)
    const info = await lstat(shelfFile)
    assert.equal(info.isFile(), true)
    assert.equal(info.isSymbolicLink(), false)
    assert.equal(await readFile(shelfFile, 'utf8'), 'fallback bytes')
    await assert.rejects(access(`${shelfFile}.copy`), error => error.code === 'ENOENT')

    const duplicate = await fetch(`${origin}/bookshelf/api/links/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: session.token, name: 'fallback.epub' }),
    })
    assert.equal(duplicate.status, 200)
    const repeated = await duplicate.json()
    assert.equal(repeated.duplicate, true)
    assert.equal(repeated.mode, 'copy')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
