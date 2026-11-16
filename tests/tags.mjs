// Tag taxonomy rules and reading-status derivation are pure decisions; pin them
// here so the HTTP layer only has to wire them up.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanTagName,
  createTagStore,
  deriveReadingStatus,
  normalizeTagName,
  readingStatusOf,
  TAG_LIMITS,
  TagStoreError,
} from '../tags.js'

async function withStore(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-tags-'))
  const owned = await realpath(temporary)
  t.after(async () => {
    assert.equal(await realpath(temporary), owned)
    await rm(owned, { recursive: true, force: true })
  })
  return { rootDir: temporary, store: createTagStore({ rootDir: temporary }) }
}

async function seed(rootDir, tags) {
  await mkdir(rootDir, { recursive: true })
  await writeFile(join(rootDir, 'tags.json'), JSON.stringify({ version: 1, tags }))
}

test('tag names are cleaned for storage and normalized for comparison', () => {
  assert.equal(normalizeTagName(' 心理学! '), '心理学')
  assert.equal(normalizeTagName('ＡＢＣ'), 'abc')
  assert.equal(normalizeTagName('Reading Now'), 'readingnow')
  assert.equal(normalizeTagName('已 读 完'), '已读完')

  assert.equal(cleanTagName('  人类学\n\n 入门  '), '人类学 入门')
  assert.equal(cleanTagName('a\u0000b'), 'a b')
  assert.equal(cleanTagName(''), null)
  assert.equal(cleanTagName('   '), null)
  assert.equal(cleanTagName(null), null)
  assert.equal(cleanTagName(42), null)

  assert.equal(cleanTagName('字'.repeat(TAG_LIMITS.maxNameLength)), '字'.repeat(TAG_LIMITS.maxNameLength))
  assert.equal(cleanTagName('字'.repeat(TAG_LIMITS.maxNameLength + 1)), null)
  // Code points, not UTF-16 units: an emoji must count once.
  assert.equal(cleanTagName('😀'.repeat(TAG_LIMITS.maxNameLength)), '😀'.repeat(TAG_LIMITS.maxNameLength))
})

test('creates, lists and persists tags in creation order', async t => {
  const { rootDir, store } = await withStore(t)
  const psychology = await store.create(' 心理学 ')
  const economics = await store.create('经济学')

  assert.equal(psychology.name, '心理学')
  assert.match(psychology.id, /^[0-9a-f-]{36}$/)
  assert.ok(Number.isFinite(psychology.createdAt) && psychology.createdAt > 0)
  assert.deepEqual((await store.list()).map(tag => tag.name), ['心理学', '经济学'])
  assert.deepEqual((await createTagStore({ rootDir }).list()).map(tag => tag.name), ['心理学', '经济学'])

  const stored = JSON.parse(await readFile(join(rootDir, 'tags.json'), 'utf8'))
  assert.deepEqual(stored, { version: 1, tags: [psychology, economics] })
})

test('rejects duplicate, reserved, invalid and over-limit tags', async t => {
  const { rootDir, store } = await withStore(t)
  await store.create('Linux')

  const code = async (run) => {
    try {
      await run()
    } catch (error) {
      assert.ok(error instanceof TagStoreError, `expected a TagStoreError, got ${error}`)
      return error.status
    }
    throw new Error('expected the call to fail')
  }

  assert.equal(await code(() => store.create('Linux')), 409)
  assert.equal(await code(() => store.create('linux')), 409)
  assert.equal(await code(() => store.create('Ｌｉｎｕｘ')), 409)
  assert.equal(await code(() => store.create('L i n u x')), 409)
  for (const reserved of ['未读', '正在阅读', '已读完', 'Unread', 'Reading', 'Finished', 'reading']) {
    assert.equal(await code(() => store.create(reserved)), 409)
  }
  assert.equal(await code(() => store.create('')), 400)
  assert.equal(await code(() => store.create('   ')), 400)
  assert.equal(await code(() => store.create('字'.repeat(TAG_LIMITS.maxNameLength + 1))), 400)
  assert.equal(await code(() => store.create({ name: 'x' })), 400)

  await seed(rootDir, Array.from({ length: TAG_LIMITS.maxTags }, (_, index) => ({
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    name: `tag-${index}`,
  })))
  assert.equal(await code(() => store.create('one-too-many')), 409)
  assert.equal((await store.list()).length, TAG_LIMITS.maxTags)
})

