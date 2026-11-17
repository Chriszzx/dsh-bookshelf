// Reading-list model for the reader's bookmark / annotation panel. It merges
// whole-page bookmarks with highlights and underlines into one flat list and
// gives the panel stable ordering, search and counts. Pure functions only: no
// DOM, no React and no locale text. Chapter names come from the caller through
// `chapterLabels`, and the page fallback can be overridden with `pageLabel`, so
// the same module is importable by Node (unit tests) and by client.js (dynamic
// import from the reader preload).
//
// Every merged entry has the same shape:
//   {
//     id,            stable React key (stored id, or a positional fallback)
//     kind,          'bookmark' | 'highlight' | 'underline'
//     label,         main panel text
//     detail,        secondary text: chapter name (bookmarks), chapter + time
//                    (annotations)
//     chapterIndex,  non-negative chapter index, undefined when not applicable
//     position,      numeric reading position used by the `position` sort
//                    (bookmarks: page, else book progress/scroll ratio;
//                    annotations: chapter text offset)
//     createdAt,     stored timestamp, 0 when missing
//     source,        the original bookmark / annotation object
//   }
//
// Bookmarks keep their stored order first, then annotations keep their stored
// order; the panel always applies sortReadingItems, so this order only decides
// ties (and the within-kind order of `kind` sorting).

import { annotationLabel } from './annotations.mjs'

const SORT_KIND_RANK = Object.freeze({ highlight: 0, underline: 1, bookmark: 2 })
const FALLBACK_TEXT_LIMIT = 300

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNegativeNumber(value) {
  const number = finiteNumber(value)
  return number !== undefined && number >= 0 ? number : undefined
}

function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function positiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

function clampUnit(value) {
  const number = finiteNumber(value)
  if (number === undefined) return undefined
  return Math.min(1, Math.max(0, number))
}

// Panel text is single-line and bounded: stored values are cleaned by the Host,
// but the model still tolerates hand-edited state and direct test fixtures.
function text(value, limit = FALLBACK_TEXT_LIMIT) {
  if (typeof value !== 'string') return ''
  const compact = value.replace(/[\u0000-\u001f\u007f-\u009f\s]+/gu, ' ').trim()
  if (compact === '') return ''
  return compact.length <= limit ? compact : compact.slice(0, limit)
}

function chapterEntryLabel(entry) {
  if (typeof entry === 'string') return text(entry)
  if (isRecord(entry)) {
    for (const key of ['label', 'title', 'name']) {
      const candidate = text(entry[key])
      if (candidate !== '') return candidate
    }
  }
  return ''
}

// `chapterLabels` may be a plain object/Map keyed by chapter index, an array
// (either indexed by chapter index or a TOC-like list of `{ chapterIndex,
// label }` entries) or a function used as a lazy localised formatter.
function chapterNameFor(chapterLabels, chapterIndex) {
  if (chapterIndex === undefined) return ''
  if (typeof chapterLabels === 'function') return text(chapterLabels(chapterIndex))
  if (Array.isArray(chapterLabels)) {
    const direct = chapterEntryLabel(chapterLabels[chapterIndex])
    if (direct !== '') return direct
    for (const entry of chapterLabels) {
      if (isRecord(entry) && entry.chapterIndex === chapterIndex) return chapterEntryLabel(entry)
    }
    return ''
  }
  if (chapterLabels instanceof Map) {
    return chapterEntryLabel(chapterLabels.get(chapterIndex))
      || chapterEntryLabel(chapterLabels.get(String(chapterIndex)))
  }
  if (isRecord(chapterLabels)) {
    return chapterEntryLabel(chapterLabels[chapterIndex])
      || chapterEntryLabel(chapterLabels[String(chapterIndex)])
  }
  return ''
}

