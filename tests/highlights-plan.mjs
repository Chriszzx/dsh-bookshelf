// The highlight plan is the contract between the reader and the CSS Custom
// Highlight API: read-aloud inverts the palette, annotations paint above it,
// and a browser without the API falls back to the legacy overlay band. These
// tests exercise the pure plan in Node; the last few use a tiny document stub
// to pin the DOM application bookkeeping without a browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANNOTATION_HIGHLIGHT_PREFIX,
  ANNOTATION_PRIORITY,
  READ_ALOUD_HIGHLIGHT,
  READ_ALOUD_PRIORITY,
  annotationHighlightName,
  applyHighlightPlan,
  buildHighlightPlan,
  clearHighlights,
  supportsCustomHighlights,
} from '../assets/lib/highlights.mjs'

const LIGHT = { fg: '#0f1115', bg: '#ffffff', accent: '#0a84ff' }
const DARK = { fg: '#f9fafb', bg: '#151517', accent: '#4c9aff' }
const SPOKEN_RANGE = { id: 'spoken-range' }

function annotation(overrides = {}) {
  return {
    id: 'an_abc123',
    type: 'highlight',
    chapterIndex: 1,
    start: 10,
    end: 20,
    quote: '选中原文',
    color: '#ffd23f',
    strength: 0.35,
    thickness: 2,
    underlineStyle: 'solid',
    ...overrides,
  }
}

// supported by default so the entries themselves can be asserted; the fallback
// branch has its own test with the probe overridden.
function plan(overrides = {}) {
  return buildHighlightPlan({
    palette: LIGHT,
    readAloud: { range: SPOKEN_RANGE },
    annotations: [],
    chapterIndex: 1,
    customHighlights: true,
    ...overrides,
  })
}

function entryNamed(result, name) {
  return result.entries.find((entry) => entry.name === name)
}

// A minimal document stub for the apply/clear bookkeeping. It is not a DOM
// implementation: it only offers what applyHighlightPlan is allowed to touch
// (head/createElement/querySelectorAll plus the CSS.highlights registry).
function fakeDocument() {
  const registry = new Map()
  const styles = []
  const win = {
    CSS: { highlights: registry },
    Highlight: class Highlight {
      constructor(...ranges) {
        this.ranges = ranges
        this.priority = 0
      }
    },
  }
  const head = {
    children: [],
    appendChild(child) {
      child.parentNode = this
      this.children.push(child)
      styles.push(child)
      return child
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child)
      child.parentNode = null
      return child
    },
  }
  const doc = {
    nodeType: 9,
    defaultView: win,
    head,
    documentElement: head,
    createElement(tagName) {
      return {
        tagName: String(tagName).toUpperCase(),
        ownerDocument: doc,
        parentNode: null,
        attributes: {},
        textContent: '',
        setAttribute(name, value) {
          this.attributes[name] = value
        },
      }
    },
    querySelectorAll() {
      return []
    },
  }
  return { doc, win, registry, styles }
}

test('highlight names are stable and CSS-safe', () => {
  assert.equal(READ_ALOUD_HIGHLIGHT, 'bb-ra')
  assert.equal(ANNOTATION_HIGHLIGHT_PREFIX, 'bb-an-')
  assert.equal(annotationHighlightName({ id: 'an_abc123' }), 'bb-an-an_abc123')
  assert.equal(annotationHighlightName({ id: ' an_abc123 ' }), 'bb-an-an_abc123')
  assert.equal(annotationHighlightName({ id: 'an abc/123' }), 'bb-an-an-abc-123')
  assert.equal(annotationHighlightName({ id: '' }), '')
  assert.equal(annotationHighlightName({}), '')
  assert.equal(annotationHighlightName(null), '')
  assert.match(annotationHighlightName({ id: '1 bad/name' }), /^bb-an-[A-Za-z0-9_-]+$/)
})

