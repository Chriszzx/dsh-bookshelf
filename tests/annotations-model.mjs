// Annotation model contract: the stored shape is the per-book Host state
// shape, the Host sanitizer drops malformed
// entries instead of failing a whole batch, and the Reader glue gets legal
// annotations from a selection. Pure data tests only: no DOM is needed.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ANNOTATION_STYLE,
  anchorKey,
  annotationLabel,
  fromSelection,
  hasSameAnchor,
  newAnnotationId,
  normalizeAnnotationStyle,
  sanitizeAnnotations,
} from '../assets/lib/annotations.mjs'

const FIELD_NAMES = [
  'id', 'type', 'chapterIndex', 'start', 'end', 'quote', 'prefix', 'suffix',
  'color', 'strength', 'thickness', 'underlineStyle', 'createdAt', 'label',
]
const QUOTE = '这是一段选中的原文内容。'
const STYLE = Object.freeze({
  mode: 'highlight', color: '#ffd23f', strength: 0.35, thickness: 2, underlineStyle: 'solid',
})

function makeValid(overrides = {}) {
  return {
    id: 'an_abc123',
    type: 'underline',
    chapterIndex: 3,
    start: 1234,
    end: 1300,
    quote: QUOTE,
    prefix: '前面的一段文字',
    suffix: '后面的一段文字',
    color: '#ffd23f',
    strength: 0.35,
    thickness: 2,
    underlineStyle: 'solid',
    createdAt: 1710000000000,
    label: QUOTE,
    ...overrides,
  }
}

test('newAnnotationId returns unique an_<base36> ids', () => {
  const ids = new Set()
  for (let index = 0; index < 200; index += 1) ids.add(newAnnotationId())
  assert.equal(ids.size, 200)
  for (const id of ids) {
    assert.match(id, /^an_[0-9a-z]+$/)
    assert.ok(id.length <= 100)
  }
})

test('DEFAULT_ANNOTATION_STYLE matches the documented defaults', () => {
  assert.deepEqual(DEFAULT_ANNOTATION_STYLE, {
    mode: 'highlight', color: '#ffd23f', strength: 0.35, thickness: 2, underlineStyle: 'solid',
  })
  assert.ok(Object.isFrozen(DEFAULT_ANNOTATION_STYLE))
})

test('normalizeAnnotationStyle falls back per field without throwing', () => {
  for (const value of [undefined, null, 42, 'highlight', [], true]) {
    assert.deepEqual(normalizeAnnotationStyle(value), DEFAULT_ANNOTATION_STYLE)
  }
  assert.deepEqual(normalizeAnnotationStyle({}), DEFAULT_ANNOTATION_STYLE)
  // The annotation itself doubles as a style source (type instead of mode).
  assert.equal(normalizeAnnotationStyle({ type: 'underline' }).mode, 'underline')

  const style = normalizeAnnotationStyle({
    mode: 'underline', color: '#ABC', strength: 0.5, thickness: 4, underlineStyle: 'wavy', extra: 'ignored',
  })
  assert.deepEqual(style, { mode: 'underline', color: '#abc', strength: 0.5, thickness: 4, underlineStyle: 'wavy' })
  assert.equal(Object.hasOwn(style, 'extra'), false)
  assert.equal(normalizeAnnotationStyle({ color: 'theme' }).color, 'theme')
  assert.equal(normalizeAnnotationStyle({ color: '#FA0' }).color, '#fa0')
  // Unknown enum values fall back to the default for that field only.
  assert.deepEqual(
    normalizeAnnotationStyle({ mode: 'marker', color: 'red', strength: -1, thickness: 99, underlineStyle: 'double' }),
    { mode: 'highlight', color: '#ffd23f', strength: 0.05, thickness: 6, underlineStyle: 'solid' },
  )
  assert.equal(normalizeAnnotationStyle({ strength: 9 }).strength, 0.9)
  assert.equal(normalizeAnnotationStyle({ strength: 0.333 }).strength, 0.33)
  assert.equal(normalizeAnnotationStyle({ thickness: 0 }).thickness, 1)
  assert.equal(normalizeAnnotationStyle({ thickness: 2.6 }).thickness, 3)
  assert.equal(normalizeAnnotationStyle({ color: '#ffff' }).color, '#ffd23f')
  assert.equal(normalizeAnnotationStyle({ color: 'rgb(255, 0, 0)' }).color, '#ffd23f')
})

