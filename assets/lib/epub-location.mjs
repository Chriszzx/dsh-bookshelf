// Column/page numbers change when a face swaps in. The chapter DOM and
// text offsets stay stable, including across a close and reopen.
export function pageAnchorRect(doc, anchor) {
  if (anchor?.element) return doc.body.contains(anchor.element) ? anchor.element.getClientRects()[0] : null
  const node = anchor?.node
  if (!node || !doc.body.contains(node)) return null
  const range = doc.createRange()
  if (node.nodeType === 3 && node.length) {
    // At a column boundary, a collapsed caret can sit at the end of the
    // preceding column. Measure the glyph the reader is about to read.
    const start = Math.min(anchor.offset || 0, node.length - 1)
    range.setStart(node, start)
    range.setEnd(node, start + 1)
  } else {
    range.selectNodeContents(node)
  }
  return range.getClientRects()[0]
}

export function encodePageLocator(anchor, body) {
  let node = anchor?.node || anchor?.element
  if (!body || !node || !body.contains(node) || node === body) return ''
  const doc = body.ownerDocument
  const rect = pageAnchorRect(doc, anchor)
  if (!rect || rect.right <= 0 || rect.left >= doc.defaultView.innerWidth) return ''
  const path = []
  while (node !== body) {
    const siblings = node.parentNode.childNodes
    path.push(Array.prototype.indexOf.call(siblings, node))
    node = node.parentNode
  }
  return path.reverse().join('.') + ':' + (anchor.offset || 0)
}

export function decodePageLocator(locator, body) {
  if (typeof locator !== 'string' || !locator) return null
  const [path, offsetText] = locator.split(':')
  const offset = Number(offsetText)
  if (!Number.isSafeInteger(offset) || offset < 0) return null
  let node = body
  for (const index of path.split('.')) node = node?.childNodes[Number(index)]
  if (node?.nodeType === 3 && offset <= node.length) return { node, offset }
  return node?.nodeType === 1 ? { element: node } : null
}

export function matchingPageLocator(record, chapter, revision) {
  return record && chapter && record.chapterPath === chapter.path && record.locatorRevision === revision &&
    typeof record.pageLocator === 'string' ? record.pageLocator : ''
}
