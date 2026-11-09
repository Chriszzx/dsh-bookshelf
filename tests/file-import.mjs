// Functional browser regression for single-file import. The real bookshelf Host
// and Client are mounted in isolated Chrome; the DSH shell is not involved.
// Run: node tests/file-import.mjs (needs Chrome and React UMD fixtures).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { zipSync, strToU8 } from '../assets/fflate.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const fixtures = process.env.BOOKSHELF_TEST_FIXTURES || '/tmp/batch1-test'
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-import-'))
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
let route, chrome, socket, server

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

apply({
  effect: fn => fn(),
  webServer: { register(value) { route = value; return () => {} } },
  directoryPickerController: { async pick() { return null } },
  logger: { info() {}, warn() {}, error() {} },
})

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
window.decode=base64=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
window.pickFile=async(name,base64,type)=>{
  const data=new DataTransfer();
  data.items.add(new File([decode(base64)],name,{type}));
  const input=document.querySelector('.bs-file-input');
  check(!!input,'file input missing');
  input.files=data.files;
  input.dispatchEvent(new Event('change',{bubbles:true}));
};
window.dropFile=async(name,base64,type)=>{
  const data=new DataTransfer();
  data.items.add(new File([decode(base64)],name,{type}));
  const shelf=document.querySelector('.bs-shelf');
  shelf.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:data}));
  await until(()=>document.querySelector('.bs-drop'));
  shelf.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
};
mount();
</script></body></html>`

try {
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

  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
    `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0',
    '--window-size=1400,1000', `${origin}/test.html`,
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
  const target = targets.find(entry => entry.url === `${origin}/test.html`)
  assert.ok(target, 'test target')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
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
    try { if (await evaluate('Boolean(window.mount && document.querySelector(".bs-shelf"))')) break } catch (error) {
      if (!error.message.includes('Execution context was destroyed')) throw error
    }
    assert.ok(Date.now() - startup < 10000, 'test page initialized')
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // One Import button owns both entries in a dropdown menu.
  const picker = await evaluate(`(async()=>{
    const input=document.querySelector('.bs-file-input');
    window.__pickClicks=0;
    input.click=()=>{window.__pickClicks+=1};
    const trigger=document.querySelector('.bs-header-actions .bs-import-trigger');
    check(!!trigger,'header import trigger missing');
    check(!!document.querySelector('.bs-empty-actions .bs-import-trigger'),'empty-state import trigger missing');
    trigger.click();
    await until(()=>document.querySelector('.bs-import-menu'));
    const items=[...document.querySelectorAll('.bs-import-menu-item')];
    check(items.length===2,'two import menu items');
    const fileItem=items.find(node=>node.textContent.includes('importFilesMenu'));
    check(!!fileItem,'file menu item missing');
    fileItem.click();
    await until(()=>window.__pickClicks===1);
    return {clicks:window.__pickClicks,accept:input.accept,multiple:input.multiple,items:items.length};
  })()`)
  assert.equal(picker.clicks, 1, 'the file menu item opens the file input')
  assert.equal(picker.items, 2, 'the menu contains file and folder entries')
  assert.equal(picker.multiple, true, 'the picker accepts several files')
  assert.match(picker.accept, /\.epub/, 'the picker accepts EPUB')
  assert.match(picker.accept, /\.pdf/, 'the picker accepts PDF')

  // The empty-state entry point opens the same two-item menu and Escape closes it.
  const emptyMenu = await evaluate(`(async()=>{
    document.querySelector('.bs-empty-actions .bs-import-trigger').click();
    await until(()=>document.querySelector('.bs-import-menu'));
    const items=document.querySelectorAll('.bs-import-menu-item').length;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await until(()=>!document.querySelector('.bs-import-menu'));
    return items;
  })()`)
  assert.equal(emptyMenu, 2, 'the empty-state trigger opens the same menu')

  // A picked EPUB is uploaded, parsed for metadata, and listed as a copy.
  const epub = Buffer.from(epubBytes('Picked Book', 'Ada Lovelace')).toString('base64')
  await evaluate(`pickFile('picked.epub','${epub}','application/epub+zip')`)
  await evaluate(`(async()=>{await until(()=>[...document.querySelectorAll('.bs-book-title')].some(e=>e.textContent==='Picked Book'));return true})()`)

  // Dragging files onto the shelf restores the other single-file entry point.
  await evaluate(`dropFile('dropped.pdf','JVBERi0xLjQK','application/pdf')`)
  await evaluate(`(async()=>{await until(()=>document.querySelectorAll('.bs-book-title').length===2);return true})()`)
  assert.deepEqual(
    (await evaluate(`[...document.querySelectorAll('.bs-book-title')].map(e=>e.textContent)`)).sort(),
    ['Picked Book', 'dropped'],
  )

  // Folder linking stays available as a separate, explicit action.
  const folderEntry = await evaluate(`(async()=>{
    const trigger=document.querySelector('.bs-header-actions .bs-import-trigger');
    trigger.click();
    await until(()=>document.querySelector('.bs-import-menu'));
    const folderItem=[...document.querySelectorAll('.bs-import-menu-item')].find(node=>node.textContent.includes('importFolderMenu'));
    check(!!folderItem,'folder menu item missing');
    folderItem.click();
    await until(()=>document.querySelector('.bs-link-choose'));
    return true;
  })()`)
  assert.equal(folderEntry, true, 'Link folder still opens the folder dialog')
  await evaluate(`(()=>{document.querySelector('.bs-apple-head .bs-icon-button').click();return true})()`)

  const listed = await (await fetch(`${origin}/bookshelf/api/books`)).json()
  assert.equal(listed.books.length, 2)
  const picked = listed.books.find(book => book.title === 'Picked Book')
  assert.ok(picked, 'EPUB metadata title imported')
  assert.equal(picked.author, 'Ada Lovelace')
  assert.equal(picked.link, undefined, 'file import is a shelf copy, not a soft link')
  assert.ok(listed.books.some(book => book.title === 'dropped'), 'dropped file imported')
  const stored = await readdir(join(temporary, 'home', 'bookshelf', 'books'))
  assert.equal(stored.length, 2, 'two shelf files stored')
  for (const name of stored) {
    const info = await stat(join(temporary, 'home', 'bookshelf', 'books', name))
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'file import is a regular copy')
  }
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('single-file import: picker and drop import copies as regular files')
} finally {
  try { socket?.close() } catch {}
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill('SIGKILL')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))])
  }
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
