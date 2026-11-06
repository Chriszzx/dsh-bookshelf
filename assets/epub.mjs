/**
 * Minimal EPUB 2/3 reader support for the DSH bookshelf.
 *
 * This module is served from the plugin's own asset route and imported by the
 * browser half. It turns an EPUB byte array into metadata, spine chapters, a
 * table of contents, and the image resources a chapter needs. It deliberately
 * leaves HTML sanitization and presentation to the caller.
 */
import { strFromU8, unzipSync } from './fflate.mjs'

const utf8 = new TextDecoder('utf-8', { fatal: false })
const utf16le = new TextDecoder('utf-16le', { fatal: false })
const utf16be = new TextDecoder('utf-16be', { fatal: false })

function decodeText(data) {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return utf16le.decode(data).replace(/^\uFEFF/, '')
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return utf16be.decode(data).replace(/^\uFEFF/, '')
  return (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf
    ? utf8.decode(data.subarray(3))
    : utf8.decode(data))
}

function parseXml(text, label) {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser is unavailable')
  const document = new DOMParser().parseFromString(text, 'application/xml')
  const errors = document.getElementsByTagName('parsererror')
  if (errors.length > 0) throw new Error(`${label} is not well-formed XML`)
  return document
}

function parseHtml(text) {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser is unavailable')
  return new DOMParser().parseFromString(text, 'text/html')
}

export function localName(element) {
  const name = element && (element.localName || element.nodeName)
  if (typeof name !== 'string') return ''
  const colon = name.indexOf(':')
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase()
}

function descendants(root, name) {
  const wanted = name.toLowerCase()
  const out = []
  const all = root.querySelectorAll === undefined ? root.getElementsByTagName('*') : root.querySelectorAll('*')
  for (let index = 0; index < all.length; index += 1) {
    const element = all[index]
    if (localName(element) === wanted) out.push(element)
  }
  return out
}

function firstDescendant(root, name) {
  return descendants(root, name)[0]
}

function elementText(element) {
  if (element === undefined || element === null) return ''
  return String(element.textContent || '').replace(/\s+/g, ' ').trim()
}

