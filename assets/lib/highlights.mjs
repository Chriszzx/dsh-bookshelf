/**
 * CSS Custom Highlight plan for the reader: one inverted layer for the sentence
 * being read aloud plus one layer per annotation, with annotations winning on
 * overlap. The plan itself is plain data (no DOM), so the Node unit tests can
 * pin colours, priorities, chapter filtering and the overlay fallback; only
 * applyHighlightPlan / clearHighlights touch a real document.
 *
 * Two layers in one plan:
 *   bb-ra       spoken sentence  color = palette.bg, background-color = palette.fg  priority 0
 *   bb-an-<id>  annotation       highlight: color-mix(); underline: text-decoration-*  priority 100
 *
 * client.js is a classic script, so this file is loaded with a dynamic import.
 * Range values are passed through opaquely (`readAloud.range` and an optional
 * `range` or `ranges` on each annotation): they are only real DOM Ranges on the
 * browser path. When `plan.fallback === 'overlay'`, the caller paints the
 * legacy marker band itself; this module then applies no CSS highlights.
 */

export const READ_ALOUD_HIGHLIGHT = 'bb-ra'
export const ANNOTATION_HIGHLIGHT_PREFIX = 'bb-an-'

// The annotation layer paints above the read-aloud layer, so a highlighted or
// underlined sentence keeps its annotation look while it is being spoken.
export const READ_ALOUD_PRIORITY = 0
export const ANNOTATION_PRIORITY = 100

// Mirrors the annotation model defaults (§4.1); used only when a record from
// an older state file is missing a style field. The model layer sanitises
// records first, so this is a fallback, not a second validator.
export const HIGHLIGHT_PLAN_DEFAULTS = Object.freeze({
  strength: 0.35,
  thickness: 2,
  underlineStyle: 'solid',
})

const STRENGTH_MIN = 0.05
const STRENGTH_MAX = 0.9
const THICKNESS_MIN = 1
const THICKNESS_MAX = 6
const UNDERLINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'wavy'])
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const HIGHLIGHT_STYLE_ATTR = 'data-bb-highlight-styles'
const MANAGED_HIGHLIGHT_NAME = /^(?:bb-ra|bb-an-)/
const CSS_PROPERTY_NAME = /^-{0,2}[a-z][a-z-]*$/
const CSS_DECLARATION_VALUE = /^[^;{}<>\n\r]+$/
const CSS_CUSTOM_IDENT = /^[A-Za-z][A-Za-z0-9_-]*$/

// ------------------------------------------------------------------- helpers

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function chapterNumberOf(value) {
  const number = finiteNumber(value)
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null
}

// --------------------------------------------------------------------- names

