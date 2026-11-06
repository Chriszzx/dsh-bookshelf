import { captureReadingSnapshot, READING_SNAPSHOT_CONTRACT } from '/reading-snapshot.mjs'

const checks = []
const assert = (condition, message) => { if (!condition) throw Error(message) }
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
const compact = text => text.replace(/\s/g, '')
const options = { book: { id: 'synthetic', title: 'Synthetic book', author: 'Test' }, chapter: { path: 'chapter.xhtml', label: 'Chapter' }, sourceRevision: 'sha256:synthetic-test', pageMode: 'scroll' }
let frame
async function fixture(body, css = '', width = 360, height = 180) {
  frame?.remove()
  frame = document.createElement('iframe')
  frame.style.cssText = `width:${width}px;height:${height}px;border:0;display:block`
  const loaded = new Promise(resolve => { frame.onload = resolve })
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}body{font:16px/24px monospace}p{margin:0 0 12px}${css}</style></head><body>${body}</body></html>`
  document.body.append(frame)
  await loaded
  await frame.contentDocument.fonts.ready
  return frame.contentDocument
}
function capture(doc, extra = {}) {
  const before = [frame.getBoundingClientRect().toJSON(), doc.body.scrollLeft, doc.body.scrollTop, doc.defaultView.scrollX, doc.defaultView.scrollY, doc.body.innerHTML]
  const observer = new MutationObserver(() => {})
  observer.observe(doc.documentElement, { attributes: true, childList: true, characterData: true, subtree: true })
  const result = captureReadingSnapshot({ ...options, document: doc, ...extra })
  equal(observer.takeRecords().length, 0, 'capture does not mutate DOM')
  observer.disconnect()
  equal([frame.getBoundingClientRect().toJSON(), doc.body.scrollLeft, doc.body.scrollTop, doc.defaultView.scrollX, doc.defaultView.scrollY, doc.body.innerHTML], before, 'capture preserves geometry and scrolling')
  equal(JSON.parse(JSON.stringify(result)), result, 'snapshot is plain JSON')
  assert(Object.isFrozen(result) && Object.isFrozen(result.segments) && result.segments.every(Object.isFrozen), 'snapshot deeply frozen')
  assert(result.coordinateKind === 'rendered-dom-text' && result.extractionVersion === 'rendered-dom-text-v1', 'coordinates explicit')
  assert(!result.coverage.physicalPageComplete, 'never claims physical coverage')
  assert(!('chapterText' in result), 'no whole chapter')
  assert(result.segments.length <= 256 && new TextEncoder().encode(JSON.stringify(result)).length <= 262144, 'output bounds')
  assert(Array.from(result.text).length <= (extra.maxCharacters || 16000), 'readable text bounded')
  assert(result.segments.reduce((n, s) => n + s.end - s.start, 0) <= (extra.maxCharacters || 16000), 'segments bounded')
  const walker = doc.createTreeWalker(doc.body, 1 | 4, { acceptNode: n => n.nodeType === 1 && ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(n.tagName) ? 2 : 1 })
  let source = '', node
  while ((node = walker.nextNode())) if (node.nodeType === 3) source += node.data
  const scalars = Array.from(source)
  for (const segment of result.segments) equal(scalars.slice(segment.start, segment.end).join(''), segment.text, 'segments index exact scalar DOM text')
  return result
}
// Independent scalar-by-scalar oracle for fixture text. Unlike production, this
// intentionally performs a range query per glyph, detecting whole-node leakage.
function visibleGlyphs(doc, node, viewport = { left: 0, top: 0, right: frame.clientWidth, bottom: frame.clientHeight }) {
  const range = doc.createRange()
  let index = 0, out = ''
  for (const scalar of node.data) {
    range.setStart(node, index); index += scalar.length; range.setEnd(node, index)
    if ([...range.getClientRects()].some(r => r.width > 0 && r.height > 0 && r.right > viewport.left && r.left < viewport.right && r.bottom > viewport.top && r.top < viewport.bottom)) out += scalar
  }
  return out
}
async function check(name, fn) { await fn(); checks.push(name) }

export async function run() {
  await check('hidden/excluded text, Unicode coordinates, paragraphs, immutable copy', async () => {
    const doc = await fixture('<div style="display:none">hidden😀</div><script type="application/json">not text</script><style>.unused{color:red}</style><template>template</template><p>Hello 😀 <em>world</em>.</p><p>Second\n   paragraph.</p><p style="visibility:hidden">invisible</p><p style="opacity:0">transparent</p>')
    const snap = capture(doc)
    equal(snap.text, 'Hello 😀 world.\n\nSecond paragraph.', 'readable paragraphs')
    equal(snap.segments[0].start, 7, 'hidden scalars count but scripts/styles do not')
    const old = JSON.stringify(snap)
    doc.querySelector('p').textContent = 'changed after capture'
    equal(JSON.stringify(snap), old, 'snapshot detached from DOM')
  })
  await check('inline whitespace, visible line breaks and preformatted paragraphs stay readable', async () => {
    const doc = await fixture('<p><span>One </span><em>  two</em><br>three<br style="display:none"><span> four</span></p><pre>  code\n    indent</pre>')
    const snap = capture(doc)
    equal(snap.text, 'One two\n\nthree four\n\n  code\n    indent', 'HTML whitespace collapses across inline nodes and pre remains intact')
  })
  await check('scroll viewport clips both ends of one long paragraph', async () => {
    const doc = await fixture(`<p>${Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ')}</p>`, '', 320, 130)
    doc.defaultView.scrollTo(0, 145)
    const snap = capture(doc)
    equal(compact(snap.text), compact(visibleGlyphs(doc, doc.querySelector('p').firstChild)), 'scroll snapshot matches scalar visibility')
    assert(snap.segments[0].start > 0 && snap.segments.at(-1).end < doc.querySelector('p').textContent.length, 'paragraph clipped on both edges')
    assert(!snap.text.includes('word159') && !snap.text.includes('word0 '), 'no offscreen paragraph text')
  })
  for (const columns of [1, 2]) await check(`${columns === 1 ? 'single page' : 'dual spread'} captures only actual current columns`, async () => {
    const css = `html{height:100%;overflow:hidden}body{box-sizing:border-box;width:100%;height:100%;padding:12px;column-count:${columns};column-gap:24px;column-fill:auto;overflow:hidden}p{orphans:1;widows:1}`
    const doc = await fixture(`<p>${Array.from({ length: 300 }, (_, i) => `token${i}`).join(' ')}</p>`, css, 480, 160)
    doc.body.scrollLeft = 480
    const snap = capture(doc, { pageMode: 'paged', pageLabel: columns === 2 ? '3–4' : '2' })
    equal(compact(snap.text), compact(visibleGlyphs(doc, doc.querySelector('p').firstChild)), 'paged snapshot matches scalar visibility')
    assert(snap.segments[0].start > 0 && !snap.text.includes('token299'), 'paged paragraph prefix/suffix excluded')
    assert(snap.text.length > 50, 'current page contains text')
  })
  await check('wide table honors nested horizontal clipping and its current scroll', async () => {
    const doc = await fixture('<div id="clip"><table><tr><td>VISIBLE_FIRST</td><td>HIDDEN_SECOND</td><td>HIDDEN_THIRD</td></tr></table></div><p>After table.</p>', '#clip{width:150px;overflow-x:auto}table{border-spacing:0;table-layout:fixed;width:600px}td{width:200px;white-space:nowrap;padding:0}', 500, 180)
    let snap = capture(doc)
    assert(snap.text.includes('VISIBLE_FIRST') && !snap.text.includes('HIDDEN_SECOND') && !snap.text.includes('HIDDEN_THIRD'), 'offscreen cells excluded despite iframe intersection')
    doc.getElementById('clip').scrollLeft = 200
    snap = capture(doc)
    assert(snap.text.includes('HIDDEN_SECOND') && !snap.text.includes('VISIBLE_FIRST') && !snap.text.includes('HIDDEN_THIRD'), 'table capture follows current cell scroll')
  })
  await check('explicit client-coordinate viewport clips scalar boundaries', async () => {
    const doc = await fixture('<p>ABCDEFGHIJKLMN😀OPQRSTUVWXYZ</p>', 'p{white-space:nowrap}', 500, 100)
    const viewport = { x: 41, y: 0, width: 120, height: 50 }
    const snap = capture(doc, { viewport })
    equal(compact(snap.text), compact(visibleGlyphs(doc, doc.querySelector('p').firstChild, { left: 41, top: 0, right: 161, bottom: 50 })), 'custom viewport scalar clipping')
    assert(!snap.text.includes('ABC') && !snap.text.includes('XYZ'), 'custom viewport excludes full-node prefix and suffix')
  })
  await check('selection includes only captured visible intersection', async () => {
    const doc = await fixture(`<p>${Array.from({ length: 100 }, (_, i) => `select${i}`).join(' ')}</p>`, '', 320, 100)
    const node = doc.querySelector('p').firstChild
    const range = doc.createRange(); range.selectNodeContents(node)
    doc.getSelection().addRange(range)
    const snap = capture(doc)
    equal(snap.selection.text, snap.text, 'selection clipped to viewport')
    assert(snap.selection.truncated, 'offscreen selection explicitly partial')
    range.setStart(node, 1); range.setEnd(node, 6); doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
    const subset = capture(doc)
    equal(subset.selection.text, 'elect', 'exact selected substring')
    assert(!subset.selection.truncated, 'fully visible selection exact')
  })
  await check('images and empty pages report honest coverage', async () => {
    let doc = await fixture('<img alt="Do not synthesize alternate text" width="80" height="60" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2780%27 height=%2760%27/%3E">')
    let snap = capture(doc)
    equal(snap.text, '', 'image-only page yields no invented text')
    equal(snap.coverage.status, 'empty', 'image-only empty text')
    assert(snap.coverage.limitations.some(s => s.includes('non-text')), 'image omission notice')
    doc = await fixture(''); snap = capture(doc)
    assert(snap.coverage.limitations.some(s => s.includes('No visible text')), 'empty notice')
  })
  await check('character and segment bounds are truthful; surrogate pairs remain intact', async () => {
    let doc = await fixture('<p>A😀BC😀DEF</p>')
    let snap = capture(doc, { maxCharacters: 3 })
    equal(snap.text, 'A😀B', 'limit counts scalars')
    assert(snap.truncated && snap.coverage.status === 'partial', 'character limit marked')
    doc = await fixture(Array.from({ length: 300 }, () => '<span>x</span>').join(''), 'body{font:1px/1px monospace}', 600, 100)
    snap = capture(doc)
    equal(snap.segments.length, 256, 'segment bound')
    assert(snap.truncated && snap.coverage.limitations.some(s => s.includes('Segment limit')), 'segment truncation explicit')
  })
  await check('large visible Unicode payload obeys serialized byte bound', async () => {
    const doc = await fixture(`<p>${'😀'.repeat(16020)}</p>`, 'body{font:1px/1px monospace}p{overflow-wrap:anywhere}', 600, 180)
    const range = doc.createRange(); range.selectNodeContents(doc.querySelector('p')); doc.getSelection().addRange(range)
    const snap = capture(doc, { book: { id: 'synthetic', title: '😀'.repeat(2000), author: '😀'.repeat(2000) }, chapter: { path: 'chapter.xhtml', label: '😀'.repeat(2000) } })
    assert(snap.truncated, 'large payload truncation')
    assert(snap.text.length > 0, 'byte limit retains a useful visible prefix')
  })
  await check('huge chapter scan limit is bounded and explicit', async () => {
    const doc = await fixture(`<p>${'x'.repeat(READING_SNAPSHOT_CONTRACT.maxScannedCodeUnits + 1)}</p>`, 'p{white-space:nowrap}')
    const start = performance.now()
    const snap = capture(doc)
    assert(snap.truncated && snap.coverage.limitations.some(s => s.includes('scan limit')), 'huge node fails closed with notice')
    assert(performance.now() - start < 5000, 'bounded scan completes promptly')
  })
  await check('invalid metadata, mode, limits, detached documents and viewports fail explicitly', async () => {
    const doc = await fixture('<p>sample</p>')
    for (const extra of [{ maxCharacters: 0 }, { maxCharacters: 16001 }, { maxCharacters: 1.5 }, { pageMode: 'pdf' }, { sourceRevision: '' }, { viewport: { x: NaN, y: 0, width: 1, height: 1 } }, { document: new DOMParser().parseFromString('<p>detached</p>', 'text/html') }]) {
      let failed = false
      try { captureReadingSnapshot({ ...options, document: doc, ...extra }) } catch (error) { failed = error instanceof TypeError }
      assert(failed, 'invalid input rejected')
    }
  })
  return { checks, count: checks.length }
}
