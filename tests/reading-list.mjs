// The reading-list model is the contract between stored bookmarks/annotations
// and the reader's aside: merge order, the three sort modes, locale-independent
// search and the tab counts. Everything here runs in Node against the same
// module the browser preloads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { annotationLabel } from '../assets/lib/annotations.mjs'
import {
  countReadingItems,
  filterReadingItems,
  mergeReadingItems,
  readingKind,
  sortReadingItems,
} from '../assets/lib/reading-list.mjs'

function row({ id, kind, label = id, detail = '', chapterIndex, position = 0, createdAt = 0 }) {
  return { id, kind, label, detail, chapterIndex, position, createdAt, source: {} }
}

test('readingKind classifies merged rows and raw state records', () => {
  assert.equal(readingKind({ kind: 'bookmark' }), 'bookmark')
  assert.equal(readingKind({ kind: 'highlight' }), 'highlight')
  assert.equal(readingKind({ type: 'underline' }), 'underline')
  assert.equal(readingKind({ format: 'pdf', page: 3 }), 'bookmark')
  assert.equal(readingKind({ format: 'epub', chapterIndex: 2, anchor: '' }), 'bookmark')
  assert.equal(readingKind({ type: 'note', chapterIndex: 0 }), null)
  assert.equal(readingKind({ kind: 'sticky-note' }), null)
  assert.equal(readingKind({}), null)
  assert.equal(readingKind(null), null)
  assert.equal(readingKind(undefined), null)
  assert.equal(readingKind('bookmark'), null)
})

test('merges bookmarks first, then annotations, preserving stored order', () => {
  const bookmarks = [
    { id: 'b1', label: '第二章 · 40%', format: 'epub', chapterIndex: 1, scrollRatio: 0.4, percent: 0.4, createdAt: 1000 },
    { id: 'b2', label: '第二章 · 80%', format: 'epub', chapterIndex: 1, scrollRatio: 0.8, percent: 0.8, createdAt: 2000 },
  ]
  const annotations = [
    { id: 'a1', type: 'highlight', chapterIndex: 0, start: 10, end: 20, quote: '第一处标注', createdAt: 3000 },
    { id: 'a2', type: 'underline', chapterIndex: 1, start: 30, end: 44, quote: '第二处标注', createdAt: 4000 },
  ]
  const items = mergeReadingItems({ bookmarks, annotations, chapterLabels: { 0: '序章', 1: '第二章' } })
  assert.deepEqual(items.map((item) => item.id), ['b1', 'b2', 'a1', 'a2'])
  assert.deepEqual(items.map((item) => item.kind), ['bookmark', 'bookmark', 'highlight', 'underline'])
  assert.equal(items[0].label, '第二章 · 40%')
  assert.equal(items[0].detail, '第二章')
  assert.equal(items[2].label, annotationLabel('第一处标注'))
  assert.equal(items[3].label, annotationLabel('第二处标注'))
  assert.match(items[3].detail, /^第二章 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u)
  assert.equal(items[0].source, bookmarks[0])
  assert.equal(items[2].source, annotations[0])
})

test('every merged row carries the full ReadingItem shape', () => {
  const [item] = mergeReadingItems({
    bookmarks: [{ id: 'b1', label: '第一章 · 20%', format: 'epub', chapterIndex: 0, percent: 0.2, createdAt: 1 }],
  })
  assert.deepEqual(Object.keys(item).sort(), ['chapterIndex', 'createdAt', 'detail', 'id', 'kind', 'label', 'position', 'source'].sort())
})

test('merge tolerates missing and malformed input', () => {
  assert.deepEqual(mergeReadingItems(), [])
  assert.deepEqual(mergeReadingItems({}), [])
  assert.deepEqual(mergeReadingItems({ bookmarks: null, annotations: 'nope' }), [])
  assert.deepEqual(mergeReadingItems({ bookmarks: [], annotations: [] }), [])
  const bookmark = {}
  const items = mergeReadingItems({
    bookmarks: [null, 'x', bookmark],
    annotations: [null, { type: 'note', quote: '未知类型' }, { type: 'highlight', quote: '有效' }],
  })
  assert.equal(items.length, 2)
  const merged = items[0]
  assert.equal(merged.kind, 'bookmark')
  assert.equal(merged.id, 'bookmark-2')
  assert.equal(merged.label, '')
  assert.equal(merged.detail, '')
  assert.equal(merged.chapterIndex, undefined)
  assert.equal(merged.position, 0)
  assert.equal(merged.createdAt, 0)
  assert.equal(merged.source, bookmark)
  assert.equal(items[1].kind, 'highlight')
  assert.equal(items[1].id, 'highlight-2')
  assert.equal(items[1].label, '有效')
})