test('sanitizeAnnotations round-trips a legal annotation with the exact plan shape', () => {
  const annotation = makeValid()
  const [clean] = sanitizeAnnotations([annotation])
  assert.deepEqual(clean, annotation)
  assert.deepEqual(Object.keys(clean).sort(), [...FIELD_NAMES].sort())
})

test('sanitizeAnnotations is a no-op for empty/invalid batch input', () => {
  for (const value of [undefined, null, 42, 'text', {}, true]) assert.deepEqual(sanitizeAnnotations(value), [])
  assert.deepEqual(sanitizeAnnotations([]), [])
})

test('sanitizeAnnotations drops malformed entries instead of the whole batch', () => {
  const malformed = [
    null, 42, 'text', [], {},
    makeValid({ type: 'bookmark' }),
    makeValid({ type: undefined }),
    makeValid({ chapterIndex: -1 }),
    makeValid({ chapterIndex: 1.5 }),
    makeValid({ chapterIndex: '3' }),
    makeValid({ start: -1 }),
    makeValid({ start: 10, end: 10 }),
    makeValid({ start: 1000, end: 999 }),
    makeValid({ start: undefined }),
    makeValid({ end: undefined }),
    makeValid({ quote: '' }),
    makeValid({ quote: '   ' }),
    makeValid({ quote: 42 }),
  ]
  assert.deepEqual(sanitizeAnnotations(malformed), [])
  // One bad entry never hides the good ones around it.
  const mixed = [malformed[0], makeValid({ id: 'an_good1' }), malformed[7], makeValid({ id: 'an_good2' })]
  assert.deepEqual(sanitizeAnnotations(mixed).map((item) => item.id), ['an_good1', 'an_good2'])
})

test('sanitizeAnnotations accepts mode as the type alias and repairs fields', () => {
  const [byMode] = sanitizeAnnotations([makeValid({ type: undefined, mode: 'underline' })])
  assert.equal(byMode.type, 'underline')
  const [repaired] = sanitizeAnnotations([makeValid({
    color: 'red', strength: 10, thickness: 0, underlineStyle: 'double', type: 'highlight',
  })])
  assert.equal(repaired.color, DEFAULT_ANNOTATION_STYLE.color)
  assert.equal(repaired.strength, 0.9)
  assert.equal(repaired.thickness, 1)
  assert.equal(repaired.underlineStyle, 'solid')
  assert.equal(repaired.type, 'highlight')
})

test('sanitizeAnnotations truncates quote/prefix/suffix and keeps the quoted context', () => {
  const digits = '0123456789'
  const [clean] = sanitizeAnnotations([makeValid({
    quote: '字'.repeat(600),
    prefix: digits.repeat(6),
    suffix: digits.repeat(6),
    label: '字'.repeat(600),
  })])
  assert.equal(Array.from(clean.quote).length, 500)
  // Prefix keeps the text closest to the anchor (tail), suffix keeps its head.
  assert.equal(clean.prefix, digits.repeat(4))
  assert.equal(clean.suffix, digits.repeat(4))
  assert.equal(Array.from(clean.prefix).length, 40)
  assert.equal(Array.from(clean.suffix).length, 40)
  assert.equal(Array.from(clean.label).length, 60)
  assert.ok(clean.label.endsWith('\u2026'))

  const [short] = sanitizeAnnotations([makeValid({ quote: '😀'.repeat(600) })])
  assert.equal(Array.from(short.quote).length, 500)
  assert.ok(!short.quote.includes('\ufffd'))

  const [custom] = sanitizeAnnotations(
    [makeValid({ quote: '一二三四五六七八九十', prefix: '123456', suffix: 'ABCDEF' })],
    { maxQuote: 5, maxPrefix: 2, maxSuffix: 3 },
  )
  assert.equal(custom.quote, '一二三四五')
  assert.equal(custom.prefix, '56')
  assert.equal(custom.suffix, 'ABC')
})