test('the capability probe needs both the registry and the Highlight constructor', () => {
  const registry = new Map()
  function Highlight() {}
  assert.equal(supportsCustomHighlights(null), false)
  assert.equal(supportsCustomHighlights(undefined), false)
  assert.equal(supportsCustomHighlights({}), false)
  assert.equal(supportsCustomHighlights({ CSS: {} }), false)
  assert.equal(supportsCustomHighlights({ CSS: { highlights: registry } }), false)
  assert.equal(supportsCustomHighlights({ CSS: { highlights: {} }, Highlight }), false)
  assert.equal(supportsCustomHighlights({ CSS: { highlights: registry }, Highlight }), true)
})

test('the read-aloud layer inverts the palette', () => {
  const light = entryNamed(plan(), READ_ALOUD_HIGHLIGHT)
  assert.deepEqual(light, {
    name: READ_ALOUD_HIGHLIGHT,
    priority: READ_ALOUD_PRIORITY,
    css: { color: LIGHT.bg, 'background-color': LIGHT.fg },
    ranges: [SPOKEN_RANGE],
  })
  // Dark pages invert the other way round: page colour as ink, text colour as
  // the band. Both directions come from the palette, not from hard-coded values.
  const dark = entryNamed(plan({ palette: DARK }), READ_ALOUD_HIGHLIGHT)
  assert.equal(dark.css.color, DARK.bg)
  assert.equal(dark.css['background-color'], DARK.fg)
  const custom = entryNamed(plan({ palette: { fg: '#123456', bg: '#abcdef' } }), READ_ALOUD_HIGHLIGHT)
  assert.deepEqual(custom.css, { color: '#abcdef', 'background-color': '#123456' })
})

test('no spoken sentence means no read-aloud layer', () => {
  assert.equal(entryNamed(plan({ readAloud: null }), READ_ALOUD_HIGHLIGHT), undefined)
  assert.equal(entryNamed(plan({ readAloud: { range: null } }), READ_ALOUD_HIGHLIGHT), undefined)
  // A palette without both colours cannot invert, so the layer is skipped
  // instead of painting a half-missing highlight.
  assert.equal(entryNamed(plan({ palette: { bg: '#ffffff' } }), READ_ALOUD_HIGHLIGHT), undefined)
})

test('highlight annotations use color-mix with the strength percentage', () => {
  const entry = entryNamed(plan({ annotations: [annotation()] }), 'bb-an-an_abc123')
  assert.equal(entry.priority, ANNOTATION_PRIORITY)
  assert.deepEqual(entry.css, { 'background-color': 'color-mix(in srgb, #ffd23f 35%, transparent)' })
  assert.equal(entry.css.color, undefined)
  assert.equal(entry.css['text-decoration-line'], undefined)
  // No resolved range was attached: the style exists but nothing is painted.
  assert.deepEqual(entry.ranges, [])
  const percentOf = (strength) => entryNamed(plan({ annotations: [annotation({ strength })] }), 'bb-an-an_abc123').css['background-color']
  assert.equal(percentOf(0.075), 'color-mix(in srgb, #ffd23f 7.5%, transparent)')
  assert.equal(percentOf(0.5), 'color-mix(in srgb, #ffd23f 50%, transparent)')
  assert.equal(percentOf(0.9), 'color-mix(in srgb, #ffd23f 90%, transparent)')
  // Out-of-range strengths clamp to the model range instead of being dropped.
  assert.equal(percentOf(5), 'color-mix(in srgb, #ffd23f 90%, transparent)')
  assert.equal(percentOf(-1), 'color-mix(in srgb, #ffd23f 5%, transparent)')
})

