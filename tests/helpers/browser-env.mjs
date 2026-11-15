import { constants } from 'node:fs'
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import { zipSync, strToU8 } from '../../assets/fflate.mjs'

const require = createRequire(import.meta.url)

export async function findBrowser() {
  const candidates = process.env.CHROME_BIN ? [process.env.CHROME_BIN] : [
    ...(process.platform === 'darwin' ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ] : []),
    ...(process.platform === 'win32' ? [
      join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    ] : []),
    ...(process.env.PATH || '').split(delimiter).flatMap(directory =>
      (process.platform === 'win32' ? ['chrome.exe', 'msedge.exe'] : ['google-chrome', 'chromium', 'chromium-browser']).map(name => join(directory, name))),
  ]
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return candidate
    } catch { /* Try the next public executable location. */ }
  }
  throw new Error(process.env.CHROME_BIN
    ? `CHROME_BIN is not an accessible browser executable: ${process.env.CHROME_BIN}`
    : 'Browser tests require Chrome, Chromium or Edge. Install one or set CHROME_BIN to its executable path.')
}

function longEpub() {
  const paragraphs = Array.from({ length: 100 }, (_, index) =>
    `<p id="p${index}">${Array.from({ length: 24 }, () => `Paragraph ${index} keeps reading position stable across page turns and panel changes.`).join(' ')}</p>`).join('')
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test-book</dc:identifier><dc:title>Generated test book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>'),
    'one.xhtml': strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1>${paragraphs}</body></html>`),
  })
}

// A deterministic five-page PDF with mixed dimensions, no external font or book.
function mixedPdf() {
  const dimensions = [[612, 792], [595, 842], [792, 612], [420, 595], [612, 792]]
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${dimensions.length} /Kids [${dimensions.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (const [index, [width, height]] of dimensions.entries()) {
    const content = `BT /F1 20 Tf 40 ${height - 60} Td (Generated test page ${index + 1}) Tj ET\n`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`)
  }
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document))
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const start = Buffer.byteLength(document)
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
  return Buffer.from(document)
}

export async function prepareBrowserEnvironment(temporary, { react = true, books = false } = {}) {
  const chromePath = await findBrowser()
  if (process.env.BOOKSHELF_TEST_FIXTURES) {
    return { chromePath, fixtures: process.env.BOOKSHELF_TEST_FIXTURES }
  }
  const fixtures = join(temporary, 'fixtures')
  if (react) {
    for (const name of ['react', 'react-dom']) {
      let packageDirectory
      try { packageDirectory = dirname(require.resolve(`${name}/package.json`)) }
      catch { throw new Error('Browser test dependencies are missing. Run pnpm install --frozen-lockfile first.') }
      const target = join(fixtures, 'node_modules', name, 'umd')
      await mkdir(target, { recursive: true })
      await copyFile(join(packageDirectory, 'umd', `${name}.development.js`), join(target, `${name}.development.js`))
    }
  }
  if (books) {
    await mkdir(fixtures, { recursive: true })
    await writeFile(join(fixtures, 'paged-long.epub'), longEpub())
    await writeFile(join(fixtures, 'mixed.pdf'), mixedPdf())
  }
  return { chromePath, fixtures }
}
