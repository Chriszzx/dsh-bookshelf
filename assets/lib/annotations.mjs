// Annotation model shared by the Reader (client.js), the Host state
// sanitizers (host/states.js) and the unit tests. Everything here is plain
// data handling: no DOM, no React, no filesystem or network access, so the
// same module can be imported by Node and dynamically preloaded in the
// browser (see loadClientLib in client.js).
//
// Stored shape (state.json, next to bookmarks):
//   { id, type, chapterIndex, start, end, quote, prefix, suffix, color,
//     strength, thickness, underlineStyle, createdAt, label }
// `start`/`end` address the chapter's whitespace-normalised text; `end` is
// exclusive. The Host never rejects a whole batch: malformed entries are
// dropped and surviving fields are clamped/truncated instead.

const ANNOTATION_TYPES = Object.freeze(['highlight', 'underline'])
const UNDERLINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'wavy'])
const THEME_COLOR = 'theme'
const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

const MAX_ANNOTATIONS = 1000
const MAX_QUOTE_CHARS = 500
const MAX_PREFIX_CHARS = 40
const MAX_SUFFIX_CHARS = 40
const MAX_LABEL_CHARS = 60
const MIN_STRENGTH = 0.05
const MAX_STRENGTH = 0.9
const MIN_THICKNESS = 1
const MAX_THICKNESS = 6
const ELLIPSIS = '\u2026'

export const DEFAULT_ANNOTATION_STYLE = Object.freeze({
  mode: 'highlight',
  color: '#ffd23f',
  strength: 0.35,
  thickness: 2,
  underlineStyle: 'solid',
})

let idSequence = 0

