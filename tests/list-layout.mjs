// Functional browser regression for the list arrangement: the shelf switches
// between the cover grid and a vertical row list, rows carry the same status
// text/progress rules, filtering still applies, row actions work, and the
// choice survives a reload through localStorage.
// Run: node tests/list-layout.mjs (needs Chrome and React UMD fixtures).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { prepareBrowserEnvironment, browserLaunchArgs, navigateTestPage } from './helpers/browser-env.mjs'
import { zipSync, strToU8 } from '../assets/fflate.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-list-'))
process.env.DSH_HOME = join(temporary, 'home')
import { applyTestHost as apply } from './helpers/host-context.mjs'
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
window.setSelect=(el,value)=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}))};
window.rows=()=>[...document.querySelectorAll('.bs-row')];
window.titles=()=>[...document.querySelectorAll('.bs-row-open .bs-row-title')].map(node=>node.textContent);
window.rowOf=(title)=>rows().find(row=>row.querySelector('.bs-row-open .bs-row-title')?.textContent===title);
window.tab=(test)=>[...document.querySelectorAll('.bs-tab')].find(node=>node.textContent.startsWith(test));
window.toggleLayout=(name)=>document.querySelector('[aria-label="'+name+'"]').click();
window.openRow=(title)=>rowOf(title).querySelector('.bs-row-open').click();
window.openRowMenu=(title)=>rowOf(title).querySelector('.bs-row-more').click();
window.menuItem=(key)=>[...document.querySelectorAll('.bs-row-menu button')].find(node=>node.textContent===key);
window.rowFill=()=>{const scroll=document.querySelector('.bs-scroll');const style=getComputedStyle(scroll);const content=scroll.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);const row=document.querySelector('.bs-row').getBoundingClientRect().width;return {content,row}};
mount();
</script></body></html>`

try {
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
  const api = `${origin}/bookshelf/api`

  // Four books cover every display state: unread, reading, finished, tagged.
  const seeded = []
  for (const [title, author] of [['Alpha', 'Ada'], ['Beta', 'Bob'], ['Gamma', 'Cara'], ['Delta', 'Dan']]) {
    const response = await fetch(`${api}/books?name=${title}.epub&title=${title}&author=${author}&format=epub`, {
      method: 'POST',
      body: epubBytes(title, author),
    })
    seeded.push((await response.json()).book)
  }
  const beta = seeded[1]
  const gamma = seeded[2]
  const delta = seeded[3]
  const putState = (id, progress) => fetch(`${api}/books/${id}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress: { format: 'epub', chapterIndex: 1, percent: progress, updatedAt: Date.now() } }),
  })
  assert.equal((await putState(beta.id, 0.42)).status, 200)
  assert.equal((await putState(gamma.id, 1)).status, 200)
  assert.equal((await fetch(`${api}/books/${gamma.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'finished' }),
  })).status, 200)
  const tag = (await (await fetch(`${api}/tags`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '心理学' }),
  })).json()).tag
  assert.equal((await fetch(`${api}/books/${delta.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tags: [tag.id] }),
  })).status, 200)

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

  // Default is the cover grid with the two layout buttons.
  assert.deepEqual(await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-card').length===4);
    check(!!document.querySelector('.bs-grid'),'cover grid by default');
    check(!document.querySelector('.bs-list'),'no list before switching');
    const buttons=[...document.querySelectorAll('.bs-layout-button')];
    check(buttons.length===2,'two layout buttons');
    check(document.querySelector('.bs-shelf').getAttribute('data-layout')==='grid','grid marker');
    return buttons.map(button=>button.getAttribute('aria-pressed'));
  })()`), ['true', 'false'])

  // The list shows one row per book with the same status rules.
  assert.equal(await evaluate(`(async()=>{
    toggleLayout('layoutList');
    await until(()=>document.querySelectorAll('.bs-row').length===4 && !document.querySelector('.bs-grid'));
    check(document.querySelector('.bs-shelf').getAttribute('data-layout')==='list','list marker');
    check(localStorage.getItem('bookshelf.layout.v1')==='list','layout stored');
    const fill=rowFill();
    check(Math.abs(fill.content-fill.row)<2,'rows fill the shelf width: '+fill.row+' vs '+fill.content);
    const beta=rowOf('Beta');
    check(!!beta.querySelector('.bs-row-progress'),'reading row shows a progress bar');
    check(beta.querySelector('.bs-row-progress').getAttribute('aria-valuenow')==='42','reading row progress value');
    check(beta.textContent.includes('statusReading 42%'),'reading row label');
    const gamma=rowOf('Gamma');
    check(!gamma.querySelector('.bs-row-progress'),'finished row hides the progress bar');
    check(gamma.textContent.includes('statusFinished'),'finished row label');
    check(!rowOf('Alpha').querySelector('.bs-row-progress'),'unread row has no progress bar');
    return titles().slice().sort().join(',');
  })()`), 'Alpha,Beta,Delta,Gamma')

  // Search, tabs and sorting operate on the same filtered list.
  assert.equal(await evaluate(`(async()=>{
    setValue(document.querySelector('.bs-search-input'),'Beta');
    await until(()=>document.querySelectorAll('.bs-row').length===1);
    check(titles()[0]==='Beta','search narrows rows');
    setValue(document.querySelector('.bs-search-input'),'');
    await until(()=>document.querySelectorAll('.bs-row').length===4);
    tab('statusFinished').click();
    await until(()=>document.querySelectorAll('.bs-row').length===1 && titles()[0]==='Gamma');
    tab('心理学').click();
    await until(()=>document.querySelectorAll('.bs-row').length===1 && titles()[0]==='Delta');
    tab('categoryAll').click();
    await until(()=>document.querySelectorAll('.bs-row').length===4);
    setSelect(document.querySelector('.bs-sort-select'),'title');
    await until(()=>titles().join(',')==='Alpha,Beta,Delta,Gamma');
    setSelect(document.querySelector('.bs-sort-select'),'added');
    await until(()=>document.querySelectorAll('.bs-row').length===4);
    return true;
  })()`), true)

  // Opening a row returns to the list arrangement, and row actions work.
  assert.equal(await evaluate(`(async()=>{
    openRow('Beta');
    await until(()=>document.querySelector('.bs-reader'));
    document.querySelector('.bs-reader-bar .bs-icon-button').click();
    await until(()=>document.querySelectorAll('.bs-row').length===4);
    // This fixture fits on one page, so returning can offer to mark it finished.
    document.querySelector('[aria-label="finishPromptTitle"] [aria-label="dismiss"]')?.click();
    await until(()=>!document.querySelector('[aria-label="finishPromptTitle"]'));
    check(!!document.querySelector('.bs-list'),'list survives the reader');
    openRowMenu('Beta');
    await until(()=>document.querySelector('.bs-row-menu'));
    const items=[...document.querySelectorAll('.bs-row-menu button')].map(node=>node.textContent);
    check(items.join(',')==='rename,bookTags,audiobookMenu,delete','row menu items');
    menuItem('bookTags').click();
    await until(()=>document.querySelector('.bs-tag-dialog'));
    document.querySelector('.bs-tag-dialog [aria-label="dismiss"]').click();
    await until(()=>!document.querySelector('.bs-tag-dialog'));
    openRowMenu('Beta');
    await until(()=>document.querySelector('.bs-row-menu'));
    menuItem('rename').click();
    await until(()=>document.querySelector('.bs-rename-dialog'));
    document.querySelector('.bs-rename-dialog [aria-label="dismiss"]').click();
    await until(()=>!document.querySelector('.bs-rename-dialog'));
    openRowMenu('Beta');
    await until(()=>document.querySelector('.bs-row-menu'));
    menuItem('delete').click();
    await until(()=>document.querySelector('.bs-row-confirming'));
    check(document.querySelector('.bs-row-confirming').textContent.includes('deleteTitle'),'confirmation replaces a row');
    [...document.querySelectorAll('.bs-row-confirm-button')].find(node=>node.textContent==='cancel').click();
    await until(()=>!document.querySelector('.bs-row-confirming') && document.querySelectorAll('.bs-row').length===4);
    return true;
  })()`), true)

  // Deleting through the row menu removes the book and keeps the list.
  assert.equal(await evaluate(`(async()=>{
    openRowMenu('Alpha');
    await until(()=>document.querySelector('.bs-row-menu'));
    menuItem('delete').click();
    await until(()=>document.querySelector('.bs-row-confirming'));
    [...document.querySelectorAll('.bs-row-confirm-button')].find(node=>node.textContent==='confirmDelete').click();
    await until(()=>document.querySelectorAll('.bs-row').length===3);
    check(!titles().includes('Alpha'),'deleted book leaves the list');
    return true;
  })()`), true)

  // The preference survives a reload; the grid toggle survives it as well.
  await navigateTestPage(socket, `${origin}/test.html`)
  await waitForMount()
  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-row').length===3);
    check(!!document.querySelector('.bs-list'),'list mode restored after reload');
    check(document.querySelector('[aria-label="layoutList"]').getAttribute('aria-pressed')==='true','list button pressed');
    toggleLayout('layoutCover');
    await until(()=>document.querySelectorAll('.bs-card').length===3);
    check(localStorage.getItem('bookshelf.layout.v1')==='grid','grid preference stored');
    return true;
  })()`), true)
  await navigateTestPage(socket, `${origin}/test.html`)
  await waitForMount()
  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-card').length===3);
    check(!document.querySelector('.bs-list'),'grid mode restored after reload');
    return true;
  })()`), true)

  // Returning to the list stays usable in a narrow panel without overflow.
  assert.equal(await evaluate(`(async()=>{
    toggleLayout('layoutList');
    await until(()=>document.querySelectorAll('.bs-row').length===3);
    document.getElementById('root').style.width='480px';
    await wait(150);
    const shelf=document.querySelector('.bs-root');
    check(shelf.scrollWidth-shelf.clientWidth<2,'narrow list does not overflow horizontally');
    check(document.querySelectorAll('.bs-row').length===3,'narrow list keeps every row');
    let fill=rowFill();
    check(Math.abs(fill.content-fill.row)<2,'narrow rows fill the shelf width: '+fill.row+' vs '+fill.content);
    document.getElementById('root').style.width='1600px';
    await wait(150);
    fill=rowFill();
    check(Math.abs(fill.content-fill.row)<2,'wide rows fill the shelf width after collapsing a sidebar: '+fill.row+' vs '+fill.content);
    return true;
  })()`), true)

  // Existing libraries can contain blank metadata and a manual status override.
  const libraryFile = join(temporary, 'home', 'bookshelf', 'library.json')
  const library = JSON.parse(await readFile(libraryFile, 'utf8'))
  Object.assign(library.books.find(book => book.id === beta.id), { title: '  ', author: '', status: 'unread' })
  await writeFile(libraryFile, JSON.stringify(library))
  await navigateTestPage(socket, `${origin}/test.html`)
  await waitForMount()
  for (const layout of ['layoutList', 'layoutCover']) {
    await evaluate(`toggleLayout('${layout}')`)
    const actual = await evaluate(`(async()=>{
      const selector='.bs-row-open,.bs-card'
      await until(()=>[...document.querySelectorAll(selector)].some(book=>book.textContent.includes('Beta.epub')))
      const book=[...document.querySelectorAll(selector)].find(book=>book.textContent.includes('Beta.epub'))
      return [book.querySelector('.bs-book-title,.bs-row-title').textContent,
        book.querySelector('.bs-book-sub,.bs-row-sub').textContent, !!book.querySelector('[role="progressbar"]'),
        !!book.querySelector('.bs-cover-format,.bs-row-format')]
    })()`)
    assert.deepEqual(actual, ['Beta.epub', 'statusUnread · unnamedAuthor', false, false])
  }
  const listed = await (await fetch(`${api}/books`)).json()
  assert.equal(listed.books.length, 3)
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('list layout: rows, status rules, filtering, row actions, deletion and persistence')
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