test('bookmark label falls back to page and percent', () => {
  const items = mergeReadingItems({
    bookmarks: [
      { page: 12, percent: 0.24, format: 'pdf', createdAt: 5 },
      { percent: 0.5, format: 'epub', chapterIndex: 2 },
      { label: '', percent: 0.75, format: 'epub', chapterIndex: 2 },
      { label: '已有标签', page: 3, percent: 0.1, format: 'pdf' },
    ],
    chapterLabels: ['封面', '第一章', '第二章'],
  })
  assert.equal(items[0].label, '第 12 页 · 24%')
  assert.equal(items[0].detail, '')
  assert.equal(items[1].label, '50%')
  assert.equal(items[1].detail, '第二章')
  assert.equal(items[2].label, '75%')
  assert.equal(items[3].label, '已有标签')
})

test('pageLabel localises the page fallback', () => {
  const items = mergeReadingItems({
    bookmarks: [{ page: 7, percent: 0.5, format: 'pdf' }],
    pageLabel: (page) => `p. ${page}`,
  })
  assert.equal(items[0].label, 'p. 7 · 50%')
})

test('chapter names come from the caller in every accepted shape', () => {
  const annotation = { id: 'a', type: 'underline', chapterIndex: 1, start: 0, end: 2, quote: '摘录' }
  const chapterOf = (chapterLabels) => mergeReadingItems({ annotations: [annotation], chapterLabels })[0].detail
  assert.equal(chapterOf({ 1: '第三章' }), '第三章')
  assert.equal(chapterOf({ 1: '第三章' }), '第三章')
  assert.equal(chapterOf(['第零章', '第一章']), '第一章')
  assert.equal(chapterOf(new Map([[1, 'Map 章']])), 'Map 章')
  assert.equal(chapterOf([{ chapterIndex: 1, label: 'Toc 章' }]), 'Toc 章')
  assert.equal(chapterOf((index) => `第 ${index + 1} 章`), '第 2 章')
  // No chapter source at all: the model adds no locale text of its own.
  assert.equal(chapterOf(undefined), '')
})

test('annotation label is the bounded annotationLabel summary', () => {
  const longQuote = '这是一段很长的原文，'.repeat(20)
  const [longItem] = mergeReadingItems({ annotations: [{ type: 'highlight', quote: longQuote, chapterIndex: 0, start: 0, end: 1 }] })
  assert.equal(longItem.label, annotationLabel(longQuote))
  assert.ok(longItem.label.length <= 61)
  const [shortItem] = mergeReadingItems({ annotations: [{ type: 'highlight', quote: '短原文', chapterIndex: 0, start: 0, end: 1 }] })
  assert.equal(shortItem.label, '短原文')
})

test('annotation fields are cleaned and missing data is tolerated', () => {
  const [item] = mergeReadingItems({
    annotations: [{
      id: 'a', type: 'highlight', chapterIndex: -3, start: -1,
      quote: '  many   spaces\nhere ', createdAt: 'not-a-time',
    }],
  })
  assert.equal(item.chapterIndex, undefined)
  assert.equal(item.position, 0)
  assert.equal(item.createdAt, 0)
  assert.equal(item.label, 'many spaces here')
  assert.equal(item.detail, '')
  // An empty quote falls back to a stored label instead of an empty row.
  const [fallback] = mergeReadingItems({ annotations: [{ type: 'underline', quote: '', label: '后备标签' }] })
  assert.equal(fallback.label, '后备标签')
})

test('position records the reading location used by sorting', () => {
  const items = mergeReadingItems({
    bookmarks: [
      { id: 'pdf', format: 'pdf', page: 42, percent: 0.42, createdAt: 1 },
      { id: 'epub', format: 'epub', chapterIndex: 3, scrollRatio: 0.2, percent: 0.55, createdAt: 2 },
    ],
    annotations: [{ id: 'a', type: 'underline', chapterIndex: 3, start: 321, end: 330, quote: 'x', createdAt: 3 }],
  })
  const byId = Object.fromEntries(items.map((item) => [item.id, item]))
  assert.equal(byId.pdf.position, 42)
  assert.equal(byId.pdf.chapterIndex, undefined)
  assert.equal(byId.epub.position, 0.55)
  assert.equal(byId.epub.chapterIndex, 3)
  assert.equal(byId.a.position, 321)
})

