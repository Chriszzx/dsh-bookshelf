// Regression: the reader's TOC/bookmarks tab row must stay pinned at the top of
// the aside. A long TOC used to scroll the whole column, taking the tabs with
// it, so the lower half of a chapter list could not be browsed while the tabs
// were gone.
// Run: node tests/toc-layering.mjs (needs Chrome and React UMD fixtures).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { prepareBrowserEnvironment, browserLaunchArgs, navigateTestPage } from './helpers/browser-env.mjs'
import { zipSync, strToU8 } from '../assets/fflate.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-toc-sticky-'))
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
let route, chrome, socket, server

apply(
  { effect: fn => fn(), webServer: { register(value) { route = value; return () => {} } }, logger: { info() {}, warn() {}, error() {} } },
  { tts: { platform: 'darwin', run: async () => ({ stdout: '' }) } },
)

function epubBytes(title, chapters) {
  const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  const manifest = chapters.map((_, index) => `<item id="ch${index}" href="ch${index}.xhtml" media-type="application/xhtml+xml"/>`).join('')
  const spine = chapters.map((_, index) => `<itemref idref="ch${index}"/>`).join('')
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:55555555-5555-4555-8555-555555555555</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test</dc:creator><dc:language>zh</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
  }
  chapters.forEach((lines, index) => {
    const body = lines.map((line) => `<p>${line}</p>`).join('')
    files[`OEBPS/ch${index}.xhtml`] = strToU8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${index + 1}</title></head><body><h1>Chapter ${index + 1}</h1>${body}</body></html>`)
  })
  return zipSync(files)
}

const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}#root{width:640px}</style></head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>window.__ModuleLoader__={load(d){window.definition=d}};</script><script src="/client.js"></script>
<script>
window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const t=(key)=>key;
const regs=[];
definition.factory(id=>{if(id==='react')return React;throw Error(id)}).apply({effect:fn=>fn(),locale:{register(){return()=>{}},bind(){return t}},slots:{inject(k,fn){fn()},register(o,C){regs.push({o,C})}}});
const Panel=regs.find(r=>r.o.name==='main').C;
window.mount=()=>ReactDOM.flushSync(()=>ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Panel,{t})));
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<15000){if(fn())return;await wait(40)}throw Error('Timed out')};
window.check=(c,m)=>{if(!c)throw Error(m)};
mount();
</script></body></html>`

try {
  const { fixtures, chromePath } = await prepareBrowserEnvironment(temporary, { books: false })
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://test').pathname
      const files = {
        '/react.js': join(fixtures, 'node_modules/react/umd/react.development.js'),
        '/react-dom.js': join(fixtures, 'node_modules/react-dom/umd/react-dom.development.js'),
        '/client.js': join(pluginDir, 'client.js'),
      }
      if (path === '/test.html') { res.setHeader('content-type', 'text/html'); res.end(page); return }
      if (files[path]) { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(files[path])); return }
      await route.handler(req, res)
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const api = `${origin}/bookshelf/api`
  const chapters = Array.from({ length: 40 }, (_, index) => [`Chapter ${index + 1} sentence one.`, `Chapter ${index + 1} sentence two.`])
  const seeded = await fetch(`${api}/books?name=toc.epub&title=Toc&format=epub`, { method: 'POST', body: epubBytes('Toc', chapters) })
  assert.equal(seeded.status, 201)

  chrome = spawn(chromePath, [
    ...browserLaunchArgs(), '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
    `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0',
    '--window-size=1100,900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const browserUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 15000)
    let log = ''
    chrome.once('error', error => { clearTimeout(timer); reject(error) })
    chrome.stderr.on('data', chunk => {
      log += chunk
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const debugOrigin = 'http://' + new URL(browserUrl).host
  const targets = await (await fetch(`${debugOrigin}/json`)).json()
  const target = targets.find(entry => entry.url === 'about:blank')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  await navigateTestPage(socket, `${origin}/test.html`)
  let sequence = 0
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const id = ++sequence
    const listener = event => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      socket.removeEventListener('message', listener)
      if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)))
      else resolve(message.result?.result?.value)
    }
    socket.addEventListener('message', listener)
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  const startup = Date.now()
  while (true) {
    try { if (await evaluate('Boolean(window.mount && document.querySelector(".bs-shelf"))')) break } catch {}
    assert.ok(Date.now() - startup < 10000, 'page mounted')
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const result = await evaluate(`(async()=>{
    await until(()=>document.querySelector('.bs-card'));
    document.querySelector('.bs-cover').click();
    await until(()=>document.querySelector('.bs-reader')&&document.querySelector('.bs-epub-toc'));
    const aside=document.querySelector('.bs-epub-toc');
    const tabs=aside.querySelector('.bs-aside-tabs');
    const scroll=aside.querySelector('.bs-aside-scroll');
    check(!!tabs&&!!scroll,'aside has a fixed tab row and a scrolling list');
    check(!scroll.contains(tabs),'tabs are outside the scrolling list');
    check(getComputedStyle(aside).position==='absolute','narrow layout makes the TOC an overlay');
    const before=tabs.getBoundingClientRect();
    scroll.scrollTop=scroll.scrollHeight;
    await wait(120);
    const after=tabs.getBoundingClientRect();
    const narrowScrolled=scroll.scrollTop>0;
    const hit=document.elementFromPoint(before.left+before.width/2, before.top+before.height/2);
    // The wide layout uses the same fixed header; resizing must not change it.
    document.getElementById('root').style.width='900px';
    await wait(250);
    const wideAside=document.querySelector('.bs-epub-toc');
    const wideTabs=wideAside.querySelector('.bs-aside-tabs');
    const wideScroll=wideAside.querySelector('.bs-aside-scroll');
    wideScroll.scrollTop=wideScroll.scrollHeight;
    await wait(120);
    const wideTabsRect=wideTabs.getBoundingClientRect();
    const wideAsideRect=wideAside.getBoundingClientRect();
    const wideScrolled=wideScroll.scrollTop>0;
    const wideHit=document.elementFromPoint(wideTabsRect.left+wideTabsRect.width/2, wideTabsRect.top+wideTabsRect.height/2);
    // Tabs stay clickable after scrolling: switching to the bookmarks tab works.
    const bookmarkTab=[...wideTabs.querySelectorAll('.bs-aside-tab')].find(node=>node.getAttribute('aria-selected')==='false');
    bookmarkTab.click();
    await wait(120);
    return {
      scrolled: narrowScrolled,
      tabsPinned: Math.abs(after.top-before.top)<1,
      hitTabs: Boolean(hit&&hit.closest('.bs-aside-tabs')),
      wideScrolled,
      wideTabsPinned: Math.abs(wideTabsRect.top-wideAsideRect.top)<1,
      wideHitTabs: Boolean(wideHit&&wideHit.closest('.bs-aside-tabs')),
      bookmarkSelected: bookmarkTab.getAttribute('aria-selected')==='true',
    };
  })()`)
  assert.equal(result.scrolled, true, `long TOC actually scrolls: ${JSON.stringify(result)}`)
  assert.equal(result.tabsPinned, true, `tabs stay at the top after scrolling: ${JSON.stringify(result)}`)
  assert.equal(result.hitTabs, true, `tabs receive the pointer after scrolling: ${JSON.stringify(result)}`)
  assert.equal(result.wideScrolled, true, `wide list scrolls: ${JSON.stringify(result)}`)
  assert.equal(result.wideTabsPinned, true, `wide tabs stay at the aside top: ${JSON.stringify(result)}`)
  assert.equal(result.wideHitTabs, true, `wide tabs stay clickable: ${JSON.stringify(result)}`)
  assert.equal(result.bookmarkSelected, true, `bookmarks tab switches after scrolling: ${JSON.stringify(result)}`)
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('toc sticky: tabs stay pinned above the scrolling chapter list')
} finally {
  try { socket?.close() } catch {}
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill('SIGKILL')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))])
  }
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
