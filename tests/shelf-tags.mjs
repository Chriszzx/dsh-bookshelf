// Functional browser regression for shelf tags: category tabs, per-book
// assignment, status override, persistence across a reload, and tag
// rename/delete. The real Host and Client run in isolated Chrome; the DSH shell
// is a test double, matching the other browser suites.
// Run: node tests/shelf-tags.mjs (needs Chrome and React UMD fixtures).
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-tags-browser-'))
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
let route, chrome, socket, server

apply({
  effect: fn => fn(),
  webServer: { register(value) { route = value; return () => {} } },
  logger: { info() {}, warn() {}, error() {} },
})


function epubBytes(title, author) {
  const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:11111111-1111-4111-8111-111111111111</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`
  const chapter = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><h1>One</h1><p>Hello shelf.</p></body></html>`
  const nav = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">One</a></li></ol></nav></body></html>`
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/chapter.xhtml': strToU8(chapter),
    'OEBPS/nav.xhtml': strToU8(nav),
  })
}

const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>window.__ModuleLoader__={load(d){window.definition=d}};</script><script src="/client.js"></script>
<script>
window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const originalError=console.error;console.error=(...args)=>{errors.push(args.map(String).join(' '));originalError(...args)};
const t=(key,p)=>key+(p?'('+Object.entries(p).map(([k,v])=>k+'='+v).join(',')+')':'');
const regs=[];
const plugin=definition.factory(id=>{if(id==='react')return React;throw Error(id)});
plugin.apply({effect:fn=>fn(),locale:{register(){return()=>{}},bind(){return t}},slots:{inject(k,fn){fn()},register(o,C){regs.push({o,C});return()=>{}}}});
const Panel=regs.find(r=>r.o.name==='main').C;
const root=ReactDOM.createRoot(document.getElementById('root'));
window.mount=()=>ReactDOM.flushSync(()=>root.render(React.createElement(Panel,{t})));
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<12000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.setValue=(el,value)=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
window.tab=(test)=>[...document.querySelectorAll('.bs-tab')].find(node=>node.textContent.startsWith(test));
mount();
</script></body></html>`

try {
  // One imported book with no progress starts in the derived "unread" status.
  const { fixtures, chromePath } = await prepareBrowserEnvironment(temporary)
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

  const imported = await fetch(`${origin}/bookshelf/api/books?name=alpha.epub&title=Alpha&format=epub`, {
    method: 'POST',
    body: epubBytes('Alpha', 'Ada'),
  })
  assert.equal(imported.status, 201)

  chrome = spawn(chromePath, [
    ...browserLaunchArgs(), '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
    `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0',
    '--window-size=1400,1000', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const browserUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 10000)
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
  assert.ok(target, 'test target')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  await navigateTestPage(socket, `${origin}/test.html`)
  let sequence = 0
  async function evaluate(expression) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(Error('CDP evaluation timeout')) }, 45000)
      const listener = event => {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        clearTimeout(timer); socket.removeEventListener('message', listener)
        const result = message.result
        if (message.error || result?.exceptionDetails) reject(Error(JSON.stringify(message.error || result.exceptionDetails)))
        else resolve(result?.result?.value)
      }
      socket.addEventListener('message', listener)
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  }
  const waitForMount = async () => {
    const startup = Date.now()
    while (true) {
      try { if (await evaluate('Boolean(window.mount && document.querySelector(".bs-shelf"))')) return } catch (error) {
        if (!error.message.includes('Execution context was destroyed')) throw error
      }
      assert.ok(Date.now() - startup < 10000, 'test page initialized')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  await waitForMount()

  // The shelf opens on "all" with one book in the derived unread category.
  assert.deepEqual(
    await evaluate(`(async()=>{
      await until(()=>document.querySelectorAll('.bs-tab').length===4 && document.querySelectorAll('.bs-book-title').length===1);
      return [...document.querySelectorAll('.bs-tab')].map(node=>({text:node.textContent,pressed:node.getAttribute('aria-pressed')}));
    })()`),
    [
      { text: 'categoryAll1', pressed: 'true' },
      { text: 'statusUnread1', pressed: 'false' },
      { text: 'statusReading0', pressed: 'false' },
      { text: 'statusFinished0', pressed: 'false' },
    ],
  )

  // A tag created from the manager dialog becomes a category tab.
  await evaluate(`(async()=>{
    document.querySelector('[aria-label="manageTags"]').click();
    await until(()=>document.querySelector('.bs-tag-dialog .bs-tag-new input'));
    setValue(document.querySelector('.bs-tag-dialog .bs-tag-new input'),'心理学');
    [...document.querySelectorAll('.bs-tag-dialog .bs-tag-new button')].find(node=>node.textContent==='createTag').click();
    await until(()=>[...document.querySelectorAll('.bs-tag-manage-row input')].some(input=>input.value==='心理学'));
    document.querySelector('.bs-tag-dialog [aria-label="dismiss"]').click();
    await until(()=>!document.querySelector('.bs-tag-dialog'));
    await until(()=>document.querySelectorAll('.bs-tab').length===5);
    return tab('心理学').textContent;
  })()`)

  // Per-book dialog assigns the tag and overrides the reading status.
  assert.equal(await evaluate(`(async()=>{
    document.querySelector('.bs-more').click();
    await until(()=>document.querySelector('.bs-cover-menu'));
    [...document.querySelectorAll('.bs-cover-menu button')].find(node=>node.textContent==='bookTags').click();
    await until(()=>document.querySelector('.bs-tag-dialog .bs-tag-choice'));
    [...document.querySelectorAll('.bs-tag-choice')].find(node=>node.textContent==='statusFinished').click();
    await until(()=>[...document.querySelectorAll('.bs-tag-choice')].find(node=>node.textContent==='statusFinished').getAttribute('aria-pressed')==='true');
    [...document.querySelectorAll('.bs-tag-choice')].find(node=>node.textContent==='心理学').click();
    await until(()=>[...document.querySelectorAll('.bs-tag-choice')].find(node=>node.textContent==='心理学').getAttribute('aria-pressed')==='true');
    document.querySelector('.bs-tag-dialog button[type="submit"]').click();
    await until(()=>!document.querySelector('.bs-tag-dialog'));
    await until(()=>document.querySelector('.bs-book-sub') && document.querySelector('.bs-book-sub').textContent.includes('finishedPercent(percent=100)'));
    check(!document.querySelector('.bs-card-progress'),'finished books must not show a progress bar');
    await until(()=>tab('statusFinished') && tab('statusFinished').textContent==='statusFinished1' && tab('心理学').textContent==='心理学1');
    return true;
  })()`), true, 'the card shows the manual status and both tabs count the book')

  // Category tabs filter the grid; an empty category explains itself instead of
  // claiming the search found nothing.
  assert.equal(await evaluate(`(async()=>{
    tab('statusFinished').click();
    await until(()=>document.querySelectorAll('.bs-book-title').length===1);
    check(document.querySelector('.bs-tab[aria-pressed="true"]').textContent==='statusFinished1','finished tab selected');
    tab('statusUnread').click();
    await until(()=>document.querySelector('.bs-empty-title') && document.querySelector('.bs-empty-title').textContent==='emptyCategoryTitle');
    [...document.querySelectorAll('.bs-center button')].find(node=>node.textContent==='showAllBooks').click();
    await until(()=>document.querySelectorAll('.bs-book-title').length===1);
    check(tab('categoryAll').getAttribute('aria-pressed')==='true','all tab restored');
    return true;
  })()`), true, 'category tabs filter the grid and the empty category has its own state')

  // Reload: durable state survives; the shelf view returns to "all".
  await navigateTestPage(socket, `${origin}/test.html`)
  await waitForMount()
  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-tab').length===5 && document.querySelectorAll('.bs-book-title').length===1);
    check(tab('statusFinished').textContent==='statusFinished1','manual status persisted');
    check(tab('心理学').textContent==='心理学1','tag assignment persisted');
    check(tab('categoryAll').getAttribute('aria-pressed')==='true','view resets to all after reload');
    check(document.querySelector('.bs-book-sub').textContent.includes('finishedPercent(percent=100)'),'finished label after reload');
    check(!document.querySelector('.bs-card-progress'),'no progress bar for finished books after reload');
    return true;
  })()`), true, 'status, assignment and definitions survive a page reload')

  // Renaming a tag updates the tab without touching the assignment.
  assert.equal(await evaluate(`(async()=>{
    document.querySelector('[aria-label="manageTags"]').click();
    await until(()=>document.querySelector('.bs-tag-manage-row input'));
    const row=document.querySelector('.bs-tag-manage-row');
    setValue(row.querySelector('input'),'认知科学');
    row.querySelector('.bs-button').click();
    await until(()=>document.querySelector('.bs-tag-manage-row input').value==='认知科学');
    document.querySelector('.bs-tag-dialog [aria-label="dismiss"]').click();
    await until(()=>tab('认知科学') && tab('认知科学').textContent==='认知科学1');
    return true;
  })()`), true, 'renaming a tag keeps its books and updates the tab')

  // Deleting a tag strips the assignment and removes the tab.
  assert.equal(await evaluate(`(async()=>{
    document.querySelector('[aria-label="manageTags"]').click();
    await until(()=>document.querySelector('.bs-tag-manage-row'));
    document.querySelector('.bs-tag-manage-row [aria-label="deleteTag"]').click();
    await until(()=>[...document.querySelectorAll('.bs-tag-manage-row .bs-button')].some(node=>node.textContent==='confirmDeleteTag'));
    [...document.querySelectorAll('.bs-tag-manage-row .bs-button')].find(node=>node.textContent==='confirmDeleteTag').click();
    await until(()=>!document.querySelector('.bs-tag-manage-row'));
    document.querySelector('.bs-tag-dialog .bs-tag-foot button').click();
    await until(()=>!document.querySelector('.bs-tag-dialog'));
    await until(()=>document.querySelectorAll('.bs-tab').length===4);
    return true;
  })()`), true, 'deleting the tag removes its tab')

  const listed = await (await fetch(`${origin}/bookshelf/api/books`)).json()
  assert.equal(listed.tags.length, 0, 'no tag definitions remain')
  assert.equal(listed.books.length, 1)
  assert.deepEqual(listed.books[0].tags, [], 'the assignment was stripped')
  assert.equal(listed.books[0].status, 'finished', 'the manual status is independent of tags')
  assert.equal(listed.books[0].statusManual, true)
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('shelf tags: categories, assignment, status override, rename and delete')
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