test('sortReadingItems position orders chapter by chapter then by position', () => {
  const items = [
    row({ id: 'c2', kind: 'bookmark', chapterIndex: 2, position: 0.5 }),
    row({ id: 'a2', kind: 'highlight', chapterIndex: 0, position: 100 }),
    row({ id: 'p9', kind: 'bookmark', position: 9 }),
    row({ id: 'a1', kind: 'underline', chapterIndex: 0, position: 20 }),
    row({ id: 'c1', kind: 'bookmark', chapterIndex: 1, position: 0.4 }),
    row({ id: 'p2', kind: 'bookmark', position: 2 }),
  ]
  const sorted = sortReadingItems(items, 'position')
  // Rows without a chapter (PDF bookmarks) sort first, by page.
  assert.deepEqual(sorted.map((item) => item.id), ['p2', 'p9', 'a1', 'a2', 'c1', 'c2'])
  // The input array is left untouched.
  assert.deepEqual(items.map((item) => item.id), ['c2', 'a2', 'p9', 'a1', 'c1', 'p2'])
})

test('mixed reading order compares bookmark text offsets with annotation offsets', () => {
  const items = mergeReadingItems({
    bookmarks: [
      { id: 'last', format: 'epub', chapterIndex: 0, scrollRatio: 0.8, textOffset: 300 },
      { id: 'first', format: 'epub', chapterIndex: 0, scrollRatio: 0.2, textOffset: 0 },
    ],
    annotations: [{ id: 'middle', chapterIndex: 0, type: 'highlight', start: 120, end: 130, quote: 'middle' }],
    positionForBookmark: bookmark => bookmark.textOffset,
  })
  assert.deepEqual(sortReadingItems(items, 'position').map(item => item.id), ['first', 'middle', 'last'])
})

test('sortReadingItems recent puts newest first and missing timestamps last', () => {
  const items = [
    row({ id: 'old', kind: 'bookmark', createdAt: 100 }),
    row({ id: 'new', kind: 'highlight', createdAt: 900 }),
    row({ id: 'missing', kind: 'underline' }),
    row({ id: 'middle', kind: 'bookmark', createdAt: 500 }),
  ]
  assert.deepEqual(sortReadingItems(items, 'recent').map((item) => item.id), ['new', 'middle', 'old', 'missing'])
})

test('sortReadingItems kind groups highlight, underline, bookmark and keeps ties stable', () => {
  const items = [
    row({ id: 'b1', kind: 'bookmark' }),
    row({ id: 'u1', kind: 'underline' }),
    row({ id: 'h1', kind: 'highlight' }),
    row({ id: 'h2', kind: 'highlight' }),
    row({ id: 'b2', kind: 'bookmark' }),
  ]
  assert.deepEqual(sortReadingItems(items, 'kind').map((item) => item.id), ['h1', 'h2', 'u1', 'b1', 'b2'])
})

test('sortReadingItems copies for unknown modes and tolerates non-arrays', () => {
  const items = [row({ id: 'a', kind: 'bookmark' }), row({ id: 'b', kind: 'highlight' })]
  const copied = sortReadingItems(items, 'unknown')
  assert.deepEqual(copied.map((item) => item.id), ['a', 'b'])
  assert.notEqual(copied, items)
  assert.deepEqual(sortReadingItems(undefined, 'position'), [])
  assert.deepEqual(sortReadingItems(null, 'recent'), [])
  // Malformed rows must not throw while sorting; unknown kinds sort last.
  assert.equal(sortReadingItems([null, row({ id: 'known', kind: 'bookmark' })], 'kind').length, 2)
})

