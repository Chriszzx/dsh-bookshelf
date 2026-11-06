/**
 * Static viewport extraction for an already rendered, sanitized EPUB chapter.
 * No layout, scroll, selection, or DOM mutations; no chapter/source text is returned.
 *
 * Coordinates are NOT EPUB/CFI coordinates. rendered-dom-text-v1 concatenates
 * body Text nodes in DOM order, excluding SCRIPT/STYLE/TEMPLATE/NOSCRIPT subtrees.
 * All other text (including hidden text and whitespace) contributes Unicode scalar
 * positions, without synthetic separators. Segment [start,end) and text are exact;
 * snapshot.text is a readable projection with paragraph/BR separators and collapsed
 * HTML whitespace. Reflow preserves offsets; changing the sanitized DOM may not.
 * A sourceRevision identifies the original bytes, not this DOM extraction alone.
 *
 * viewport is in iframe document client coordinates, NOT outer-window coordinates.
 * A scalar is captured when its nonzero text rectangle intersects the viewport and
 * ancestor overflow clips. Partially visible edge glyphs are included. Browser range
 * geometry cannot establish pixel visibility, occlusion, or whole physical pages.
 */
export const READING_SNAPSHOT_CONTRACT = Object.freeze({
  version: 1,
  coordinateKind: 'rendered-dom-text',
  extractionVersion: 'rendered-dom-text-v1',
  offsetUnit: 'unicode-scalar',
  endExclusive: true,
  maxCharacters: 16000,
  maxSegments: 256,
  maxJSONBytes: 256 * 1024,
  maxVisitedNodes: 30000,
  maxScannedCodeUnits: 2000000,
  maxGeometryQueries: 24000,
})

const OMIT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'])
const MEDIA = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'IFRAME'])
const CLIPPED = new Set(['hidden', 'clip', 'scroll', 'auto'])
const C = READING_SNAPSHOT_CONTRACT
const BASE_LIMITATIONS = [
  'Rendered DOM text coordinates; not canonical EPUB source coordinates.',
  'Text rectangles only: images, generated content, occlusion and pixel visibility are not captured; physical-page completeness is not established.',
]

function required(value, label, maximum = 4096, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.length > maximum) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a' : 'a nonempty'} string of at most ${maximum} UTF-16 code units`)
  }
  return value
}

function rectOf(value) {
  const left = value.left ?? value.x
  const top = value.top ?? value.y
  const right = value.right ?? left + value.width
  const bottom = value.bottom ?? top + value.height
  if (![left, top, right, bottom].every(Number.isFinite) || right < left || bottom < top) {
    throw new TypeError('viewport must be a finite, nonnegative DOMRect-like rectangle')
  }
  return { left, top, right, bottom }
}

function intersection(a, b) {
  const out = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
  return out.right > out.left && out.bottom > out.top ? out : null
}

function contains(a, b) {
  return b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom
}

