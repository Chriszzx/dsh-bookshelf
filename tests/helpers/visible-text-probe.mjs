// Installed inside the browser fixture so the Range stays in the chapter document.
export function installVisibleTextProbe() {
  let anchor
  function geometry(range) {
    const win = range.startContainer.ownerDocument.defaultView
    const rect = range.getBoundingClientRect()
    const visible = rect.width > 0 && rect.height > 0 &&
      rect.left >= -1 && rect.right <= win.innerWidth + 1 &&
      rect.top >= -1 && rect.bottom <= win.innerHeight + 1
    return { visible, left: rect.left, top: rect.top }
  }
  window.capture = () => {
    const doc = document.querySelector('.bs-epub-frame').contentDocument
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    const range = doc.createRange()
    while (walker.nextNode()) {
      const node = walker.currentNode
      range.selectNodeContents(node)
      for (const line of range.getClientRects()) {
        if (line.width < 2 || line.left < 0 || line.top < 0 ||
            line.right > doc.defaultView.innerWidth + 1 || line.bottom > doc.defaultView.innerHeight + 1) continue
        // Hit-test inside a rendered line. A point in the page padding can
        // resolve to a caret in the previous column on Windows.
        const hit = doc.caretRangeFromPoint(line.left + 1, line.top + line.height / 2)
        if (!hit || hit.startContainer !== node || hit.startOffset >= node.length) continue
        hit.setEnd(node, hit.startOffset + 1)
        if (!geometry(hit).visible) continue
        anchor = hit
        return { text: node.textContent.slice(hit.startOffset, hit.startOffset + 40) }
      }
    }
    throw Error('No visible chapter text to track')
  }
  window.anchorVisible = () => geometry(anchor)
}
