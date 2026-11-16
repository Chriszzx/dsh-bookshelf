/**
 * Speech text indexing for the asynchronous read-aloud paths. A chapter or PDF
 * page is flattened into whitespace-normalised text plus a per-character map
 * back to text nodes, so every sentence maps to one DOM Range for the
 * highlight. Pure DOM helpers: no React, no client state.
 *
 * client.js is a classic script, so this file is loaded with a dynamic import;
 * the reader awaits the preload and later reads the module object
 * synchronously (see loadClientLib / clientLib in client.js).
 */

const SPEECH_SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

// Join PDF text runs without inserting spaces between CJK characters.
export function joinPdfItems(items) {
  let out = ''
  let previous = ''
  for (const item of items || []) {
    const value = typeof item.str === 'string' ? item.str : ''
    if (value === '') continue
    if (out !== '' && item.hasEOL) out += '\n'
    else if (out !== '' && !CJK_RE.test(previous.slice(-1)) && !CJK_RE.test(value.slice(0, 1))) out += ' '
    out += value
    previous = value
  }
  return out
}

// Flatten the chapter into whitespace-normalised text plus a per-character
// map back to (text node, offset). Sentences come from innerText, where block
// boundaries become newlines, so matching has to ignore whitespace layout.
export function buildSpeechIndex(doc) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let flat = ''
  const entries = []
  let node
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (parent !== null && SPEECH_SKIP.has(parent.tagName)) continue
    const value = node.nodeValue || ''
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset]
      if (/\s/u.test(character)) {
        // One space stands for any run of layout whitespace.
        if (flat === '' || flat[flat.length - 1] === ' ') continue
        flat += ' '
        entries.push({ node, offset })
        continue
      }
      flat += character
      entries.push({ node, offset })
    }
  }
  return { flat, entries }
}

export function speechRangeFor(index, sentence, cursor) {
  const target = sentence.replace(/\s+/gu, ' ').trim()
  if (target === '' || index.entries.length === 0) return { range: null, cursor }
  const at = index.flat.indexOf(target, cursor)
  if (at < 0) return { range: null, cursor }
  const first = index.entries[at]
  const last = index.entries[Math.min(index.entries.length - 1, at + target.length - 1)]
  const range = first && first.node.ownerDocument.createRange()
  if (!range) return { range: null, cursor }
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset + 1)
  return { range, cursor: at + target.length }
}

// One index per chapter, then a full-sentence range for every sentence so
// the highlight covers the whole utterance instead of just its opening.
export function buildSpeechBatches(doc, sentences) {
  const index = buildSpeechIndex(doc)
  let cursor = 0
  const batches = []
  for (const sentence of sentences) {
    const found = speechRangeFor(index, sentence, cursor)
    cursor = found.cursor
    batches.push({ text: sentence, range: found.range })
  }
  return batches
}
