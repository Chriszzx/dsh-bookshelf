// Functional lifecycle regression, not a visual preview of DSH.
// Requires Chrome and React 18 UMD files + paged-long.epub/mixed.pdf fixtures.
// BOOKSHELF_TEST_FIXTURES defaults to the existing /tmp/batch1-test harness.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const fixtures = process.env.BOOKSHELF_TEST_FIXTURES || '/tmp/batch1-test'
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-tab-test-'))
const ownedPath = await realpath(temporary)
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(new URL('../index.js', import.meta.url))
let route
apply({ effect: fn => fn(), webServer: { port: 0, register(value) { route = value; return () => {} } }, logger: { info() {}, warn() {}, error() {} } })
let chrome, socket, server
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
window.unmount=()=>ReactDOM.flushSync(()=>root.render(React.createElement('div',null,'another DSH panel')));
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<12000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.labels=()=>[...document.querySelectorAll('.bs-control-label')].map(e=>e.textContent).find(s=>s.includes('pageOf')||s.includes('pageRangeOf'))||'';
window.click=title=>{const node=document.querySelector('button[title="'+title+'"]');if(!node)throw Error('missing '+title);ReactDOM.flushSync(()=>node.click())};
window.openBook=async(title)=>{await until(()=>[...document.querySelectorAll('.bs-book-title')].some(e=>e.textContent===title));const card=[...document.querySelectorAll('.bs-book-title')].find(e=>e.textContent===title).closest('.bs-card');ReactDOM.flushSync(()=>card.querySelector('.bs-cover').click())};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.roundTrip=async()=>{unmount();await wait(25);mount();await wait(1800);check(!!document.querySelector('.bs-reader'),'reader lost after main-panel switch')};
mount();
</script></body></html>`
let delayWrites = false
let delayDefaults = false
try {
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://test').pathname
      const files = { '/react.js': join(fixtures, 'node_modules/react/umd/react.development.js'), '/react-dom.js': join(fixtures, 'node_modules/react-dom/umd/react-dom.development.js'), '/client.js': join(pluginDir, 'client.js') }
      if (path === '/test.html') { res.setHeader('content-type', 'text/html'); res.end(page); return }
      if (files[path]) { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(files[path])); return }
      if (delayDefaults && req.method === 'GET' && path.endsWith('/settings')) await new Promise(r => setTimeout(r, 3500))
      if (delayWrites && req.method === 'PUT' && path.endsWith('/state')) await new Promise(r => setTimeout(r, 800))
      await route.handler(req, res)
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  async function importBook(title, format, file, settings, progress) {
    const response = await fetch(`${origin}/bookshelf/api/books?name=${title}.${format}&title=${title}&format=${format}`, { method: 'POST', body: await readFile(join(fixtures, file)) })
    assert.equal(response.status, 201)
    const { book } = await response.json()
    const saved = await fetch(`${origin}/bookshelf/api/books/${book.id}/state`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings, progress }) })
    assert.equal(saved.status, 200)
    return book.id
  }
  const epubId = await importBook('EPUB', 'epub', 'paged-long.epub', { pageMode: 'paged', pageMargin: 'compact' }, { format: 'epub', chapterIndex: 0, scrollRatio: .4, percent: .4 })
  const pdfId = await importBook('PDF', 'pdf', 'mixed.pdf', { pdfView: 'single', pdfFit: 'page' }, { format: 'pdf', page: 2, percent: .4 })
  await importBook('Fresh', 'epub', 'paged-long.epub', undefined, undefined)
  assert.equal((await fetch(`${origin}/bookshelf/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { fontSize: 20, pageMode: 'paged', pageMargin: 'fill' } }) })).status, 200)
  const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0', '--window-size=1400,1000', `${origin}/test.html`], { stdio: ['ignore', 'ignore', 'pipe'] })
  const browserUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 10000)
    let log = ''
    chrome.once('error', error => { clearTimeout(timer); reject(error) })
    chrome.stderr.on('data', chunk => { log += chunk; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
  })
  const debugOrigin = 'http://' + new URL(browserUrl).host
  const targets = await (await fetch(`${debugOrigin}/json`)).json()
  const target = targets.find(p => p.url === `${origin}/test.html`)
  assert.ok(target, 'test target')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j })
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
  const startup = Date.now()
  while (true) {
    try { if (await evaluate('Boolean(window.openBook)')) break } catch (error) {
      if (!error.message.includes('Execution context was destroyed')) throw error
    }
    assert.ok(Date.now() - startup < 10000, 'test page initialized')
    await new Promise(r => setTimeout(r, 100))
  }
  const epub = await evaluate(`(async()=>{await until(()=>window.openBook);await openBook('EPUB');await until(()=>labels());await wait(1700);const before=labels();await roundTrip();check(labels()===before,'EPUB page changed: '+before+' -> '+labels());click('nextPage');const turned=labels();await roundTrip();check(labels()===turned,'EPUB immediate switch lost page');return {before,after:labels()}})()`)
  console.log('EPUB paged', epub)
  delayWrites = true
  const pdf = await evaluate(`(async()=>{click('back');await openBook('PDF');await until(()=>document.querySelector('.bs-pdf-page'));await wait(1500);const before=labels();await roundTrip();check(labels()===before,'PDF initial page changed');click('nextPage');const turned=labels();await roundTrip();check(labels()===turned,'PDF immediate switch lost page: '+turned+' -> '+labels());return {before,after:labels()}})()`)
  console.log('PDF single + delayed writes', pdf)
  const continuous = await evaluate(`(async()=>{click('pdfViewMode');await wait(600);const before=labels();await roundTrip();check(labels()===before,'PDF continuous page changed');check(document.querySelectorAll('.bs-pdf-page').length>1,'PDF view lost');return labels()})()`)
  console.log('PDF continuous', continuous)
  delayWrites = false
  delayDefaults = true
  console.log('PDF independent of EPUB defaults', await evaluate(`(async()=>{unmount();await wait(25);const start=performance.now();mount();await until(()=>document.querySelector('.bs-pdf-page'));const elapsed=performance.now()-start;check(elapsed<2500,'PDF blocked by unrelated defaults GET');await wait(3600);return {elapsedMs:Math.round(elapsed)}})()`))
  delayDefaults = false
  const scrolling = await evaluate(`(async()=>{click('back');await openBook('EPUB');await until(()=>labels());await wait(1300);click('readingSettings');const mode=[...document.querySelectorAll('.bs-segment')].find(b=>b.textContent==='modeScroll');mode.click();await wait(700);const frame=document.querySelector('.bs-epub-frame');frame.contentWindow.scrollTo(0,1800);await wait(120);const before=frame.contentWindow.scrollY;await roundTrip();const after=document.querySelector('.bs-epub-frame').contentWindow.scrollY;check(Math.abs(before-after)<5,'EPUB scroll changed: '+before+' -> '+after);click('back');unmount();await wait(25);mount();await until(()=>document.querySelector('.bs-book-title'));check(!document.querySelector('.bs-reader'),'explicit back reopened book');check(!!document.querySelector('.bs-shelf'),'explicit back did not retain shelf');return {before,after}})()`)
  console.log('EPUB scroll + explicit back', scrolling)
  const shelf = await evaluate(`(async()=>{const input=document.querySelector('.bs-search-input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'EPUB');input.dispatchEvent(new Event('input',{bubbles:true}));const select=document.querySelector('.bs-sort-select');select.value='title';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(80);unmount();await wait(25);mount();await until(()=>document.querySelector('.bs-search-input'));check(document.querySelector('.bs-search-input').value==='EPUB','query lost');check(document.querySelector('.bs-sort-select').value==='title','sort lost');return {query:document.querySelector('.bs-search-input').value,sort:document.querySelector('.bs-sort-select').value}})()`)
  console.log('Shelf', shelf)
  console.log('Shelf scroll', await evaluate(`(async()=>{document.getElementById('root').style.height='260px';await wait(80);document.querySelector('.bs-scroll').scrollTop=120;await wait(80);const before=document.querySelector('.bs-scroll').scrollTop;check(before>0,'shelf must scroll');unmount();await wait(25);mount();await until(()=>document.querySelector('.bs-book-title'));await wait(80);const after=document.querySelector('.bs-scroll').scrollTop;check(before===after,'shelf scroll lost');document.getElementById('root').style.height='100%';return {before,after}})()`))
  await new Promise(r => setTimeout(r, 1200))
  const savedPdf = await (await fetch(`${origin}/bookshelf/api/books/${pdfId}/state`)).json()
  assert.equal(savedPdf.state.progress.page, 3)
  const savedEpub = await (await fetch(`${origin}/bookshelf/api/books/${epubId}/state`)).json()
  assert.ok(savedEpub.state.progress.scrollRatio > 0)
  delayDefaults = true
  console.log('EPUB waits for Host defaults', await evaluate(`(async()=>{const input=document.querySelector('.bs-search-input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));await wait(80);unmount();await wait(25);mount();await openBook('Fresh');await wait(300);check(!document.querySelector('.bs-epub-frame'),'EPUB mounted with fallback defaults');await until(()=>document.querySelector('.bs-epub-frame'));await wait(900);const font=()=>document.querySelector('.bs-epub-frame').contentDocument.documentElement.style.getPropertyValue('--bb-font-size');check(font()==='20px','Host default font not applied: '+font());check(!!labels(),'Host default paged mode not applied');unmount();await wait(25);mount();await until(()=>document.querySelector('.bs-epub-frame'));await wait(900);check(font()==='20px','default font lost on remount');click('back');return {font:'20px',mode:'paged'}})()`))
  delayDefaults = false
  await evaluate(`(async()=>{await openBook('EPUB');await until(()=>document.querySelector('.bs-epub-frame'));await wait(700);unmount()})()`)
  await new Promise(r => setTimeout(r, 700))
  assert.equal((await fetch(`${origin}/bookshelf/api/books/${epubId}`, { method: 'DELETE' })).status, 200)
  await evaluate(`(async()=>{mount();await until(()=>document.querySelector('.bs-search-input'));check(!document.querySelector('.bs-reader'),'deleted book must not reopen');check(!document.querySelector('.bs-reader-state-error'),'deleted book caused reader error');unmount();mount();await until(()=>document.querySelector('.bs-search-input'));check(!document.querySelector('.bs-reader'),'deleted selection not cleared')})()`)
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('PASS: durable state, deleted-book recovery and console checks')
} finally {
  socket?.close()
  if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill('SIGTERM'); await exited }
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)) }
  // Delete only the exact temporary directory created and resolved above.
  assert.equal(await realpath(temporary), ownedPath)
  await rm(ownedPath, { recursive: true, force: true })
}
