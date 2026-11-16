import { randomUUID } from 'node:crypto'

import { normalizeAnnotationStyle, sanitizeAnnotations } from '../assets/lib/annotations.mjs'
import { sanitizeFontSettings } from '../assets/reading-fonts.mjs'

// Sanitizers for the per-book `state.json` payload. Every stored value is
// bounded and cleaned here so a hand-edited or older file cannot reach the
// readers with an unexpected shape. `cleanText` and `clampNumber` are shared
// by the route modules, which is why they live with the state sanitizers.

const SETTING_THEMES = new Set(['auto', 'light', 'dark'])
const SETTING_PAGE_MARGINS = new Set(['standard', 'compact', 'fill'])
const SETTING_PAGE_MODES = new Set(['scroll', 'paged'])
const SETTING_PDF_FITS = new Set(['page', 'width', 'custom'])
const SETTING_PDF_VIEWS = new Set(['continuous', 'single'])

const MAX_BOOKMARKS = 500

function cleanText(value, fallback, limit = 500) {
  if (typeof value !== 'string') return fallback
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned === '') return fallback
  return cleaned.slice(0, limit)
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return Math.min(maximum, Math.max(minimum, number))
}

function sanitizeProgress(value, format) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const progress = {}
  progress.format = format === 'pdf' || format === 'epub' ? format : value.format === 'pdf' || value.format === 'epub' ? value.format : undefined
  if (progress.format === undefined) delete progress.format
  if (Number.isInteger(value.chapterIndex) && value.chapterIndex >= 0 && value.chapterIndex <= 100000) {
    progress.chapterIndex = value.chapterIndex
  }
  if (Number.isInteger(value.page) && value.page >= 1 && value.page <= 1000000) progress.page = value.page
  const scrollRatio = clampNumber(value.scrollRatio, 0, 1)
  if (scrollRatio !== undefined) progress.scrollRatio = scrollRatio
  const percent = clampNumber(value.percent, 0, 1)
  if (percent !== undefined) progress.percent = percent
  if (typeof value.anchor === 'string') progress.anchor = value.anchor.slice(0, 300)
  if (typeof value.chapterPath === 'string') progress.chapterPath = value.chapterPath.slice(0, 500)
  const updatedAt = clampNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER)
  progress.updatedAt = updatedAt === undefined ? Date.now() : updatedAt
  return progress
}

function sanitizeBookmarks(value) {
  if (!Array.isArray(value)) return undefined
  const bookmarks = []
  const seen = new Set()
  for (const item of value.slice(0, MAX_BOOKMARKS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(item.id) ? item.id : randomUUID()
    if (seen.has(id)) continue
    seen.add(id)
    const bookmark = {
      id,
      label: cleanText(item.label, '', 300),
      createdAt: clampNumber(item.createdAt, 0, Number.MAX_SAFE_INTEGER) ?? Date.now(),
    }
    if (item.format === 'pdf' || item.format === 'epub') bookmark.format = item.format
    if (Number.isInteger(item.chapterIndex) && item.chapterIndex >= 0 && item.chapterIndex <= 100000) {
      bookmark.chapterIndex = item.chapterIndex
    }
    if (Number.isInteger(item.page) && item.page >= 1 && item.page <= 1000000) bookmark.page = item.page
    const scrollRatio = clampNumber(item.scrollRatio, 0, 1)
    if (scrollRatio !== undefined) bookmark.scrollRatio = scrollRatio
    const percent = clampNumber(item.percent, 0, 1)
    if (percent !== undefined) bookmark.percent = percent
    if (typeof item.anchor === 'string') bookmark.anchor = item.anchor.slice(0, 300)
    bookmarks.push(bookmark)
  }
  return bookmarks
}

function sanitizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const settings = sanitizeFontSettings(value)
  const fontSize = clampNumber(value.fontSize, 12, 30)
  if (fontSize !== undefined) settings.fontSize = Math.round(fontSize)
  const lineHeight = clampNumber(value.lineHeight, 1.2, 2.5)
  if (lineHeight !== undefined) settings.lineHeight = Math.round(lineHeight * 100) / 100
  if (SETTING_PAGE_MARGINS.has(value.pageMargin)) settings.pageMargin = value.pageMargin
  if (SETTING_THEMES.has(value.theme)) settings.theme = value.theme
  if (SETTING_PAGE_MODES.has(value.pageMode)) settings.pageMode = value.pageMode
  if (value.pageSpread === 'auto' || value.pageSpread === 'single') settings.pageSpread = value.pageSpread
  if (SETTING_PDF_FITS.has(value.pdfFit)) settings.pdfFit = value.pdfFit
  const pdfZoom = clampNumber(value.pdfZoom, 0.5, 3)
  if (pdfZoom !== undefined) settings.pdfZoom = Math.round(pdfZoom * 100) / 100
  if (SETTING_PDF_VIEWS.has(value.pdfView)) settings.pdfView = value.pdfView
  // The Reader remembers the annotation style per book (§4.1 of the plan). It
  // is additive: a settings object without it keeps exactly its old shape, and
  // unknown modes/colours fall back field by field instead of rejecting the
  // whole write.
  if ('annotationStyle' in value) settings.annotationStyle = normalizeAnnotationStyle(value.annotationStyle)
  return settings
}

// Annotations are stored next to `bookmarks` and share their model with the
// Reader: `assets/lib/annotations.mjs` owns the field validation (bounds,
// truncation, colour whitelist, ≤1000 entries per book) and drops malformed
// entries instead of failing the whole write. Re-exported here so every state
// sanitizer stays behind the same module boundary.
export { sanitizeAnnotations }

export { cleanText, clampNumber, sanitizeProgress, sanitizeBookmarks, sanitizeSettings }