test('underline annotations carry line, colour, thickness and style', () => {
  const entry = entryNamed(plan({ annotations: [annotation({ type: 'underline', thickness: 3, underlineStyle: 'wavy' })] }), 'bb-an-an_abc123')
  assert.equal(entry.priority, ANNOTATION_PRIORITY)
  assert.deepEqual(entry.css, {
    'text-decoration-line': 'underline',
    'text-decoration-color': '#ffd23f',
    'text-decoration-thickness': '3px',
    'text-decoration-style': 'wavy',
  })
  // Older records may miss the optional fields: the model defaults apply.
  const legacy = entryNamed(plan({ annotations: [{ id: 'an_old', type: 'underline', chapterIndex: 1, color: '#112233' }] }), 'bb-an-an_old')
  assert.equal(legacy.css['text-decoration-thickness'], '2px')
  assert.equal(legacy.css['text-decoration-style'], 'solid')
  const unknownStyle = entryNamed(plan({ annotations: [annotation({ type: 'underline', underlineStyle: 'double' })] }), 'bb-an-an_abc123')
  assert.equal(unknownStyle.css['text-decoration-style'], 'solid')
})

test('annotation colours follow the palette; theme and colour-mix stay in sync', () => {
  // 'theme' tracks the active palette accent, so pinned light/dark pages and
  // live DSH themes do not get a hard-coded annotation tint.
  const themed = entryNamed(plan({ annotations: [annotation({ color: 'theme' })] }), 'bb-an-an_abc123')
  assert.equal(themed.css['background-color'], 'color-mix(in srgb, #0a84ff 35%, transparent)')
  const noAccent = entryNamed(plan({ palette: { fg: '#222222', bg: '#eeeeee' }, annotations: [annotation({ color: 'theme' })] }), 'bb-an-an_abc123')
  assert.equal(noAccent.css['background-color'], 'color-mix(in srgb, #222222 35%, transparent)')
  const noPalette = entryNamed(plan({ palette: null, annotations: [annotation({ color: 'theme', type: 'underline' })] }), 'bb-an-an_abc123')
  assert.equal(noPalette.css['text-decoration-color'], 'currentColor')
})

test('annotations outrank the read-aloud layer', () => {
  const result = plan({ annotations: [annotation()] })
  assert.deepEqual(result.entries.map((entry) => entry.name), [READ_ALOUD_HIGHLIGHT, 'bb-an-an_abc123'])
  assert.equal(entryNamed(result, READ_ALOUD_HIGHLIGHT).priority, READ_ALOUD_PRIORITY)
  assert.equal(entryNamed(result, 'bb-an-an_abc123').priority, ANNOTATION_PRIORITY)
  // The reader relies on the annotation layer covering the inverted sentence.
  assert.ok(ANNOTATION_PRIORITY > READ_ALOUD_PRIORITY)
})

test('only annotations from the requested chapter are included', () => {
  const annotations = [
    annotation({ id: 'an_0', chapterIndex: 0 }),
    annotation({ id: 'an_1', chapterIndex: 1 }),
    annotation({ id: 'an_2', chapterIndex: 2, type: 'underline' }),
  ]
  assert.deepEqual(plan({ annotations, chapterIndex: 1 }).entries.map((entry) => entry.name),
    [READ_ALOUD_HIGHLIGHT, 'bb-an-an_1'])
  assert.deepEqual(plan({ annotations, chapterIndex: 2 }).entries.map((entry) => entry.name),
    [READ_ALOUD_HIGHLIGHT, 'bb-an-an_2'])
  assert.deepEqual(plan({ annotations, chapterIndex: 9 }).entries.map((entry) => entry.name),
    [READ_ALOUD_HIGHLIGHT])
  // Without a chapter index nothing can match; read-aloud is chapter-agnostic.
  assert.deepEqual(plan({ annotations, chapterIndex: null }).entries.map((entry) => entry.name),
    [READ_ALOUD_HIGHLIGHT])
})

