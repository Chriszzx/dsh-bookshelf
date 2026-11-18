import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeFontSettings, fontStack, readFontMetadata } from '../assets/reading-fonts.mjs'
import { applyTestHost as apply } from './helpers/host-context.mjs'

export function fontBlob({ weight = 400, italic = false, axes = [] } = {}) {
  const tables = [{ tag: 'OS/2', bytes: Buffer.alloc(64) }]
  tables[0].bytes.writeUInt16BE(weight, 4)
  tables[0].bytes.writeUInt16BE(italic ? 1 : 0, 62)
  if (axes.length) {
    const bytes = Buffer.alloc(16 + axes.length * 20)
    bytes.writeUInt16BE(1, 0)
    bytes.writeUInt16BE(16, 4)
    bytes.writeUInt16BE(axes.length, 8)
    bytes.writeUInt16BE(20, 10)
    axes.forEach((axis, index) => {
      const p = 16 + index * 20
      bytes.write(axis.tag, p)
      bytes.writeInt32BE(axis.min * 65536, p + 4)
      bytes.writeInt32BE((axis.default ?? axis.min) * 65536, p + 8)
      bytes.writeInt32BE(axis.max * 65536, p + 12)
    })
    tables.push({ tag: 'fvar', bytes })
  }
  const header = Buffer.alloc(12 + tables.length * 16)
  header.writeUInt32BE(0x00010000)
  header.writeUInt16BE(tables.length, 4)
  let offset = header.length
  tables.forEach((table, index) => {
    const p = 12 + index * 16
    header.write(table.tag, p)
    header.writeUInt32BE(offset, p + 8)
    header.writeUInt32BE(table.bytes.length, p + 12)
    offset += table.bytes.length
  })
  return new Blob([header, ...tables.map(table => table.bytes)])
}

test('font settings preserve legacy presets and validate named fonts independently', () => {
  assert.deepEqual(sanitizeFontSettings({ fontFamily: 'sans' }), { fontFamily: 'sans' })
  assert.deepEqual(sanitizeFontSettings({ fontFamily: 'serif', fontName: ' LXGW WenKai ', fontWeight: 500, fontStyle: 'normal' }),
    { fontFamily: 'serif', fontName: 'LXGW WenKai', fontWeight: 500, fontStyle: 'normal' })
  for (const value of [null, [], {}, { fontFamily: '__proto__', fontName: 'bad\nfont', fontWeight: 950, fontStyle: 'oblique' }]) {
    assert.deepEqual(sanitizeFontSettings(value), {})
  }
  assert.equal(sanitizeFontSettings({ fontName: 'x'.repeat(201) }).fontName, undefined)
  assert.equal(sanitizeFontSettings({ fontWeight: '700' }).fontWeight, undefined)
  assert.equal(sanitizeFontSettings({ fontWeight: 0 }).fontWeight, 0)
  assert.ok(fontStack({ fontFamily: 'serif' }).includes('Noto Serif SC'))
  assert.ok(fontStack({ fontName: 'A"\\ Font', fontFamily: 'mono' }).startsWith('"A\\"\\\\ Font",'))
})

test('native font metadata distinguishes real italics and variable weight ranges', async () => {
  assert.deepEqual(await readFontMetadata(fontBlob({ weight: 500 })), { weights: [500], italic: false, normal: true })
  assert.deepEqual(await readFontMetadata(fontBlob({ weight: 700, italic: true })), { weights: [700], italic: true, normal: false })
  assert.deepEqual(await readFontMetadata(fontBlob({ weight: 200, axes: [{ tag: 'wght', min: 200, max: 900 }] })),
    { weights: [200, 300, 400, 500, 600, 700, 800, 900], italic: false, normal: true })
  assert.equal((await readFontMetadata(fontBlob({ axes: [{ tag: 'slnt', min: -12, max: 0 }] }))).italic, true)
  await assert.rejects(readFontMetadata(new Blob(['invalid'])), /Invalid font/)
  const malformed = new Uint8Array(await fontBlob().arrayBuffer())
  new DataView(malformed.buffer).setUint32(20, 999999)
  await assert.rejects(readFontMetadata(new Blob([malformed])), /Invalid font metadata/)
})

test('font selection and styles survive real default and per-book HTTP persistence', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-font-state-'))
  const owned = await realpath(temporary)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = join(temporary, 'home')
  let route
  apply({ effect: fn => fn(), webServer: { register(value) { route = value; return () => {} } }, logger: { info() {}, warn() {}, error() {} } })
  const server = createServer((request, response) => route.handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    assert.equal(await realpath(temporary), owned)
    await rm(owned, { recursive: true, force: true })
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  const origin = `http://127.0.0.1:${server.address().port}/bookshelf/api`
  const update = (path, value) => fetch(origin + path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  const settings = { fontFamily: 'serif', fontName: 'Source Han Serif CN', fontWeight: 500, fontStyle: 'normal', fontSize: 20 }
  assert.equal((await update('/settings', settings)).status, 200)
  const defaults = await (await fetch(origin + '/settings')).json()
  assert.deepEqual(defaults.settings, settings)
  const imported = await (await fetch(origin + '/books?name=test.epub&format=epub', { method: 'POST', body: 'font state fixture' })).json()
  assert.ok(imported.book?.id)
  const statePath = `/books/${imported.book.id}/state`
  assert.equal((await update(statePath, { settings: { ...settings, fontStyle: 'italic' } })).status, 200)
  const saved = await (await fetch(origin + statePath)).json()
  assert.deepEqual(saved.state.settings, { ...settings, fontStyle: 'italic' })
  await update('/settings', { fontFamily: 'sans', fontName: 'bad\nfont', fontWeight: -1, fontStyle: 'invalid' })
  assert.deepEqual((await (await fetch(origin + '/settings')).json()).settings, { fontFamily: 'sans' })
})