test('filterReadingItems matches label and detail case-insensitively', () => {
  const items = mergeReadingItems({
    bookmarks: [
      { id: 'b1', label: 'Chapter One · 10%', format: 'epub', chapterIndex: 0, percent: 0.1, createdAt: 1 },
      { id: 'b2', label: '附录 · 90%', format: 'epub', chapterIndex: 1, percent: 0.9, createdAt: 2 },
    ],
    annotations: [
      { id: 'a1', type: 'highlight', chapterIndex: 0, start: 1, end: 2, quote: 'Hello World', createdAt: 3 },
      { id: 'a2', type: 'underline', chapterIndex: 1, start: 3, end: 4, quote: '人工智能', createdAt: 4 },
    ],
    chapterLabels: { 0: '第一章', 1: '术语表' },
  })
  assert.deepEqual(filterReadingItems(items, 'hello').map((item) => item.id), ['a1'])
  assert.deepEqual(filterReadingItems(items, 'CHAPTER').map((item) => item.id), ['b1'])
  assert.deepEqual(filterReadingItems(items, '术语表').map((item) => item.id), ['b2', 'a2'])
  assert.deepEqual(filterReadingItems(items, '智能').map((item) => item.id), ['a2'])
  assert.deepEqual(filterReadingItems(items, '  world  ').map((item) => item.id), ['a1'])
  assert.deepEqual(filterReadingItems(items, 'missing'), [])
})

test('filterReadingItems returns the same array for a blank query', () => {
  const items = [row({ id: 'a', kind: 'bookmark' })]
  assert.equal(filterReadingItems(items, ''), items)
  assert.equal(filterReadingItems(items, '   \t  '), items)
  assert.equal(filterReadingItems(items, undefined), items)
  assert.deepEqual(filterReadingItems(undefined, 'x'), [])
  // Malformed rows are skipped instead of throwing.
  assert.deepEqual(filterReadingItems([null, row({ id: 'ok', kind: 'bookmark', label: 'ok' })], 'ok').map((item) => item.id), ['ok'])
})

test('countReadingItems reports the total and per-kind counts', () => {
  const items = mergeReadingItems({
    bookmarks: [
      { id: 'b1', label: '第一章 · 5%', format: 'epub', chapterIndex: 0, percent: 0.05, createdAt: 1 },
      { id: 'b2', label: '第一章 · 15%', format: 'epub', chapterIndex: 0, percent: 0.15, createdAt: 2 },
    ],
    annotations: [
      { id: 'a1', type: 'highlight', chapterIndex: 0, start: 0, end: 1, quote: '高亮', createdAt: 3 },
      { type: 'underline', chapterIndex: 0, start: 2, end: 3, quote: '下划线', createdAt: 4 },
      { type: 'sticky', chapterIndex: 0, start: 5, end: 6, quote: '未知' },
    ],
  })
  assert.deepEqual(countReadingItems(items), { total: 4, bookmark: 2, highlight: 1, underline: 1 })
  assert.deepEqual(countReadingItems([]), { total: 0, bookmark: 0, highlight: 0, underline: 0 })
  assert.deepEqual(countReadingItems(undefined), { total: 0, bookmark: 0, highlight: 0, underline: 0 })
  assert.deepEqual(
    countReadingItems([{ kind: 'bookmark' }, { kind: 'unknown' }]),
    { total: 2, bookmark: 1, highlight: 0, underline: 0 },
  )
})

test('the whole model round-trips a panel workflow without mutating inputs', () => {
  const bookmarks = [
    { id: 'b1', label: '第二章 · 40%', format: 'epub', chapterIndex: 1, percent: 0.4, createdAt: 100 },
  ]
  const annotations = [
    { id: 'a1', type: 'highlight', chapterIndex: 0, start: 5, end: 9, quote: '机器之心', createdAt: 200 },
  ]
  const bookmarksBefore = structuredClone(bookmarks)
  const annotationsBefore = structuredClone(annotations)
  const chapterLabels = { 0: '序章', 1: '第二章' }
  const items = filterReadingItems(sortReadingItems(
    mergeReadingItems({ bookmarks, annotations, chapterLabels }),
    'position',
  ), '机器')
  assert.deepEqual(items.map((item) => item.id), ['a1'])
  assert.deepEqual(items.map((item) => item.detail.split(' · ')[0]), ['序章'])
  assert.deepEqual(countReadingItems(items), { total: 1, bookmark: 0, highlight: 1, underline: 0 })
  assert.deepEqual(bookmarks, bookmarksBefore)
  assert.deepEqual(annotations, annotationsBefore)
  assert.deepEqual(chapterLabels, { 0: '序章', 1: '第二章' })
})