function scalarOffsets(text) {
  const offsets = [0]
  for (let index = 0; index < text.length;) {
    const code = text.codePointAt(index)
    index += code > 0xffff ? 2 : 1
    offsets.push(index)
  }
  return offsets
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * @param {{document: Document, viewport?: {left?:number,top?:number,x?:number,y?:number,right?:number,bottom?:number,width?:number,height?:number},
 * book:{id:string,title:string,author:string}, chapter:{path:string,label:string}, sourceRevision:string,
 * pageMode:'paged'|'scroll',pageLabel?:string,maxCharacters?:number}} input
 * @returns {Readonly<{version:1,coordinateKind:string,extractionVersion:string,bookId:string,title:string,author:string,
 * sourceRevision:string,documentID:string,chapterTitle:string,capturedAt:string,pageMode:string,pageLabel:string,
 * segments:Array<{documentID:string,start:number,end:number,text:string}>,text:string,
 * selection?:{text:string,segments:Array<{documentID:string,start:number,end:number,text:string}>,truncated:boolean},
 * truncated:boolean,coverage:{kind:string,physicalPageComplete:boolean,status:string,limitations:string[],limits:object}}>} deeply frozen plain JSON
 */
export function captureReadingSnapshot({ document: doc, viewport, book, chapter, sourceRevision, pageMode, pageLabel = '', maxCharacters = C.maxCharacters } = {}) {
  if (!doc?.body || !doc.defaultView || typeof doc.createRange !== 'function') throw new TypeError('A live iframe document with a body is required')
  if (pageMode !== 'paged' && pageMode !== 'scroll') throw new TypeError('pageMode must be paged or scroll')
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > C.maxCharacters) throw new TypeError(`maxCharacters must be an integer from 1 to ${C.maxCharacters}`)
  const result = {
    version: 1, coordinateKind: C.coordinateKind, extractionVersion: C.extractionVersion,
    bookId: required(book?.id, 'book.id', 512), title: required(book?.title, 'book.title', 4096, true), author: required(book?.author, 'book.author', 4096, true),
    sourceRevision: required(sourceRevision, 'sourceRevision', 512), documentID: required(chapter?.path, 'chapter.path'),
    chapterTitle: required(chapter?.label, 'chapter.label', 4096, true), capturedAt: new Date().toISOString(), pageMode,
    pageLabel: required(pageLabel, 'pageLabel', 512, true), segments: [], text: '', truncated: false,
    coverage: { kind: 'visible-text', physicalPageComplete: false, status: 'empty', limitations: [...BASE_LIMITATIONS], limits: {
      maxCharacters, maxSegments: C.maxSegments, maxJSONBytes: C.maxJSONBytes,
      maxVisitedNodes: C.maxVisitedNodes, maxScannedCodeUnits: C.maxScannedCodeUnits, maxGeometryQueries: C.maxGeometryQueries,
    } },
  }
  const win = doc.defaultView
  const screen = { left: 0, top: 0, right: doc.documentElement.clientWidth || win.innerWidth, bottom: doc.documentElement.clientHeight || win.innerHeight }
  const view = viewport ? intersection(screen, rectOf(viewport)) : screen
  const reasons = new Set()
  const states = new WeakMap()
  const pieces = []
  let visited = 0, scanned = 0, geometry = 0, position = 0, captured = 0, halted = false, breakNumber = 0
  const range = doc.createRange()
  const selection = doc.getSelection()
  const selected = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null
  const stop = reason => { reasons.add(reason); result.truncated = true; halted = true }
  const query = fn => {
    if (++geometry > C.maxGeometryQueries) { stop('Geometry query limit reached.'); return [] }
    return fn()
  }

  function stateFor(element, parent) {
    const css = win.getComputedStyle(element)
    const hidden = parent?.hidden || css.display === 'none' || css.contentVisibility === 'hidden' || Number(css.opacity) === 0
    let clips = parent?.clips ?? (view ? [view] : [])
    const clipX = CLIPPED.has(css.overflowX), clipY = CLIPPED.has(css.overflowY)
    if (!hidden && clips.length && (clipX || clipY)) {
      const boxes = query(() => element.getClientRects())
      const next = []
      if (boxes.length > 512) stop('Fragmented clipping-box limit reached.')
      for (let index = 0; index < Math.min(boxes.length, 512) && !halted; index++) {
        const box = boxes[index]
        // Padding box, excluding borders and scrollbar gutters. Fragmented boxes
        // use their own extent because clientWidth describes only one fragment.
        const sx = element.offsetWidth ? box.width / element.offsetWidth : 1
        const sy = element.offsetHeight ? box.height / element.offsetHeight : 1
        const left = box.left + element.clientLeft * sx
        const top = box.top + element.clientTop * sy
        const right = boxes.length === 1 ? left + element.clientWidth * sx : box.right - parseFloat(css.borderRightWidth || 0)
        const bottom = boxes.length === 1 ? top + element.clientHeight * sy : box.bottom - parseFloat(css.borderBottomWidth || 0)
        for (const outer of clips) {
          const clipped = intersection(outer, { left: clipX ? left : outer.left, right: clipX ? right : outer.right, top: clipY ? top : outer.top, bottom: clipY ? bottom : outer.bottom })
          if (clipped) next.push(clipped)
          if (next.length > 512) { stop('Fragmented clipping-box limit reached.'); break }
        }
      }
      clips = next
    }
    const block = !['inline', 'contents', 'inline-block', 'inline-flex', 'inline-grid', 'none'].includes(css.display) ? element : parent?.block
    const state = { hidden, invisible: css.visibility !== 'visible', clips, block, pre: /^(pre|break-spaces)/.test(css.whiteSpace) }
    states.set(element, state)
    return state
  }

  function append(node, raw, offsets, start, end, state) {
    if (start === end || halted) return
    const previous = pieces.at(-1)
    const contiguous = previous && previous.node === node && previous.localEnd === start
    if (!contiguous && pieces.length >= C.maxSegments) { stop('Segment limit reached.'); return }
    const take = Math.min(end - start, maxCharacters - captured)
    if (!take) { stop('Character limit reached.'); return }
    const localEnd = start + take
    const text = raw.slice(offsets[start], offsets[localEnd])
    if (contiguous) {
      previous.segment.end = position + localEnd
      previous.segment.text += text
      previous.localEnd = localEnd
      previous.unitEnd = offsets[localEnd]
    } else {
      pieces.push({ node, localStart: start, localEnd, unitStart: offsets[start], unitEnd: offsets[localEnd], block: state.block, pre: state.pre, breakNumber,
        segment: { documentID: result.documentID, start: position + start, end: position + localEnd, text } })
    }
    captured += take
    if (take < end - start) stop('Character limit reached.')
  }

  function captureNode(node, raw, offsets, state) {
    function split(start, end) {
      if (halted) return
      range.setStart(node, offsets[start]); range.setEnd(node, offsets[end])
      const rects = query(() => range.getClientRects())
      let any = false, all = true, nonzero = false
      for (const box of rects) {
        if (box.width <= 0 || box.height <= 0) continue
        nonzero = true
        const hit = state.clips.some(clip => intersection(clip, box))
        any ||= hit
        if (!state.clips.some(clip => contains(clip, box))) all = false
      }
      if (!any || !nonzero || halted) return
      if (all || end - start === 1) { append(node, raw, offsets, start, end, state); return }
      const middle = start + Math.floor((end - start) / 2)
      split(start, middle); split(middle, end)
    }
    // Coarse ranges bound rect-list allocation even for a single gigantic node;
    // only ranges straddling a visibility boundary descend to scalar granularity.
    for (let start = 0; start < offsets.length - 1 && !halted; start += 2048) split(start, Math.min(start + 2048, offsets.length - 1))
  }

  stateFor(doc.documentElement, null)
  stateFor(doc.body, states.get(doc.documentElement))
  const walker = doc.createTreeWalker(doc.body, 1 | 4, { acceptNode: node => node.nodeType === 1 && OMIT.has(node.tagName) ? 2 : 1 })
  let node
  while (!halted && (node = walker.nextNode())) {
    if (++visited > C.maxVisitedNodes) { stop('DOM node limit reached.'); break }
    if (node.nodeType === 1) {
      const state = stateFor(node, states.get(node.parentElement))
      if (node.tagName === 'BR' && !state.hidden && !state.invisible && state.clips.length) breakNumber++
      if (MEDIA.has(node.tagName) && !state.hidden && !state.invisible && state.clips.length) {
        const boxes = query(() => node.getClientRects())
        if (Array.from(boxes).some(box => state.clips.some(clip => intersection(clip, box)))) reasons.add('Visible non-text content is omitted.')
      }
      continue
    }
    // Counting hidden nodes makes coordinates independent of CSS visibility.
    const raw = node.data
    if (scanned + raw.length > C.maxScannedCodeUnits) { stop('DOM text scan limit reached.'); break }
    scanned += raw.length
    const offsets = scalarOffsets(raw)
    const state = states.get(node.parentElement)
    if (!state.hidden && !state.invisible && state.clips.length && raw.length) captureNode(node, raw, offsets, state)
    position += offsets.length - 1
  }

  function readable(items) {
    let text = '', previous
    for (const item of items) {
      if (previous && (previous.block !== item.block || previous.breakNumber !== item.breakNumber)) text = text.trimEnd() + '\n\n'
      else if (previous && previous.node === item.node && previous.segment.end !== item.segment.start) text = text.trimEnd() + '\n'
      let part = item.pre ? item.segment.text : item.segment.text.replace(/[\t\n\r\f ]+/g, ' ')
      if (!item.pre && text.endsWith(' ') && part.startsWith(' ')) part = part.slice(1)
      text += part
      previous = item
    }
    return text.trim()
  }

  function project() {
    result.segments = pieces.map(piece => piece.segment)
    result.text = readable(pieces)
    if (Array.from(result.text).length > maxCharacters) {
      result.text = Array.from(result.text).slice(0, maxCharacters).join('')
      result.truncated = true
      reasons.add('Readable text character limit reached.')
    }
    delete result.selection
    if (selected) {
      const selectedPieces = []
      for (const piece of pieces) {
        if (!selected.intersectsNode(piece.node)) continue
        const start = Math.max(piece.unitStart, selected.startContainer === piece.node ? selected.startOffset : 0)
        const end = Math.min(piece.unitEnd, selected.endContainer === piece.node ? selected.endOffset : piece.node.length)
        if (end <= start || selected.comparePoint(piece.node, start) === 1 || selected.comparePoint(piece.node, end) === -1) continue
        // A browser selection may bisect a surrogate pair; round inward to whole
        // scalars, keeping segment offsets valid and never inventing half glyphs.
        let from = start, to = end
        if (from > 0 && /[\uDC00-\uDFFF]/.test(piece.node.data[from] || '') && /[\uD800-\uDBFF]/.test(piece.node.data[from - 1])) from++
        if (to > 0 && /[\uD800-\uDBFF]/.test(piece.node.data[to - 1]) && /[\uDC00-\uDFFF]/.test(piece.node.data[to] || '')) to--
        if (to <= from) continue
        const text = piece.node.data.slice(from, to)
        const scalarStart = piece.segment.start + Array.from(piece.node.data.slice(piece.unitStart, from)).length
        selectedPieces.push({ ...piece, unitStart: from, unitEnd: to, segment: { documentID: result.documentID, start: scalarStart, end: scalarStart + Array.from(text).length, text } })
      }
      if (selectedPieces.length) result.selection = {
        text: Array.from(readable(selectedPieces)).slice(0, maxCharacters).join(''), segments: selectedPieces.map(piece => piece.segment),
        // Selection is only the visible captured intersection. Avoid materializing
        // selected.toString(), which could copy an arbitrarily large chapter.
        truncated: result.truncated || selectedPieces.some((piece, index) => index > 0 && selectedPieces[index - 1].segment.end !== piece.segment.start) || selectedPieces[0].node !== selected.startContainer || selectedPieces[0].unitStart !== selected.startOffset || selectedPieces.at(-1).node !== selected.endContainer || selectedPieces.at(-1).unitEnd !== selected.endOffset,
      }
    }
    result.coverage.status = result.text ? (result.truncated || reasons.size ? 'partial' : 'captured') : 'empty'
    result.coverage.limitations = [...BASE_LIMITATIONS, ...reasons]
    if (!result.text) result.coverage.limitations.push('No visible text was captured; this does not establish an empty physical page.')
  }
  project()
  const encoder = new TextEncoder()
  while (encoder.encode(JSON.stringify(result)).length > C.maxJSONBytes && pieces.length) {
    stop('Serialized snapshot byte limit reached.')
    const tail = pieces.at(-1)
    const scalars = Array.from(tail.segment.text)
    const keep = Math.floor(scalars.length * 0.75)
    if (!keep) pieces.pop()
    else {
      tail.segment.text = scalars.slice(0, keep).join('')
      tail.segment.end = tail.segment.start + keep
      tail.localEnd = tail.localStart + keep
      tail.unitEnd = tail.unitStart + tail.segment.text.length
    }
    project()
  }
  return freeze(result)
}