test('sanitizeAnnotations caps the annotation count per book', () => {
  const many = Array.from({ length: 1005 }, (_, index) => makeValid({
    id: `an_${index.toString(36)}`, start: index, end: index + 1,
  }))
  const clean = sanitizeAnnotations(many)
  assert.equal(clean.length, 1000)
  assert.equal(clean[0].start, 0)
  assert.equal(clean.at(-1).start, 999)
  assert.deepEqual(sanitizeAnnotations(many, { maxCount: 3 }).map((item) => item.start), [0, 1, 2])
  assert.deepEqual(sanitizeAnnotations(many, { maxCount: 0 }).length, 1000)
})

test('sanitizeAnnotations repairs ids/timestamps/labels and dedupes ids', () => {
  const [repaired] = sanitizeAnnotations([makeValid({
    id: 'bad id!', createdAt: 'yesterday', label: undefined, color: '#00ff88',
  })])
  assert.match(repaired.id, /^an_[0-9a-z]+$/)
  assert.ok(Number.isSafeInteger(repaired.createdAt) && repaired.createdAt > 0)
  assert.equal(repaired.label, annotationLabel(QUOTE))
  assert.equal(repaired.color, '#00ff88')

  const [fromQuote] = sanitizeAnnotations([makeValid({ label: undefined, quote: '  你好   世界\n第二行  ' })])
  assert.equal(fromQuote.label, '你好 世界 第二行')

  const [keptLabel] = sanitizeAnnotations([makeValid({ label: '  自定义   摘要  ' })])
  assert.equal(keptLabel.label, '自定义 摘要')

  const duplicates = sanitizeAnnotations([
    makeValid({ id: 'an_same', start: 1, end: 2 }),
    makeValid({ id: 'an_same', start: 5, end: 6 }),
    makeValid({ id: 'an_other', start: 7, end: 8 }),
  ])
  assert.deepEqual(duplicates.map((item) => item.id), ['an_same', 'an_other'])
  assert.equal(duplicates[0].start, 1)
})

test('sanitizeAnnotations is idempotent and does not mutate its input', () => {
  const input = [makeValid({ id: 'bad id!', color: 'red', quote: 'x'.repeat(600), createdAt: undefined })]
  const snapshot = structuredClone(input)
  const once = sanitizeAnnotations(input)
  assert.deepEqual(input, snapshot)
  assert.deepEqual(sanitizeAnnotations(once), once)
})

test('annotationLabel compresses whitespace and caps at 60 characters', () => {
  assert.equal(annotationLabel('  第一段\n\n 第二段\t第三段  '), '第一段 第二段 第三段')
  assert.equal(annotationLabel(''), '')
  assert.equal(annotationLabel('   '), '')
  assert.equal(annotationLabel(null), '')
  assert.equal(annotationLabel(42), '')
  assert.equal(annotationLabel('字'.repeat(60)), '字'.repeat(60))
  const long = annotationLabel('标'.repeat(80))
  assert.equal(Array.from(long).length, 60)
  assert.equal(long, `${'标'.repeat(59)}\u2026`)
  const astral = annotationLabel('😀'.repeat(80))
  assert.equal(Array.from(astral).length, 60)
  assert.ok(!astral.includes('\ufffd'))
})

test('anchorKey identifies chapter+range+type and ignores the rest', () => {
  const base = makeValid()
  const moved = makeValid({ id: 'an_other', color: '#000000', quote: '完全不同的引文', label: '不同的摘要' })
  assert.equal(anchorKey(base), 'underline:3:1234:1300')
  assert.equal(anchorKey(moved), anchorKey(base))
  assert.equal(hasSameAnchor(base, moved), true)
  assert.equal(hasSameAnchor(base, makeValid({ type: 'highlight' })), false)
  assert.equal(hasSameAnchor(base, makeValid({ chapterIndex: 4 })), false)
  assert.equal(hasSameAnchor(base, makeValid({ start: base.start + 1 })), false)
  assert.equal(hasSameAnchor(base, makeValid({ end: base.end + 1 })), false)
  assert.equal(anchorKey(null), null)
  assert.equal(anchorKey(makeValid({ end: base.start })), null)
  assert.equal(anchorKey(makeValid({ chapterIndex: -1 })), null)
  assert.equal(hasSameAnchor(null, base), false)
  assert.equal(hasSameAnchor(base, null), false)
  assert.equal(hasSameAnchor(null, null), false)
})