// Local time without toLocaleString, so the output never depends on the
// browser/OS locale. The panel only needs the minute-level stamp.
function formatClock(value) {
  const stamp = finiteNumber(value)
  if (stamp === undefined) return ''
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function itemId(kind, value, index) {
  const stored = typeof value === 'string' ? value.trim() : ''
  return stored === '' ? `${kind}-${index}` : stored
}

// Fallback label for a bookmark whose stored label was empty (legacy or
// hand-edited state): "第 N 页 · x%".
// Callers that render another language can pass `pageLabel(page)`.
function fallbackBookmarkLabel(bookmark, pageLabel) {
  const parts = []
  const page = positiveInteger(bookmark.page)
  if (page !== undefined) {
    const formatted = typeof pageLabel === 'function' ? text(pageLabel(page)) : `第 ${page} 页`
    if (formatted !== '') parts.push(formatted)
  }
  const percent = clampUnit(bookmark.percent)
  if (percent !== undefined) parts.push(`${Math.round(percent * 100)}%`)
  return parts.join(' · ')
}

function bookmarkLabel(bookmark, chapterName, pageLabel) {
  const stored = text(bookmark.label)
  if (stored !== '') return stored
  const fallback = fallbackBookmarkLabel(bookmark, pageLabel)
  return fallback !== '' ? fallback : chapterName
}

function bookmarkPosition(bookmark) {
  const page = positiveInteger(bookmark.page)
  if (page !== undefined) return page
  const percent = clampUnit(bookmark.percent)
  if (percent !== undefined) return percent
  return clampUnit(bookmark.scrollRatio) ?? 0
}

/**
 * Classifies a raw bookmark/annotation or an already-merged item.
 * Returns 'bookmark' | 'highlight' | 'underline', or null for records whose
 * type is unknown (the merge skips those) or that are not records at all.
 */
export function readingKind(item) {
  if (!isRecord(item)) return null
  const declared = typeof item.kind === 'string' ? item.kind : typeof item.type === 'string' ? item.type : ''
  if (declared === 'bookmark' || declared === 'highlight' || declared === 'underline') return declared
  if (declared !== '') return null
  // Stored bookmarks have no `type`: recognise them by their anchor fields.
  if (item.page !== undefined || item.anchor !== undefined || item.scrollRatio !== undefined
    || item.format === 'pdf' || item.format === 'epub') return 'bookmark'
  return null
}

function mergeBookmark(bookmark, index, chapterLabels, pageLabel) {
  const chapterIndex = nonNegativeInteger(bookmark.chapterIndex)
  const chapterName = chapterNameFor(chapterLabels, chapterIndex)
  const createdAt = finiteNumber(bookmark.createdAt)
  return {
    id: itemId('bookmark', bookmark.id, index),
    kind: 'bookmark',
    label: bookmarkLabel(bookmark, chapterName, pageLabel),
    detail: chapterName,
    chapterIndex,
    position: bookmarkPosition(bookmark),
    createdAt: createdAt === undefined ? 0 : createdAt,
    source: bookmark,
  }
}

function mergeAnnotation(annotation, index, chapterLabels) {
  const kind = readingKind(annotation)
  // Unknown types are dropped, not turned into bookmarks: the panel only knows
  // the two annotation types it can render.
  if (kind !== 'highlight' && kind !== 'underline') return null
  const chapterIndex = nonNegativeInteger(annotation.chapterIndex)
  const chapterName = chapterNameFor(chapterLabels, chapterIndex)
  const createdAt = finiteNumber(annotation.createdAt)
  const detailParts = []
  if (chapterName !== '') detailParts.push(chapterName)
  const clock = formatClock(createdAt)
  if (clock !== '') detailParts.push(clock)
  let label = ''
  try {
    label = text(annotationLabel(typeof annotation.quote === 'string' ? annotation.quote : ''))
  } catch {
    // A broken annotation must not take down the whole panel.
    label = ''
  }
  if (label === '') label = text(annotation.label)
  const position = nonNegativeNumber(annotation.start)
  return {
    id: itemId(kind, annotation.id, index),
    kind,
    label,
    detail: detailParts.join(' · '),
    chapterIndex,
    position: position === undefined ? 0 : position,
    createdAt: createdAt === undefined ? 0 : createdAt,
    source: annotation,
  }
}

/**
 * Merges stored bookmarks with stored annotations into the panel list.
 *
 * @param {{ bookmarks?: unknown[], annotations?: unknown[],
 *   chapterLabels?: unknown, pageLabel?: (page: number) => string }} [options]
 *   `chapterLabels` supplies chapter names: object/Map keyed by chapter index,
 *   an array (indexed, or TOC-like `{ chapterIndex, label }` entries) or a
 *   function(index) => name. `pageLabel` optionally localises the bookmark
 *   fallback "第 N 页".
 * @returns {object[]} ReadingItem[]: bookmarks first, then annotations.
 */
export function mergeReadingItems(options) {
  const source = isRecord(options) ? options : {}
  const { bookmarks, annotations, chapterLabels, pageLabel } = source
  const items = []
  if (Array.isArray(bookmarks)) {
    for (let index = 0; index < bookmarks.length; index += 1) {
      const bookmark = bookmarks[index]
      if (!isRecord(bookmark)) continue
      items.push(mergeBookmark(bookmark, index, chapterLabels, pageLabel))
    }
  }
  if (Array.isArray(annotations)) {
    for (let index = 0; index < annotations.length; index += 1) {
      const annotation = annotations[index]
      if (!isRecord(annotation)) continue
      const item = mergeAnnotation(annotation, index, chapterLabels)
      if (item !== null) items.push(item)
    }
  }
  return items
}

function chapterOf(item) {
  if (!isRecord(item)) return -1
  const value = nonNegativeInteger(item.chapterIndex)
  return value === undefined ? -1 : value
}

function positionOf(item) {
  return isRecord(item) ? finiteNumber(item.position) ?? 0 : 0
}

function createdAtOf(item) {
  return isRecord(item) ? finiteNumber(item.createdAt) ?? 0 : 0
}

function kindRankOf(item) {
  const kind = readingKind(item)
  return kind === null ? 3 : SORT_KIND_RANK[kind]
}

// Position order is chapter-major so mixed bookmark/annotation lists still read
// front-to-back; the second key is the type-specific `position` documented at
// the top of this file.
function comparePosition(left, right) {
  const chapter = chapterOf(left) - chapterOf(right)
  if (chapter !== 0) return chapter
  return positionOf(left) - positionOf(right)
}

const SORT_COMPARATORS = Object.freeze({
  position: comparePosition,
  recent: (left, right) => createdAtOf(right) - createdAtOf(left),
  kind: (left, right) => kindRankOf(left) - kindRankOf(right),
})

/**
 * Returns a sorted copy of `items`.
 * mode `position` = reading order, `recent` = newest first, `kind` =
 * highlight → underline → bookmark. Unknown modes return an unsorted copy;
 * ties keep the incoming order.
 */
export function sortReadingItems(items, mode) {
  if (!Array.isArray(items)) return []
  const compare = SORT_COMPARATORS[mode]
  if (typeof compare !== 'function') return items.slice()
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => compare(left.item, right.item) || left.index - right.index)
    .map((entry) => entry.item)
}

function matchesQuery(item, needle) {
  if (!isRecord(item)) return false
  for (const value of [item.label, item.detail]) {
    if (typeof value === 'string' && value.toLowerCase().includes(needle)) return true
  }
  return false
}

/**
 * Case-insensitive substring search on `label` and `detail`. A blank query
 * returns the original array unchanged (not a copy), so callers can skip
 * re-sorting when the search box is empty.
 */
export function filterReadingItems(items, query) {
  if (!Array.isArray(items)) return []
  if (typeof query !== 'string') return items
  const needle = query.trim().toLowerCase()
  if (needle === '') return items
  return items.filter((item) => matchesQuery(item, needle))
}

/**
 * Counts the panel list: `total` is the number of rows, the other keys are the
 * rows per kind (unknown kinds only count towards `total`).
 */
export function countReadingItems(items) {
  const counts = { total: 0, bookmark: 0, highlight: 0, underline: 0 }
  if (!Array.isArray(items)) return counts
  counts.total = items.length
  for (const item of items) {
    const kind = readingKind(item)
    if (kind === 'bookmark' || kind === 'highlight' || kind === 'underline') counts[kind] += 1
  }
  return counts
}