test('renames and removes without reordering the rest', async t => {
  const { store } = await withStore(t)
  const first = await store.create('甲')
  const second = await store.create('乙')
  const third = await store.create('丙')

  assert.equal((await store.rename(first.id, ' 甲甲 ')).name, '甲甲')
  assert.deepEqual((await store.list()).map(tag => tag.name), ['甲甲', '乙', '丙'])

  // Renaming to the same text is not a conflict with itself.
  assert.equal((await store.rename(second.id, '乙')).name, '乙')

  await assert.rejects(store.rename(first.id, '乙'), error => error.status === 409)
  await assert.rejects(store.rename('00000000-0000-4000-8000-000000000000', '丁'), error => error.status === 404)
  await assert.rejects(store.rename(first.id, '已读完'), error => error.status === 409)

  assert.equal((await store.remove(second.id)).name, '乙')
  assert.deepEqual((await store.list()).map(tag => tag.name), ['甲甲', '丙'])
  await assert.rejects(store.remove(second.id), error => error.status === 404)
  await assert.rejects(store.remove('not-an-id'), error => error.status === 400)
  assert.deepEqual((await store.list()).map(tag => tag.id), [first.id, third.id])
})

test('tolerates hand-edited files and reports corrupt ones', async t => {
  const { rootDir, store } = await withStore(t)
  await seed(rootDir, [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: ' 心理学 ' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '重复 id' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '心理学' },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: '   ' },
    { id: 'not-a-tag-id', name: '坏 id' },
    { name: '没有 id' },
    null,
  ])
  assert.deepEqual((await store.list()).map(tag => tag.name), ['心理学'])
  assert.equal((await store.list())[0].id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')

  await writeFile(join(rootDir, 'tags.json'), '{not json')
  await assert.rejects(store.list(), error => error.status === 500 && /not valid JSON/.test(error.message))
  await assert.rejects(store.create('新标签'), error => error.status === 500)

  await writeFile(join(rootDir, 'tags.json'), JSON.stringify({ version: 1 }))
  await assert.rejects(store.list(), error => error.status === 500 && /no tags array/.test(error.message))
})

test('concurrent creates keep every tag', async t => {
  const { store } = await withStore(t)
  await Promise.all(['一', '二', '三', '四', '五'].map(name => store.create(name)))
  assert.deepEqual((await store.list()).map(tag => tag.name).sort(), ['一', '三', '二', '五', '四'].sort())
})

test('reading status follows progress and a manual override wins', () => {
  assert.equal(deriveReadingStatus(null), 'unread')
  assert.equal(deriveReadingStatus(undefined), 'unread')
  assert.equal(deriveReadingStatus({}), 'reading')
  assert.equal(deriveReadingStatus({ percent: 0 }), 'reading')
  assert.equal(deriveReadingStatus({ percent: 0.5 }), 'reading')
  // Reaching the last page never infers "finished": the reader must confirm it,
  // so an unconfirmed book that was read to the end stays in "reading".
  assert.equal(deriveReadingStatus({ percent: 0.994 }), 'reading')
  assert.equal(deriveReadingStatus({ percent: 0.995 }), 'reading')
  assert.equal(deriveReadingStatus({ percent: 1 }), 'reading')
  assert.equal(deriveReadingStatus({ percent: '0.999' }), 'reading')
  assert.equal(deriveReadingStatus({ percent: 'nonsense' }), 'reading')

  assert.deepEqual(readingStatusOf({}, null), { status: 'unread', manual: false })
  assert.deepEqual(readingStatusOf({}, { percent: 0.2 }), { status: 'reading', manual: false })
  assert.deepEqual(readingStatusOf({ status: 'finished' }, { percent: 1 }), { status: 'finished', manual: true })
  assert.deepEqual(readingStatusOf({ status: 'unread' }, { percent: 0.9 }), { status: 'unread', manual: true })
  assert.deepEqual(readingStatusOf({ status: 'nonsense' }, null), { status: 'unread', manual: false })
})
