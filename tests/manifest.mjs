// Guard the public package declaration that makes this repository installable
// as a DSH bundle and eligible for the community registry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

test('package declares a public, installable DSH bundle', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, 'dsh-bookshelf')
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.license, 'MIT')
  assert.match(manifest.repository.url, /github\.com\/Chriszzx\/dsh-bookshelf/)
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.includes('dsh-plugin'))
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.bundle.platforms, manifest.os)
  assert.match(manifest.engines.dsh, /0\.2\.0-rc\.2/)

  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /name: 'dsh-bookshelf'/)
  assert.equal(manifest.dsh.bundle.platforms.includes('darwin'), true)
  assert.equal(manifest.dsh.bundle.platforms.includes('win32'), true)

  const client = await readFile(new URL('client.js', root), 'utf8')
  assert.match(client.slice(0, 80), /id: 'dsh-bookshelf'/)

  for (const file of [
    'index.js', 'client.js', 'sidebar.js', 'apple-books.js', 'link-source.js',
    'source-revision.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE',
  ]) {
    assert.ok(manifest.files.includes(file), `files must include ${file}`)
  }
  assert.ok(manifest.files.includes('locale/*.json'))
  assert.ok(manifest.files.includes('assets/**'))

  const en = JSON.parse(await readFile(new URL('locale/en.json', root), 'utf8'))
  const zh = JSON.parse(await readFile(new URL('locale/zh.json', root), 'utf8'))
  assert.ok(en.meta.title && en.meta.description)
  assert.ok(zh.meta.title && zh.meta.description)
})