test('invalid annotation records are skipped, not fatal', () => {
  const broken = [
    null,
    undefined,
    'an_abc',
    {},
    { id: '', type: 'highlight', chapterIndex: 1, color: '#ffd23f' },
    annotation({ type: 'bookmark' }),
    annotation({ id: 'an_bad_color', color: '#12' }),
    annotation({ id: 'an_bad_color2', color: 'red' }),
    annotation({ id: 'an_theme_ok', color: 'theme' }),
    annotation({ id: 'an_dup' }),
  ]
  const result = plan({ annotations: broken })
  assert.deepEqual(result.entries.map((entry) => entry.name),
    [READ_ALOUD_HIGHLIGHT, 'bb-an-an_theme_ok', 'bb-an-an_dup'])
})

test('range descriptors are forwarded untouched and never inspected', () => {
  const readRange = Object.freeze({ id: 'read-range' })
  const annotationRange = Object.freeze({ id: 'annotation-range' })
  const built = plan({
    readAloud: { range: readRange },
    annotations: [annotation({ range: annotationRange })],
  })
  assert.equal(entryNamed(built, READ_ALOUD_HIGHLIGHT).ranges[0], readRange)
  assert.equal(entryNamed(built, 'bb-an-an_abc123').ranges[0], annotationRange)
  // A split annotation may supply several ranges; they stay in order.
  const multi = plan({ annotations: [annotation({ ranges: [readRange, annotationRange] })] })
  assert.deepEqual(entryNamed(multi, 'bb-an-an_abc123').ranges, [readRange, annotationRange])
})

test('the overlay fallback is decided from the CSS.highlights probe', () => {
  const supportedWindow = { CSS: { highlights: new Map() }, Highlight: function Highlight() {} }
  assert.equal(buildHighlightPlan({ palette: LIGHT, readAloud: { range: SPOKEN_RANGE }, annotations: [], chapterIndex: 1, win: supportedWindow }).fallback, null)
  assert.equal(buildHighlightPlan({ palette: LIGHT, readAloud: { range: SPOKEN_RANGE }, annotations: [], chapterIndex: 1, win: {} }).fallback, 'overlay')
  assert.equal(plan({ customHighlights: true }).fallback, null)
  assert.equal(plan({ customHighlights: false }).fallback, 'overlay')
  assert.equal(plan({ customHighlights: false, win: supportedWindow }).fallback, 'overlay')
  assert.equal(plan({ customHighlights: true, win: {} }).fallback, null)
  // Node has no CSS.highlights, so the default probe must pick the overlay.
  assert.equal(typeof globalThis.CSS, 'undefined')
  assert.equal(buildHighlightPlan({ palette: LIGHT, readAloud: { range: SPOKEN_RANGE }, annotations: [], chapterIndex: 1 }).fallback, 'overlay')
  // The fallback only changes painting: the layers still describe their styles.
  assert.equal(plan({ customHighlights: false, annotations: [annotation()] }).entries.length, 2)
})

test('apply and clear are safe without a document (Node path)', () => {
  const built = plan({ annotations: [annotation({ range: { id: 'annotation-range' } })] })
  assert.deepEqual(applyHighlightPlan(null, built), { applied: [], removed: [], supported: false })
  assert.deepEqual(applyHighlightPlan(undefined, built), { applied: [], removed: [], supported: false })
  assert.deepEqual(clearHighlights(null), { removed: [], supported: false })
  // A detached document has no CSS.highlights either: the fallback branch must
  // not throw while cleaning up an empty scope.
  const detached = { nodeType: 9, defaultView: null }
  assert.deepEqual(applyHighlightPlan(detached, built), { applied: [], removed: [], supported: false })
  assert.deepEqual(clearHighlights(detached), { removed: [], supported: false })
})

