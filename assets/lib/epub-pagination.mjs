// Geometry shared by the visible EPUB chapter and the offscreen page-count probe.
const PAGED_CSS = `
html.bb-paged{height:100%;overflow:hidden}
/* Each spread advances by one actual iframe viewport. The gap contains the
   right margin of this page plus the left margin of the next page. Hidden
   overflow still permits explicit page navigation, but prevents a trackpad
   from leaving the book between columns while its page counter stays put. */
html.bb-paged body{box-sizing:border-box;width:100%!important;max-width:none!important;height:100%!important;margin:0!important;padding:var(--bb-page-pad-y,36px) var(--bb-page-pad-x,28px)!important;column-width:auto;column-count:var(--bb-page-columns,1);column-gap:calc(var(--bb-page-pad-x,28px) + var(--bb-page-pad-x,28px));column-fill:auto;overflow:hidden;scrollbar-width:none;overflow-anchor:none;scroll-behavior:auto}
/* An odd final column needs a blank partner so scrollLeft can reach a full
   spread boundary. This generated box is never counted as publication content. */
html.bb-paged body[data-bb-pad-spread]::after{content:'';display:block;break-before:column;width:1px;height:1px}
html.bb-paged body::-webkit-scrollbar{display:none}
html.bb-paged body p{orphans:2;widows:2}
html.bb-paged body h1,html.bb-paged body h2,html.bb-paged body h3,html.bb-paged body h4,html.bb-paged body h5{break-after:avoid}
html.bb-paged body img,html.bb-paged body figure{break-inside:avoid}
html.bb-paged body img{max-height:calc(100vh - var(--bb-page-pad-y,36px) - var(--bb-page-pad-y,36px) - 4em);width:auto;max-width:100%;object-fit:contain}
html.bb-paged body pre,html.bb-paged body blockquote{break-inside:auto;max-width:100%}
html.bb-paged body .bb-table-wrap{max-width:100%;overflow-x:auto;break-inside:auto}
html.bb-paged body .bb-table-wrap table{break-inside:auto;font-size:.86em}
html.bb-paged body table tr{break-inside:avoid}
`

export function configurePagedColumns(documentNode, pageSpread) {
  const root = documentNode.documentElement
  const body = documentNode.body
  const view = documentNode.defaultView
  if (!body || !view) return
  if (documentNode.getElementById('bb-paged-style') === null) {
    const style = documentNode.createElement('style')
    style.id = 'bb-paged-style'
    style.textContent = PAGED_CSS
    const head = documentNode.head || root
    head.appendChild(style)
  }
  root.classList.add('bb-paged')
  const styles = view.getComputedStyle(body)
  const width = body.getBoundingClientRect().width
  const height = body.getBoundingClientRect().height
  const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
  const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
  const font = parseFloat(styles.fontSize) || 19
  const line = parseFloat(styles.lineHeight) || font * 1.85
  // Each column needs 24 em and at least eight lines before enabling a spread.
  // With gap=padX, two content columns occupy width - 2*padX.
  const columns = pageSpread !== 'single' && width >= 48 * font + 2 * padX && height - padY >= 8 * line ? 2 : 1
  root.style.setProperty('--bb-page-columns', String(columns))
  body.removeAttribute('data-bb-pad-spread')
}

export function pagedMetrics(documentNode, windowNode) {
  const body = documentNode.body
  if (!body || !windowNode) return null
  const styles = windowNode.getComputedStyle(body)
  const padLeft = parseFloat(styles.paddingLeft) || 0
  const padTop = parseFloat(styles.paddingTop) || 0
  const padX = padLeft + (parseFloat(styles.paddingRight) || 0)
  const gap = parseFloat(styles.columnGap) || 0
  const width = Math.max(1, body.getBoundingClientRect().width || windowNode.innerWidth || 0)
  const columns = parseInt(styles.columnCount, 10) === 2 ? 2 : 1
  const pageWidth = Math.max(1, (width - padX - gap * (columns - 1)) / columns)
  const step = pageWidth + gap
  const scrollWidth = Math.max(body.scrollWidth, documentNode.documentElement.scrollWidth)
  let pages = Math.max(1, Math.ceil((scrollWidth - padX + gap - 1) / step))
  if (columns === 2 && scrollWidth <= width + 1) {
    // The scroll box is always at least one spread wide, including for a
    // short or empty chapter. Count only occupied columns in that case.
    let end = padLeft
    for (const node of body.childNodes) {
      // Only outer-flow fragments count. Range over the entire subtree also
      // includes clipped cells inside horizontally scrolling table wrappers.
      let rects
      if (node.nodeType === 1) rects = node.getClientRects()
      else if (node.nodeType === 3 && node.textContent.trim()) {
        const range = documentNode.createRange()
        range.selectNodeContents(node)
        rects = range.getClientRects()
      } else continue
      for (const rect of rects) {
        if (rect.width > 0 && rect.height > 0) end = Math.max(end, rect.right + body.scrollLeft)
      }
    }
    pages = Math.max(1, Math.ceil((end - padLeft + gap - 1) / step))
  } else if (body.hasAttribute('data-bb-pad-spread')) {
    pages = Math.max(1, pages - 1)
  }
  return { padLeft, padTop, step, pages, columns }
}

export function wrapTables(documentNode) {
  if (!documentNode || !documentNode.body) return
  for (const table of documentNode.body.querySelectorAll('table')) {
    const parent = table.parentElement
    if (parent && parent.classList && parent.classList.contains('bb-table-wrap')) continue
    const wrap = documentNode.createElement('div')
    wrap.className = 'bb-table-wrap'
    if (parent) {
      parent.insertBefore(wrap, table)
      wrap.appendChild(table)
    }
  }
}

export function rangePage(doc, win, range) {
  if (range === null) return null
  const info = pagedMetrics(doc, win)
  if (info === null) return null
  const rects = range.getClientRects()
  const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect()
  if (!Number.isFinite(rect.left)) return null
  // Range rects are viewport-relative: add the current column offset, or a
  // sentence two pages ahead would be computed as page 2 and the reader
  // would jump back and forth between the same two pages.
  const body = doc.body
  const documentElement = doc.documentElement
  const scrollLeft = Math.max(body ? body.scrollLeft : 0, documentElement ? documentElement.scrollLeft : 0)
  return Math.max(0, pageAtX(rect.left + scrollLeft, info))
}

export function pageAtX(x, info) {
  return Math.floor((x - info.padLeft + 1) / info.step)
}

export function showPagedSpread(body, info, requestedPage) {
  const page = Math.floor(Math.max(0, Math.min(info.pages - 1, requestedPage)) / info.columns) * info.columns
  if (info.columns === 2 && info.pages % 2 === 1) body.setAttribute('data-bb-pad-spread', '')
  body.scrollLeft = page * info.step
  return page
}