// `an_<base36>` per the plan. Time + random keep ids unique across sessions
// and the in-process sequence keeps ids unique inside one millisecond. The id
// is also the CSS custom-highlight suffix (`bb-an-<id>`), so it stays in the
// same character class as bookmark ids.
export function newAnnotationId() {
  idSequence = (idSequence + 1) % 1_000_000
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `an_${time}${random}${idSequence.toString(36)}`
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

// Non-negative integer offsets/indices. Safe integers only: larger values
// cannot come from a DOM range and would poison later arithmetic.
function asIndex(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function roundHundredths(value) {
  return Math.round(value * 100) / 100
}

function normaliseMode(value) {
  return ANNOTATION_TYPES.includes(value) ? value : null
}

function normaliseColor(value) {
  if (value === THEME_COLOR) return THEME_COLOR
  if (typeof value === 'string' && COLOR_PATTERN.test(value)) return value.toLowerCase()
  return null
}

// Truncate by code points so astral characters are never split in half.
function truncateHead(text, limit) {
  if (text.length <= limit) return text
  const characters = Array.from(text)
  return characters.length <= limit ? text : characters.slice(0, limit).join('')
}

function truncateTail(text, limit) {
  if (text.length <= limit) return text
  const characters = Array.from(text)
  return characters.length <= limit ? text : characters.slice(characters.length - limit).join('')
}

// Stored text fields never carry control characters; layout whitespace is
// kept as-is (quote is the selected original), only trimmed at the edges.
function cleanText(value, limit, keep = 'head') {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ').trim()
  if (cleaned === '') return ''
  return (keep === 'tail' ? truncateTail : truncateHead)(cleaned, limit)
}

function normaliseStyle(value) {
  const source = isRecord(value) ? value : {}
  const mode = normaliseMode(source.mode) ?? normaliseMode(source.type) ?? DEFAULT_ANNOTATION_STYLE.mode
  const color = normaliseColor(source.color) ?? DEFAULT_ANNOTATION_STYLE.color
  const strength = typeof source.strength === 'number' && Number.isFinite(source.strength)
    ? roundHundredths(clamp(source.strength, MIN_STRENGTH, MAX_STRENGTH))
    : DEFAULT_ANNOTATION_STYLE.strength
  const thickness = typeof source.thickness === 'number' && Number.isFinite(source.thickness)
    ? Math.round(clamp(source.thickness, MIN_THICKNESS, MAX_THICKNESS))
    : DEFAULT_ANNOTATION_STYLE.thickness
  const underlineStyle = UNDERLINE_STYLES.includes(source.underlineStyle)
    ? source.underlineStyle
    : DEFAULT_ANNOTATION_STYLE.underlineStyle
  return { mode, color, strength, thickness, underlineStyle }
}

// Style settings live in state.settings.annotationStyle (per book, with the
// global constant as the fallback). Unknown modes/colours fall back per field
// instead of dropping the whole object.
export function normalizeAnnotationStyle(value) {
  return normaliseStyle(value)
}

// Panel summary: whitespace runs collapse to one space and the result stays
// within 60 code points, ending in an ellipsis only when truncated.
export function annotationLabel(quote) {
  if (typeof quote !== 'string') return ''
  const compact = quote.replace(/[\u0000-\u001f\u007f-\u009f\s]+/gu, ' ').trim()
  if (compact === '') return ''
  const characters = Array.from(compact)
  if (characters.length <= MAX_LABEL_CHARS) return compact
  return `${characters.slice(0, MAX_LABEL_CHARS - 1).join('')}${ELLIPSIS}`
}

// Dedupe key for «same anchor, new annotation replaces the old one»
// (§4.1): chapter + start + end + type. id/quote/style are deliberately not
// part of the key.
export function anchorKey(annotation) {
  if (!isRecord(annotation)) return null
  const type = normaliseMode(annotation.type) ?? normaliseMode(annotation.mode)
  const chapterIndex = asIndex(annotation.chapterIndex)
  const start = asIndex(annotation.start)
  const end = asIndex(annotation.end)
  if (type === null || chapterIndex === null || start === null || end === null || end <= start) return null
  return `${type}:${chapterIndex}:${start}:${end}`
}

export function hasSameAnchor(left, right) {
  const key = anchorKey(left)
  return key !== null && key === anchorKey(right)
}

function sanitizeAnnotation(item, limits) {
  if (!isRecord(item)) return null
  const type = normaliseMode(item.type) ?? normaliseMode(item.mode)
  if (type === null) return null
  const chapterIndex = asIndex(item.chapterIndex)
  const start = asIndex(item.start)
  const end = asIndex(item.end)
  if (chapterIndex === null || start === null || end === null || end <= start) return null
  const quote = cleanText(item.quote, limits.maxQuote)
  if (quote === '') return null
  const id = typeof item.id === 'string' && ID_PATTERN.test(item.id) ? item.id : newAnnotationId()
  // A prefix precedes the quote, so a truncated one keeps its tail (the text
  // closest to the anchor); a suffix keeps its head for the same reason.
  const prefix = cleanText(item.prefix, limits.maxPrefix, 'tail')
  const suffix = cleanText(item.suffix, limits.maxSuffix)
  const style = normaliseStyle(item)
  const label = annotationLabel(typeof item.label === 'string' ? item.label : '') || annotationLabel(quote)
  const createdAt = asIndex(item.createdAt) ?? Date.now()
  return {
    id,
    type,
    chapterIndex,
    start,
    end,
    quote,
    prefix,
    suffix,
    color: style.color,
    strength: style.strength,
    thickness: style.thickness,
    underlineStyle: style.underlineStyle,
    createdAt,
    label,
  }
}

// Host/Client shared sanitizer: always returns an array, never throws.
// `limits` may override { maxCount, maxQuote, maxPrefix, maxSuffix } for
// tests; production uses the §4.1 defaults (≤1000 annotations per book).
export function sanitizeAnnotations(value, limits) {
  if (!Array.isArray(value)) return []
  const source = isRecord(limits) ? limits : {}
  const resolved = {
    maxCount: asCount(source.maxCount) ?? MAX_ANNOTATIONS,
    maxQuote: asCount(source.maxQuote) ?? MAX_QUOTE_CHARS,
    maxPrefix: asCount(source.maxPrefix) ?? MAX_PREFIX_CHARS,
    maxSuffix: asCount(source.maxSuffix) ?? MAX_SUFFIX_CHARS,
  }
  const annotations = []
  const ids = new Set()
  for (const item of value) {
    if (annotations.length >= resolved.maxCount) break
    const annotation = sanitizeAnnotation(item, resolved)
    if (annotation === null || ids.has(annotation.id)) continue
    ids.add(annotation.id)
    annotations.push(annotation)
  }
  return annotations
}

// Build a legal annotation from a DOM selection (client.js glue). Returns
// null when the selection itself cannot be anchored (no quote, bad range):
// callers show no menu action instead of throwing inside an event handler.
export function fromSelection(selection) {
  if (!isRecord(selection)) return null
  const chapterIndex = asIndex(selection.chapterIndex)
  const start = asIndex(selection.start)
  const end = asIndex(selection.end)
  if (chapterIndex === null || start === null || end === null || end <= start) return null
  const quote = cleanText(selection.quote, MAX_QUOTE_CHARS)
  if (quote === '') return null
  const style = normaliseStyle(selection.style)
  return {
    id: newAnnotationId(),
    type: style.mode,
    chapterIndex,
    start,
    end,
    quote,
    prefix: cleanText(selection.prefix, MAX_PREFIX_CHARS, 'tail'),
    suffix: cleanText(selection.suffix, MAX_SUFFIX_CHARS),
    color: style.color,
    strength: style.strength,
    thickness: style.thickness,
    underlineStyle: style.underlineStyle,
    createdAt: Date.now(),
    label: annotationLabel(quote),
  }
}