test('applying a plan writes rules, registers ranges and removes stale layers', () => {
  const fake = fakeDocument()
  const readRange = { id: 'read-range' }
  const annotationRange = { id: 'annotation-range' }
  const spoken = buildHighlightPlan({
    palette: LIGHT,
    readAloud: { range: readRange },
    annotations: [annotation({ range: annotationRange })],
    chapterIndex: 1,
    customHighlights: true,
  })
  const applied = applyHighlightPlan(fake.doc, spoken)
  assert.deepEqual(applied, { applied: [READ_ALOUD_HIGHLIGHT, 'bb-an-an_abc123'], removed: [], supported: true })
  assert.deepEqual(Array.from(fake.registry.keys()), [READ_ALOUD_HIGHLIGHT, 'bb-an-an_abc123'])
  assert.equal(fake.registry.get(READ_ALOUD_HIGHLIGHT).priority, READ_ALOUD_PRIORITY)
  assert.equal(fake.registry.get('bb-an-an_abc123').priority, ANNOTATION_PRIORITY)
  assert.deepEqual(fake.registry.get(READ_ALOUD_HIGHLIGHT).ranges, [readRange])
  const rules = fake.styles[0].textContent
  assert.match(rules, /::highlight\(bb-ra\) \{ color: #ffffff; background-color: #0f1115; \}/)
  assert.match(rules, /::highlight\(bb-an-an_abc123\) \{ background-color: color-mix\(in srgb, #ffd23f 35%, transparent\); \}/)
  // The sentence finished: the next paint drops the read-aloud layer only.
  const between = buildHighlightPlan({
    palette: LIGHT,
    readAloud: null,
    annotations: [annotation({ range: annotationRange })],
    chapterIndex: 1,
    customHighlights: true,
  })
  const repainted = applyHighlightPlan(fake.doc, between)
  assert.deepEqual(repainted.removed, [READ_ALOUD_HIGHLIGHT])
  assert.deepEqual(Array.from(fake.registry.keys()), ['bb-an-an_abc123'])
  // The annotation was deleted: its layer and rule go away too.
  const empty = buildHighlightPlan({ palette: LIGHT, readAloud: null, annotations: [], chapterIndex: 1, customHighlights: true })
  const cleared = applyHighlightPlan(fake.doc, empty)
  assert.deepEqual(cleared.removed, ['bb-an-an_abc123'])
  assert.equal(fake.registry.size, 0)
  assert.equal(fake.styles[0].textContent, '')
  // clearHighlights removes everything tracked and detaches the style element.
  applyHighlightPlan(fake.doc, spoken)
  assert.equal(fake.registry.size, 2)
  assert.deepEqual(clearHighlights(fake.doc), { removed: [READ_ALOUD_HIGHLIGHT, 'bb-an-an_abc123'], supported: true })
  assert.equal(fake.registry.size, 0)
  assert.equal(fake.styles[0].parentNode, null)
})

test('a styled annotation without a resolved range is not painted', () => {
  const fake = fakeDocument()
  // G2 resolves anchor -> Range before calling buildHighlightPlan; this pins
  // that a missing range yields the CSS rule but no registry entry, instead of
  // keeping an older range alive.
  const result = applyHighlightPlan(fake.doc, buildHighlightPlan({
    palette: LIGHT, readAloud: null, annotations: [annotation()], chapterIndex: 1, customHighlights: true,
  }))
  assert.deepEqual(result.applied, [])
  assert.equal(fake.registry.size, 0)
  assert.match(fake.styles[0].textContent, /bb-an-an_abc123/)
})

test('an overlay plan paints no CSS highlights', () => {
  const fake = fakeDocument()
  const supported = buildHighlightPlan({
    palette: LIGHT, readAloud: { range: { id: 'read-range' } }, annotations: [], chapterIndex: 1, customHighlights: true,
  })
  applyHighlightPlan(fake.doc, supported)
  assert.equal(fake.registry.size, 1)
  // The caller paints the legacy marker band when plan.fallback === 'overlay';
  // applying such a plan must clean the registry instead of mixing the layers.
  const result = applyHighlightPlan(fake.doc, { ...supported, fallback: 'overlay' })
  assert.deepEqual(result.applied, [])
  assert.deepEqual(result.removed, [READ_ALOUD_HIGHLIGHT])
  assert.equal(fake.registry.size, 0)
})