export function normalizePath(path) {
  const parts = []
  for (const part of String(path).replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function directoryOf(path) {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function resolveHref(baseDirectory, href) {
  if (typeof href !== 'string') return ''
  let value = href.trim().split('#')[0]
  const question = value.indexOf('?')
  if (question !== -1) value = value.slice(0, question)
  try {
    value = decodeURIComponent(value)
  } catch {
    // Keep the authored spelling when it is not valid percent-encoding.
  }
  if (value === '') return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  const base = value.startsWith('/') ? '' : baseDirectory
  return normalizePath(value.startsWith('/') ? value.slice(1) : `${base}/${value}`)
}

function entryIndex(files) {
  const index = new Map()
  for (const name of Object.keys(files)) index.set(name.toLowerCase(), name)
  return index
}

function readEntry(files, index, path) {
  if (typeof path !== 'string' || path === '') return undefined
  const normalized = normalizePath(path)
  const exact = index.get(normalized.toLowerCase())
  return exact === undefined ? undefined : files[exact]
}

function containerPath(files, index) {
  const container = readEntry(files, index, 'META-INF/container.xml')
  if (container === undefined) throw new Error('not an EPUB: META-INF/container.xml is missing')
  const document = parseXml(decodeText(container), 'META-INF/container.xml')
  const rootfile = firstDescendant(document, 'rootfile')
  const fullPath = rootfile && rootfile.getAttribute('full-path')
  if (!fullPath) throw new Error('not an EPUB: container.xml names no package document')
  return normalizePath(fullPath)
}

function metadataOf(document) {
  const titles = descendants(document, 'title')
  const creators = descendants(document, 'creator')
  const languages = descendants(document, 'language')
  const title = titles.map(elementText).find((value) => value !== '') || ''
  const author = creators.map(elementText).filter((value) => value !== '').join(', ')
  const language = languages.map(elementText).find((value) => value !== '') || ''
  return { title, author, language }
}

/**
 * Read only the package metadata. Two filtered unzip passes avoid inflating
 * every resource just to show a title in the import step.
 * @param {Uint8Array} bytes - complete EPUB file bytes.
 * @returns {{title: string, author: string, language: string, opfPath: string}}
 */
export function readEpubMetadata(bytes) {
  const first = unzipSync(bytes, {
    filter: (file) => normalizePath(file.name).toLowerCase() === 'meta-inf/container.xml',
  })
  const opfPath = containerPath(first, entryIndex(first))
  const second = unzipSync(bytes, {
    filter: (file) => normalizePath(file.name).toLowerCase() === opfPath.toLowerCase(),
  })
  const opfBytes = readEntry(second, entryIndex(second), opfPath)
  if (opfBytes === undefined) throw new Error('not an EPUB: the package document is missing')
  const document = parseXml(decodeText(opfBytes), 'EPUB package document')
  return { ...metadataOf(document), opfPath }
}

function chapterTitle(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (title) {
    const text = title[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text !== '') return text
  }
  const heading = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html)
  if (heading) {
    const text = heading[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text !== '') return text
  }
  return ''
}

function manifestOf(packageDocument, opfDirectory) {
  const items = new Map()
  for (const item of descendants(packageDocument, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    const mediaType = String(item.getAttribute('media-type') || '').toLowerCase()
    items.set(id, {
      id,
      href: resolveHref(opfDirectory, href),
      mediaType,
      properties: String(item.getAttribute('properties') || ''),
    })
  }
  return items
}

function spineOf(packageDocument) {
  const spine = firstDescendant(packageDocument, 'spine')
  if (spine === undefined) return { itemrefs: [], toc: undefined }
  const itemrefs = descendants(spine, 'itemref')
    .map((itemref) => itemref.getAttribute('idref'))
    .filter((idref) => typeof idref === 'string' && idref !== '')
  return { itemrefs, toc: spine.getAttribute('toc') || undefined }
}

function tocFromNav(text, baseDirectory, chapterIndexByPath) {
  let document
  try {
    document = parseHtml(text)
  } catch {
    return []
  }
  const navs = Array.from(document.querySelectorAll('nav'))
  const tocNav = navs.find((nav) => String(nav.getAttribute('epub:type') || nav.getAttribute('type') || '').toLowerCase().split(/\s+/).includes('toc')) || navs[0]
  if (tocNav === undefined) return []
  const entries = []
  const anchors = Array.from(tocNav.querySelectorAll('a'))
  for (const anchor of anchors) {
    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('javascript:')) continue
    const hash = href.indexOf('#')
    const anchorId = hash === -1 ? '' : href.slice(hash + 1)
    const path = resolveHref(baseDirectory, href)
    const chapterIndex = path === '' ? -1 : chapterIndexByPath.get(path) ?? chapterIndexByPath.get(path.toLowerCase())
    if (chapterIndex === undefined || chapterIndex < 0) continue
    entries.push({
      label: elementText(anchor) || `Chapter ${chapterIndex + 1}`,
      chapterIndex,
      anchor: anchorId,
      depth: Math.max(0, nestingDepth(anchor, tocNav) - 1),
    })
    if (entries.length >= 500) break
  }
  return entries
}

function nestingDepth(element, stop) {
  let depth = 0
  let parent = element.parentElement
  while (parent && parent !== stop && depth < 6) {
    const tag = String(parent.tagName || '').toLowerCase()
    if (tag === 'ol' || tag === 'ul') depth += 1
    parent = parent.parentElement
  }
  return depth
}

function tocFromNcx(text, baseDirectory, chapterIndexByPath) {
  let document
  try {
    document = parseXml(text, 'EPUB NCX')
  } catch {
    return []
  }
  const entries = []
  const points = descendants(document, 'navpoint')
  for (const point of points) {
    const label = elementText(firstDescendant(point, 'navlabel')) || ''
    const content = firstDescendant(point, 'content')
    const src = content && content.getAttribute('src')
    if (!src) continue
    const hash = src.indexOf('#')
    const anchorId = hash === -1 ? '' : src.slice(hash + 1)
    const path = resolveHref(baseDirectory, src)
    const chapterIndex = path === '' ? -1 : chapterIndexByPath.get(path) ?? chapterIndexByPath.get(path.toLowerCase())
    if (chapterIndex === undefined || chapterIndex < 0) continue
    let depth = 0
    let parent = point.parentElement
    while (parent && depth < 6) {
      if (localName(parent) === 'navpoint') depth += 1
      parent = parent.parentElement
    }
    entries.push({
      label: label || `Chapter ${chapterIndex + 1}`,
      chapterIndex,
      anchor: anchorId,
      depth,
    })
    if (entries.length >= 500) break
  }
  return entries
}

function imageTypeFromPath(path) {
  const lower = String(path || '').toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function coverOf(packageDocument, manifest, files, index, opfDirectory) {
  let item
  const meta = descendants(packageDocument, 'meta').find((node) => String(node.getAttribute('name') || '').toLowerCase() === 'cover')
  const coverId = meta && meta.getAttribute('content')
  if (coverId) item = manifest.get(coverId)
  if (item === undefined) {
    item = Array.from(manifest.values()).find((entry) => entry.properties.split(/\s+/).includes('cover-image'))
  }
  if (item === undefined) {
    item = Array.from(manifest.values()).find((entry) => entry.mediaType.startsWith('image/') && /cover/i.test(entry.id))
  }
  if (item === undefined) {
    item = Array.from(manifest.values()).find((entry) => entry.mediaType.startsWith('image/') && /cover/i.test(entry.href))
  }
  if (item === undefined) {
    const guideRef = descendants(packageDocument, 'reference').find((node) => String(node.getAttribute('type') || '').toLowerCase().includes('cover'))
    const href = guideRef && guideRef.getAttribute('href')
    if (href) {
      const path = resolveHref(opfDirectory, href)
      const referenced = Array.from(manifest.values()).find((entry) => entry.href === path)
      if (referenced !== undefined) {
        if (referenced.mediaType.startsWith('image/')) {
          item = referenced
        } else {
          const htmlBytes = readEntry(files, index, referenced.href)
          if (htmlBytes !== undefined) {
            const html = decodeText(htmlBytes)
            const match =
              /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html) ||
              /<image\b[^>]*\b(?:xlink:)?href\s*=\s*["']([^"']+)["']/i.exec(html)
            if (match) {
              const imagePath = resolveHref(directoryOf(referenced.href), match[1])
              const imageItem = Array.from(manifest.values()).find((entry) => entry.href === imagePath)
              if (imageItem !== undefined) item = imageItem
              else item = { id: 'cover', href: imagePath, mediaType: imageTypeFromPath(imagePath), properties: '' }
            }
          }
        }
      }
    }
  }
  if (item === undefined || item.href === '') return null
  if (!item.mediaType.startsWith('image/')) return null
  const data = readEntry(files, index, item.href)
  if (data === undefined || data.length === 0) return null
  return { type: item.mediaType, data }
}

/**
 * Parse a complete EPUB into chapters, TOC entries, and image resources.
 * @param {Uint8Array} bytes - complete EPUB file bytes.
 * @returns {{
 *   title: string, author: string, language: string, opfPath: string,
 *   chapters: Array<{path: string, html: string, label: string}>,
 *   toc: Array<{label: string, chapterIndex: number, anchor: string, depth: number}>,
 *   resources: Record<string, {type: string, data: Uint8Array}>,
 *   cover: {type: string, data: Uint8Array} | null,
 * }}
 */
export function parseEpub(bytes) {
  const files = unzipSync(bytes)
  const index = entryIndex(files)
  const opfPath = containerPath(files, index)
  const packageBytes = readEntry(files, index, opfPath)
  if (packageBytes === undefined) throw new Error('not an EPUB: the package document is missing')
  const packageDocument = parseXml(decodeText(packageBytes), 'EPUB package document')
  const opfDirectory = directoryOf(opfPath)
  const metadata = metadataOf(packageDocument)
  const manifest = manifestOf(packageDocument, opfDirectory)
  const spine = spineOf(packageDocument)
  const cover = coverOf(packageDocument, manifest, files, index, opfDirectory)

  const chapters = []
  const chapterIndexByPath = new Map()
  for (const idref of spine.itemrefs) {
    const item = manifest.get(idref)
    if (item === undefined) continue
    if (item.mediaType !== 'application/xhtml+xml' && item.mediaType !== 'text/html') continue
    const chapterBytes = readEntry(files, index, item.href)
    if (chapterBytes === undefined) continue
    const html = decodeText(chapterBytes)
    chapterIndexByPath.set(item.href, chapters.length)
    chapterIndexByPath.set(item.href.toLowerCase(), chapters.length)
    chapters.push({ path: item.href, html, label: chapterTitle(html) })
  }
  if (chapters.length === 0) throw new Error('this EPUB has no readable chapters')

  const resources = {}
  for (const item of manifest.values()) {
    if (!item.mediaType.startsWith('image/')) continue
    if (item.href === '') continue
    const data = readEntry(files, index, item.href)
    if (data === undefined || data.length === 0) continue
    resources[item.href] = { type: item.mediaType, data }
  }

  let toc = []
  const navItem = Array.from(manifest.values()).find((item) => item.properties.split(/\s+/).includes('nav'))
  if (navItem !== undefined) {
    const navBytes = readEntry(files, index, navItem.href)
    if (navBytes !== undefined) toc = tocFromNav(decodeText(navBytes), directoryOf(navItem.href), chapterIndexByPath)
  }
  if (toc.length === 0) {
    const ncxItem = Array.from(manifest.values()).find((item) => item.mediaType === 'application/x-dtbncx+xml' || item.id === spine.toc)
    if (ncxItem !== undefined) {
      const ncxBytes = readEntry(files, index, ncxItem.href)
      if (ncxBytes !== undefined) toc = tocFromNcx(decodeText(ncxBytes), directoryOf(ncxItem.href), chapterIndexByPath)
    }
  }

  return {
    ...metadata,
    opfPath,
    chapters,
    toc,
    resources,
    cover,
  }
}

/**
 * Extract only the cover image of an EPUB (plus whatever parsing the package
 * document needs). Returns null when the book has no usable cover image.
 * @param {Uint8Array} bytes
 * @returns {{type: string, data: Uint8Array} | null}
 */
export function readEpubCover(bytes) {
  const data = parseEpub(bytes)
  return data.cover || null
}

const BLOCKED_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'video', 'audio', 'source',
  'track', 'canvas', 'svg', 'math', 'template', 'noscript', 'dialog', 'slot',
])