test('fromSelection builds a legal, style-aware annotation', () => {
  const selection = {
    chapterIndex: 2,
    start: 100,
    end: 140,
    quote: '选中的一段文字。',
    prefix: '前'.repeat(60),
    suffix: '后'.repeat(60),
    style: { mode: 'underline', color: '#123ABC', strength: 0.5, thickness: 3, underlineStyle: 'dashed' },
  }
  const created = fromSelection(selection)
  assert.ok(created)
  assert.match(created.id, /^an_[0-9a-z]+$/)
  assert.equal(created.type, 'underline')
  assert.equal(created.chapterIndex, 2)
  assert.equal(created.start, 100)
  assert.equal(created.end, 140)
  assert.equal(created.quote, selection.quote)
  assert.equal(Array.from(created.prefix).length, 40)
  assert.equal(Array.from(created.suffix).length, 40)
  assert.equal(created.prefix, selection.prefix.slice(-40))
  assert.equal(created.suffix, selection.suffix.slice(0, 40))
  assert.equal(created.color, '#123abc')
  assert.equal(created.strength, 0.5)
  assert.equal(created.thickness, 3)
  assert.equal(created.underlineStyle, 'dashed')
  assert.ok(Number.isSafeInteger(created.createdAt) && created.createdAt > 0)
  assert.equal(created.label, annotationLabel(selection.quote))
  assert.deepEqual(Object.keys(created).sort(), [...FIELD_NAMES].sort())
  // Everything fromSelection emits must survive its own sanitizer unchanged.
  assert.deepEqual(sanitizeAnnotations([created]), [created])

  const [plain] = [fromSelection({ chapterIndex: 0, start: 0, end: 5, quote: '文本' })]
  assert.deepEqual(
    { ...plain, id: undefined, createdAt: undefined },
    {
      id: undefined, type: 'highlight', chapterIndex: 0, start: 0, end: 5,
      quote: '文本', prefix: '', suffix: '', color: '#ffd23f', strength: 0.35, thickness: 2,
      underlineStyle: 'solid', createdAt: undefined, label: '文本',
    },
  )
})

test('fromSelection rejects unusable selections and truncates long quotes', () => {
  assert.equal(fromSelection(undefined), null)
  assert.equal(fromSelection(null), null)
  assert.equal(fromSelection('selection'), null)
  assert.equal(fromSelection({ start: 0, end: 5, quote: '文本' }), null)
  assert.equal(fromSelection({ chapterIndex: -1, start: 0, end: 5, quote: '文本' }), null)
  assert.equal(fromSelection({ chapterIndex: 0, start: -1, end: 5, quote: '文本' }), null)
  assert.equal(fromSelection({ chapterIndex: 0, start: 5, end: 5, quote: '文本' }), null)
  assert.equal(fromSelection({ chapterIndex: 0, start: 6, end: 5, quote: '文本' }), null)
  assert.equal(fromSelection({ chapterIndex: 0, start: 0, end: 5, quote: '  ' }), null)

  const long = fromSelection({ chapterIndex: 0, start: 0, end: 600, quote: '选'.repeat(600) })
  assert.equal(Array.from(long.quote).length, 500)
  const unknownStyle = fromSelection({
    chapterIndex: 0, start: 0, end: 1, quote: '文本', style: { mode: 'marker', color: 'red', strength: 99 },
  })
  assert.equal(unknownStyle.type, 'highlight')
  assert.equal(unknownStyle.color, '#ffd23f')
  assert.equal(unknownStyle.strength, 0.9)
})