// `bb-an-<id>` with the stored id reduced to a CSS custom highlight identifier.
// The fixed prefix keeps the name a valid <custom-ident> even when the id starts
// with a digit or contains separators a highlight name must not carry.
export function annotationHighlightName(annotation) {
  const id = annotation !== null && typeof annotation === 'object' ? trimmedString(annotation.id) : ''
  if (id === '') return ''
  return `${ANNOTATION_HIGHLIGHT_PREFIX}${id.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

// Capability probe for the CSS Custom Highlight API: the registry has to be
// map-like and the Highlight constructor has to exist in the same window.
export function supportsCustomHighlights(win) {
  if (win === null || win === undefined) return false
  if (typeof win !== 'object' && typeof win !== 'function') return false
  const css = win.CSS
  if (css === null || typeof css !== 'object') return false
  const registry = css.highlights
  if (registry === null || typeof registry !== 'object') return false
  if (typeof registry.set !== 'function' || typeof registry.delete !== 'function') return false
  return typeof win.Highlight === 'function'
}

// ------------------------------------------------------------------- palette

// '#rgb' / '#rrggbb' pass through; 'theme' follows the active reading palette,
// so pinned light pages, pinned dark pages and live DSH themes all keep their
// own accent instead of a hard-coded annotation colour.
function resolveAnnotationColor(annotation, palette) {
  const color = trimmedString(annotation !== null && typeof annotation === 'object' ? annotation.color : '')
  if (color.toLowerCase() === 'theme') {
    const accent = trimmedString(palette !== null && palette !== undefined ? palette.accent : '')
    if (accent !== '') return accent
    const fg = trimmedString(palette !== null && palette !== undefined ? palette.fg : '')
    if (fg !== '') return fg
    // Highlight pseudo-elements inherit the element colour, so currentColor is
    // the one theme-independent fallback.
    return 'currentColor'
  }
  return HEX_COLOR.test(color) ? color : ''
}

// `<strength × 100>%` without trailing zeroes: 0.35 -> 35%, 0.075 -> 7.5%.
function strengthPercentage(annotation) {
  const raw = finiteNumber(annotation !== null && typeof annotation === 'object' ? annotation.strength : null)
  const strength = raw === null ? HIGHLIGHT_PLAN_DEFAULTS.strength : clamp(raw, STRENGTH_MIN, STRENGTH_MAX)
  return `${Number((strength * 100).toFixed(2))}%`
}

function underlineThickness(annotation) {
  const raw = finiteNumber(annotation !== null && typeof annotation === 'object' ? annotation.thickness : null)
  const thickness = raw === null ? HIGHLIGHT_PLAN_DEFAULTS.thickness : clamp(raw, THICKNESS_MIN, THICKNESS_MAX)
  return `${Number(thickness.toFixed(2))}px`
}

function underlineStyleValue(annotation) {
  const style = trimmedString(annotation !== null && typeof annotation === 'object' ? annotation.underlineStyle : '').toLowerCase()
  return UNDERLINE_STYLES.includes(style) ? style : HIGHLIGHT_PLAN_DEFAULTS.underlineStyle
}

// ------------------------------------------------------------------- entries

// Ranges stay opaque descriptors: buildHighlightPlan must work without a DOM,
// so it only forwards the range objects the caller resolved.
function sourceRanges(source) {
  if (source === null || typeof source !== 'object') return []
  if (Array.isArray(source.ranges)) {
    return source.ranges.filter((range) => range !== null && typeof range === 'object')
  }
  const range = source.range
  return range !== null && typeof range === 'object' ? [range] : []
}

function readAloudEntry(palette, readAloud) {
  const page = trimmedString(palette !== null && palette !== undefined ? palette.bg : '')
  const ink = trimmedString(palette !== null && palette !== undefined ? palette.fg : '')
  const ranges = sourceRanges(readAloud)
  if (page === '' || ink === '' || ranges.length === 0) return null
  // True inversion: the page colour becomes the ink and the text colour the
  // band, so a light page reads light-on-dark and a dark page dark-on-light.
  // The two palette values are swapped on purpose.
  return {
    name: READ_ALOUD_HIGHLIGHT,
    priority: READ_ALOUD_PRIORITY,
    css: { color: page, 'background-color': ink },
    ranges,
  }
}

function annotationEntry(annotation, palette, chapterIndex) {
  if (annotation === null || typeof annotation !== 'object') return null
  const name = annotationHighlightName(annotation)
  if (name === '') return null
  if (chapterNumberOf(annotation.chapterIndex) !== chapterIndex) return null
  const color = resolveAnnotationColor(annotation, palette)
  if (color === '') return null
  const ranges = sourceRanges(annotation)
  const type = trimmedString(annotation.type).toLowerCase()
  if (type === 'highlight') {
    return {
      name,
      priority: ANNOTATION_PRIORITY,
      css: { 'background-color': `color-mix(in srgb, ${color} ${strengthPercentage(annotation)}, transparent)` },
      ranges,
    }
  }
  if (type !== 'underline') return null
  return {
    name,
    priority: ANNOTATION_PRIORITY,
    css: {
      'text-decoration-line': 'underline',
      'text-decoration-color': color,
      'text-decoration-thickness': underlineThickness(annotation),
      'text-decoration-style': underlineStyleValue(annotation),
    },
    ranges,
  }
}

// ---------------------------------------------------------------- plan build

/**
 * Build the render plan for one chapter.
 * @param {object} input
 * @param {{fg?: string, bg?: string, accent?: string} | null} [input.palette]
 *   Active reading palette; every colour in the plan comes from here.
 * @param {{range?: object, ranges?: object[]} | null} [input.readAloud]
 *   Range of the sentence being spoken, or null when nothing is being read.
 * @param {object[]} [input.annotations] Chapter annotations; optional
 *   `range`/`ranges` on an item is forwarded for the DOM layer.
 * @param {number} [input.chapterIndex] Only annotations from this chapter are
 *   included; null/undefined includes none (read-aloud is unaffected).
 * @param {object | null} [input.win] Window for the support probe; defaults to
 *   globalThis, which is the reader window in the browser and has no
 *   CSS.highlights in Node.
 * @param {boolean} [input.customHighlights] Explicit probe override, so tests
 *   and fallback exercises do not have to fake a window.
 * @returns {{entries: Array<{name: string, priority: number, css: object, ranges: object[]}>,
 *   fallback: null | 'overlay'}}
 */
export function buildHighlightPlan({
  palette = null,
  readAloud = null,
  annotations = [],
  chapterIndex = null,
  win,
  customHighlights,
} = {}) {
  const windowLike = win === undefined ? (typeof globalThis === 'undefined' ? null : globalThis) : win
  const supported = typeof customHighlights === 'boolean' ? customHighlights : supportsCustomHighlights(windowLike)
  const chapter = chapterNumberOf(chapterIndex)
  const entries = []
  const spoken = readAloudEntry(palette, readAloud)
  if (spoken !== null) entries.push(spoken)
  // Duplicate ids collapse to one layer; the later record wins, matching what
  // CSS.highlights.set would do if the plan were applied entry by entry.
  const byName = new Map()
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    const entry = chapter === null ? null : annotationEntry(annotation, palette, chapter)
    if (entry !== null) byName.set(entry.name, entry)
  }
  for (const entry of byName.values()) entries.push(entry)
  // When the browser has no CSS Custom Highlight API, the caller paints the
  // legacy marker band / translucent annotation band itself.
  return { entries, fallback: supported ? null : 'overlay' }
}

// ------------------------------------------------------------------ DOM apply

// Style element per chapter document plus the highlight names this module
// currently owns there. Keyed weakly: the reader may swap chapter documents, and
// a replaced document takes its state with it.
const documentScopes = new WeakMap()

function documentOf(node) {
  if (node === null || typeof node !== 'object') return null
  if (node.nodeType === 9) return node
  const owner = node.ownerDocument
  return owner !== null && typeof owner === 'object' ? owner : null
}

function scopeFor(documentNode) {
  const doc = documentOf(documentNode)
  if (doc === null) return null
  const win = doc.defaultView || doc.parentWindow || null
  let state = documentScopes.get(doc)
  if (state === undefined) {
    state = { style: null, names: new Set() }
    documentScopes.set(doc, state)
  }
  return { doc, win: win !== null && typeof win === 'object' ? win : null, state }
}

function declarationsText(css) {
  if (css === null || typeof css !== 'object') return ''
  const declarations = []
  for (const property of Object.keys(css)) {
    if (!CSS_PROPERTY_NAME.test(property)) continue
    const value = trimmedString(css[property])
    // Values come from the palette and the sanitised annotation model; still
    // reject anything that could break out of the declaration block.
    if (value === '' || !CSS_DECLARATION_VALUE.test(value)) continue
    declarations.push(`${property}: ${value};`)
  }
  return declarations.join(' ')
}

function stylesheetText(entries) {
  const rules = []
  const seen = new Set()
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name : ''
    if (!CSS_CUSTOM_IDENT.test(name) || seen.has(name)) continue
    seen.add(name)
    const declarations = declarationsText(entry.css)
    if (declarations === '') continue
    rules.push(`::highlight(${name}) { ${declarations} }`)
  }
  return rules.length === 0 ? '' : `${rules.join('\n')}\n`
}

function styleElementFor(doc, state) {
  const current = state.style
  if (current !== null && current.ownerDocument === doc && current.parentNode !== null) return current
  const parent = doc.head || doc.documentElement
  if (parent === null || parent === undefined || typeof doc.createElement !== 'function') return null
  const style = doc.createElement('style')
  style.setAttribute(HIGHLIGHT_STYLE_ATTR, '')
  parent.appendChild(style)
  state.style = style
  return style
}

function removeStyles(doc, state) {
  const style = state.style
  if (style !== null && style.parentNode !== null) style.parentNode.removeChild(style)
  state.style = null
  if (typeof doc.querySelectorAll !== 'function') return
  try {
    for (const stray of Array.from(doc.querySelectorAll(`style[${HIGHLIGHT_STYLE_ATTR}]`))) {
      if (stray.parentNode !== null) stray.parentNode.removeChild(stray)
    }
  } catch {
    // Cross-origin or detached documents may hide their nodes; the tracked
    // style element was already removed above.
  }
}

function removeRegistryName(win, name) {
  if (win === null) return
  try {
    win.CSS.highlights.delete(name)
  } catch {
    // The registry (or the window) is gone: nothing left to clean up.
  }
}

function resetScope(doc, win, state) {
  const removed = []
  if (win !== null) {
    for (const name of Array.from(state.names)) {
      removeRegistryName(win, name)
      removed.push(name)
    }
  }
  state.names.clear()
  removeStyles(doc, state)
  return removed
}

/**
 * Write the `::highlight()` rules and register the ranges, removing layers the
 * previous paint owned. Only call this on the browser path: Node has no
 * document, where it is a safe no-op.
 * @param {Document | null} documentNode Chapter document (the reader iframe).
 * @param {{entries?: object[], fallback?: null | 'overlay'} | null} plan
 * @returns {{applied: string[], removed: string[], supported: boolean}}
 */
export function applyHighlightPlan(documentNode, plan) {
  const scope = scopeFor(documentNode)
  if (scope === null) return { applied: [], removed: [], supported: false }
  const { doc, win, state } = scope
  const supported = supportsCustomHighlights(win)
  const entries = Array.isArray(plan) ? plan : plan !== null && plan !== undefined && Array.isArray(plan.entries) ? plan.entries : []
  const overlay = plan !== null && plan !== undefined && !Array.isArray(plan) && plan.fallback === 'overlay'
  if (!supported || overlay) {
    return { applied: [], removed: resetScope(doc, win, state), supported }
  }
  const desired = new Set()
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.name === 'string' && CSS_CUSTOM_IDENT.test(entry.name)) desired.add(entry.name)
  }
  // Old-name maintenance: a sentence change drops bb-ra, a deleted annotation
  // drops its bb-an-<id>, without the caller tracking names itself.
  const removed = []
  for (const name of Array.from(state.names)) {
    if (desired.has(name)) continue
    removeRegistryName(win, name)
    state.names.delete(name)
    removed.push(name)
  }
  const style = styleElementFor(doc, state)
  if (style !== null) {
    const text = stylesheetText(entries)
    if (style.textContent !== text) style.textContent = text
  }
  const applied = []
  const appliedNames = new Set()
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name : ''
    if (!desired.has(name)) continue
    const ranges = Array.isArray(entry.ranges)
      ? entry.ranges.filter((range) => range !== null && typeof range === 'object')
      : []
    if (ranges.length === 0) {
      // Styles were written, but there is nothing to paint over this repaint;
      // drop the stale layer instead of keeping the previous range alive.
      if (state.names.delete(name)) {
        removeRegistryName(win, name)
        removed.push(name)
      }
      continue
    }
    try {
      const highlight = new win.Highlight(...ranges)
      if (Number.isFinite(entry.priority)) highlight.priority = entry.priority
      win.CSS.highlights.set(name, highlight)
      state.names.add(name)
      if (!appliedNames.has(name)) {
        appliedNames.add(name)
        applied.push(name)
      }
    } catch {
      // A stale Range from a replaced chapter must not break the repaint.
      if (state.names.delete(name)) {
        removeRegistryName(win, name)
        removed.push(name)
      }
    }
  }
  return { applied, removed, supported }
}

/**
 * Remove every highlight layer this module owns from the chapter document and
 * drop its `::highlight()` rules. The overlay fallback bands belong to
 * client.js, so they are not touched here.
 * @param {Document | null} documentNode
 * @returns {{removed: string[], supported: boolean}}
 */
export function clearHighlights(documentNode) {
  const scope = scopeFor(documentNode)
  if (scope === null) return { removed: [], supported: false }
  const { doc, win, state } = scope
  const supported = supportsCustomHighlights(win)
  const removed = resetScope(doc, win, state)
  // Also sweep names an earlier module instance may have left in the shared
  // registry; the bb- prefix is reserved for this module.
  if (supported) {
    try {
      if (typeof win.CSS.highlights.keys === 'function') {
        for (const name of Array.from(win.CSS.highlights.keys())) {
          if (typeof name !== 'string' || !MANAGED_HIGHLIGHT_NAME.test(name)) continue
          removeRegistryName(win, name)
          if (!removed.includes(name)) removed.push(name)
        }
      }
    } catch {
      // Registry not iterable in this browser; the tracked names were removed.
    }
  }
  return { removed, supported }
}