const SAFE_STYLE_PROPERTIES = new Set([
  'font-style', 'font-weight', 'font-variant', 'font-size', 'font-family', 'text-align', 'text-indent',
  'text-decoration', 'text-transform', 'letter-spacing', 'word-spacing', 'line-height', 'color',
  'background-color', 'vertical-align', 'white-space', 'margin-top', 'margin-bottom', 'margin-left',
  'margin-right', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
])

function sanitizeStyleAttribute(element) {
  const raw = element.getAttribute('style')
  if (!raw) return
  const kept = []
  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (!SAFE_STYLE_PROPERTIES.has(property)) continue
    if (value === '' || /url\s*\(|expression\s*\(|@import|javascript:/i.test(value)) continue
    kept.push(`${property}:${value}`)
  }
  if (kept.length === 0) element.removeAttribute('style')
  else element.setAttribute('style', kept.join(';'))
}

function base64Of(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function safeDataUrl(resource, path, imageCache) {
  const cached = imageCache.get(path)
  if (cached !== undefined) return cached
  const url = `data:${resource.type};base64,${base64Of(resource.data)}`
  if (imageCache.size > 160) imageCache.clear()
  imageCache.set(path, url)
  return url
}

/**
 * Turn one spine chapter into a self-contained, script-free HTML document.
 *
 * The source is untrusted: scripts, stylesheets, embedded content, forms,
 * event handlers, remote images, and non-typographic CSS are removed. Images
 * resolve through the EPUB manifest into data URLs, internal links carry
 * `data-bb-chapter`/`data-bb-anchor`, and external links carry
 * `data-bb-external` for the parent reader to intercept.
 *
 * @param {{
 *   data: ReturnType<typeof parseEpub>,
 *   chapterIndex: number,
 *   resourceIndex: Map<string, string | number>,
 *   imageCache: Map<string, string>,
 *   readingCss: string,
 *   tooLargeText?: string,
 * }} input
 * @returns {string} complete HTML for the sandboxed frame.
 */
export function renderChapterHtml({ data, chapterIndex, resourceIndex, imageCache, readingCss, tooLargeText }) {
  const chapter = data.chapters[chapterIndex]
  if (chapter === undefined) return '<!doctype html><html><body></body></html>'
  const parsed = parseHtml(chapter.html)
  const body = parsed.body
  if (body === null) return '<!doctype html><html><body></body></html>'
  const chapterDirectory = directoryOf(chapter.path)
  const nodeCount = body.querySelectorAll('*').length
  if (nodeCount > 12000) {
    const notice = parsed.createElement('p')
    notice.textContent = tooLargeText || 'This chapter is too large to display comfortably.'
    body.replaceChildren(notice)
  } else {
    for (const element of Array.from(body.querySelectorAll('*'))) {
      if (element.isConnected === false) continue
      const tag = String(element.localName || element.tagName || '').toLowerCase()
      if (tag === 'svg') {
        // Covers and full-page illustrations are commonly wrapped in an SVG
        // `<image>`; turn those into ordinary images so the cover is not lost.
        const wrapper = parsed.createElement('div')
        wrapper.className = 'bb-cover'
        for (const image of Array.from(element.querySelectorAll('image'))) {
          const source =
            image.getAttribute('xlink:href') ||
            (typeof image.getAttributeNS === 'function' ? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') : '') ||
            image.getAttribute('href')
          const resolved = source ? resolveHref(chapterDirectory, source) : ''
          const key = resolved === '' ? undefined : resourceIndex.get(resolved.toLowerCase())
          if (key === undefined) continue
          const img = parsed.createElement('img')
          img.setAttribute('src', safeDataUrl(data.resources[key], key, imageCache))
          img.setAttribute('alt', '')
          wrapper.appendChild(img)
        }
        if (wrapper.childNodes.length > 0) element.replaceWith(wrapper)
        else element.remove()
        continue
      }
      if (BLOCKED_TAGS.has(tag)) {
        element.remove()
        continue
      }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase()
        if (
          name.startsWith('on') ||
          name === 'srcset' ||
          name === 'poster' ||
          name === 'action' ||
          name === 'formaction' ||
          name === 'xlink:href' ||
          name === 'xmlns' ||
          name === 'xmlns:xlink'
        ) {
          element.removeAttribute(attribute.name)
          continue
        }
        if (name === 'style') {
          sanitizeStyleAttribute(element)
          continue
        }
        if (name === 'href' && tag !== 'a') element.removeAttribute(attribute.name)
      }
      if (tag === 'img' || tag === 'image') {
        const source = element.getAttribute('src') || element.getAttribute('href')
        const resolved = source ? resolveHref(chapterDirectory, source) : ''
        const key = resolved === '' ? undefined : resourceIndex.get(resolved.toLowerCase())
        if (key === undefined) {
          element.remove()
          continue
        }
        const resource = data.resources[key]
        element.setAttribute('src', safeDataUrl(resource, key, imageCache))
        element.removeAttribute('href')
      } else if (tag === 'a') {
        const href = element.getAttribute('href')
        if (!href || href.startsWith('javascript:')) {
          element.removeAttribute('href')
          continue
        }
        if (href.startsWith('#')) {
          element.setAttribute('data-bb-chapter', String(chapterIndex))
          element.setAttribute('data-bb-anchor', href.slice(1))
          continue
        }
        const hash = href.indexOf('#')
        const anchorId = hash === -1 ? '' : href.slice(hash + 1)
        const targetPath = resolveHref(chapterDirectory, href)
        const target = resourceIndex.get(`chapter:${targetPath.toLowerCase()}`)
        if (target !== undefined) {
          element.setAttribute('data-bb-chapter', String(target))
          element.setAttribute('data-bb-anchor', anchorId)
        } else if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith('//')) {
          element.setAttribute('data-bb-external', 'true')
          element.setAttribute('target', '_blank')
          element.setAttribute('rel', 'noreferrer noopener')
        } else {
          element.removeAttribute('href')
        }
      }
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${readingCss}</style></head><body>${body.innerHTML}</body></html>`
}

