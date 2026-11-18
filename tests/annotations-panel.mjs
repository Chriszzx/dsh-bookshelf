// Functional browser regression for the bookmarks / annotations panel: the
// aside tab bar carries counts, the tool row sorts (position / time / type) and
// searches the merged list from assets/lib/reading-list.mjs, rows show one icon
// per kind, selecting a row jumps to its chapter and deleting a row writes the
// matching bookmark / annotation collection back to the Host.
// Run: node tests/annotations-panel.mjs (needs Chrome and React UMD fixtures).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { prepareBrowserEnvironment, browserLaunchArgs, navigateTestPage } from './helpers/browser-env.mjs'
import { zipSync, strToU8 } from '../assets/fflate.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-annotations-panel-'))
process.env.DSH_HOME = join(temporary, 'home')
import { applyTestHost as apply } from './helpers/host-context.mjs'
let route, chrome, socket, server

apply({
  effect: fn => fn(),
  webServer: { register(value) { route = value; return () => {} } },
  logger: { info() {}, warn() {}, error() {} },
})

function epubBytes(title, chapters) {
  const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  const manifest = chapters.map((_, index) => `<item id="ch${index}" href="ch${index}.xhtml" media-type="application/xhtml+xml"/>`).join('')
  const spine = chapters.map((_, index) => `<itemref idref="ch${index}"/>`).join('')
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:44444444-4444-4444-8444-444444444444</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test</dc:creator><dc:language>zh</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`
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
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<30000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.untilAsync=async(fn)=>{const start=Date.now();while(Date.now()-start<30000){if(await fn())return;await wait(80)}throw Error('Timed out: '+fn)};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.setValue=(el,value)=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
window.setSelect=(el,value)=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}))};
window.api=async(path,options)=>{const response=await fetch('/bookshelf/api'+path,options);return response.json()};
window.stateFor=async(title)=>{const list=await api('/books');const book=list.books.find(item=>item.title===title);check(!!book,'book '+title);const payload=await api('/books/'+book.id+'/state');return {book,state:payload.state||{}}};
window.openBook=async(title)=>{const cards=[...document.querySelectorAll('.bs-card')];const card=cards.find(node=>node.querySelector('.bs-book-title')?.textContent===title);check(!!card,'book card '+title);card.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-reader')&&document.querySelector('.bs-epub-frame'))};
window.rows=()=>[...document.querySelectorAll('.bs-reading-row')];
window.kinds=()=>rows().map(node=>node.getAttribute('data-kind'));
window.asideTabs=()=>[...document.querySelectorAll('.bs-aside-tab')];
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

  const epubResponse = await fetch(`${api}/books?name=annotations-panel.epub&title=Panel&format=epub`, {
    method: 'POST',
    body: epubBytes('Panel', [
      ['第一章的正文足够长，方便把高亮锚点放在章节开头之后的位置。', '第一章的第二段让滚动位置更自然。'],
      ['第二章的正文同样保留为下划线锚点所在的位置。', '第二章的第二段收尾。'],
    ]),
  })
  assert.equal(epubResponse.status, 201)
  const book = (await epubResponse.json()).book

  // Seed one bookmark and one annotation per chapter so all three row kinds are
  // in the panel: older bookmarks, newer annotations.
  const bookmarks = [
    { id: 'bm_first', label: '第一章书签', format: 'epub', chapterIndex: 0, scrollRatio: 0.1, percent: 0.1, createdAt: 1000 },
    { id: 'bm_second', label: '第二章书签', format: 'epub', chapterIndex: 1, scrollRatio: 0.9, percent: 0.6, createdAt: 3000 },
  ]
  const annotations = [
    {
      id: 'an_highlight', type: 'highlight', chapterIndex: 0, start: 100, end: 110,
      quote: '高亮引用文字', color: '#ffd23f', strength: 0.35, thickness: 2, underlineStyle: 'solid', createdAt: 2000,
    },
    {
      id: 'an_underline', type: 'underline', chapterIndex: 1, start: 120, end: 130,
      quote: '下划线引用', color: '#112233', strength: 0.5, thickness: 4, underlineStyle: 'wavy', createdAt: 4000,
    },
  ]
  const stateResponse = await fetch(`${api}/books/${book.id}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bookmarks, annotations }),
  })
  assert.equal(stateResponse.status, 200)
  const seeded = (await stateResponse.json()).state || {}
  assert.equal(seeded.annotations.length, 2)
  assert.equal(seeded.bookmarks.length, 2)

  chrome = spawn(chromePath, [
    ...browserLaunchArgs(), '--headless=new', '--disable-gpu', '--disable-popup-blocking', '--no-first-run', '--disable-background-networking',
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

  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-card').length===1);
    await openBook('Panel');
    await until(()=>document.querySelector('.bs-aside-tab'));
    // Both tabs carry their entry count; the merged panel counts bookmarks and
    // annotations together (2 bookmarks + 2 annotations = 4).
    check(asideTabs()[0].textContent==='tocTab (2)','toc tab count: '+asideTabs()[0].textContent);
    check(asideTabs()[1].textContent==='bookmarksTab (4)','bookmark tab count: '+asideTabs()[1].textContent);
    check(!document.querySelector('.bs-reading-tools'),'tool row belongs to the bookmarks tab');
    asideTabs()[1].click();
    await until(()=>document.querySelector('.bs-reading-tools'));
    const sortSelect=document.querySelector('.bs-reading-sort');
    const searchInput=document.querySelector('.bs-reading-search');
    check(!!sortSelect,'sort select present');
    check(sortSelect.getAttribute('aria-label')==='readingSort','sort label');
    check([...sortSelect.options].map(option=>option.value).join(',')==='position,recent,kind','sort modes: '+[...sortSelect.options].map(option=>option.value).join(','));
    check(!!searchInput&&searchInput.getAttribute('type')==='search','search input present');
    await until(()=>rows().length===4);
    // One row per merged item, one leading icon per kind.
    check(kinds().filter(kind=>kind==='bookmark').length===2,'two bookmark rows: '+kinds().join(','));
    check(kinds().filter(kind=>kind==='highlight').length===1,'one highlight row: '+kinds().join(','));
    check(kinds().filter(kind=>kind==='underline').length===1,'one underline row: '+kinds().join(','));
    check(!!document.querySelector('.bs-reading-row[data-kind="bookmark"] .bs-reading-icon-bookmark svg'),'bookmark row icon');
    check(!!document.querySelector('.bs-reading-row[data-kind="highlight"] .bs-reading-icon-highlight svg'),'highlight row icon');
    check(!!document.querySelector('.bs-reading-row[data-kind="underline"] .bs-reading-icon-underline svg'),'underline row icon');
    const annotationRow=document.querySelector('.bs-reading-row[data-kind="highlight"] .bs-reading-main');
    check(annotationRow.querySelector('.bs-reading-label').textContent==='高亮引用文字','annotation label: '+annotationRow.querySelector('.bs-reading-label').textContent);
    check(annotationRow.querySelector('.bs-reading-detail').textContent.includes(' · '),'annotation detail carries chapter and time: '+annotationRow.querySelector('.bs-reading-detail').textContent);
    // Position sort is chapter-major: bookmark then annotation inside each chapter.
    check(kinds().join(',')==='bookmark,highlight,bookmark,underline','position order: '+kinds().join(','));
    // Time sort is newest first.
    setSelect(sortSelect,'recent');
    await until(()=>kinds().join(',')==='underline,bookmark,highlight,bookmark');
    // Type sort groups highlight, underline, then bookmarks.
    setSelect(sortSelect,'kind');
    await until(()=>kinds().join(',')==='highlight,underline,bookmark,bookmark');
    // Search matches the annotation quote / bookmark label.
    setValue(searchInput,'高亮');
    await until(()=>rows().length===1&&kinds()[0]==='highlight');
    check(document.querySelector('.bs-reading-label').textContent==='高亮引用文字','search keeps the matching row');
    setValue(searchInput,'书签');
    await until(()=>rows().length===2&&kinds().every(kind=>kind==='bookmark'));
    setValue(searchInput,'zzz-no-match');
    await until(()=>document.querySelector('.bs-reading-empty'));
    check(document.querySelector('.bs-reading-empty').textContent==='noReadingMatches','empty search message: '+document.querySelector('.bs-reading-empty').textContent);
    setValue(searchInput,'');
    await until(()=>rows().length===4);
    setSelect(sortSelect,'position');
    await until(()=>kinds().join(',')==='bookmark,highlight,bookmark,underline');
    // Deleting an annotation writes only the annotations collection back.
    document.querySelector('.bs-reading-row[data-kind="highlight"] .bs-reading-delete').click();
    await until(()=>rows().length===3);
    check(asideTabs()[1].textContent==='bookmarksTab (3)','tab count follows the delete: '+asideTabs()[1].textContent);
    await untilAsync(async()=>{
      const {state}=await stateFor('Panel');
      return state.annotations.length===1&&state.annotations[0].type==='underline'&&state.bookmarks.length===2;
    });
    // Deleting a bookmark writes only the bookmarks collection back.
    document.querySelector('.bs-reading-row[data-kind="underline"] .bs-reading-delete').click();
    await until(()=>kinds().join(',')==='bookmark,bookmark');
    await untilAsync(async()=>{
      const {state}=await stateFor('Panel');
      return state.annotations.length===0&&state.bookmarks.length===2;
    });
    // Selecting a row jumps to its chapter.
    const second=[...document.querySelectorAll('.bs-reading-main')].find(node=>node.textContent.includes('第二章书签'));
    check(!!second,'second chapter bookmark row');
    second.click();
    await until(()=>document.querySelector('.bs-reader-sub').textContent.includes('chapterOf(current=2,total=2)'));
    return true;
  })()`), true)

  const imported = await fetch(api + '/books?name=windows.epub&title=Windows&format=epub', {
    method: 'POST', body: epubBytes('Windows', [['Alpha paragraph'], ['Bravo paragraph']]),
  })
  assert.equal(imported.status, 201)
  const { book: otherBook } = await imported.json()
  const path = api + '/books/' + otherBook.id + '/state'
  const seededMarks = await fetch(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bookmarks, annotations }) })
  assert.equal(seededMarks.status, 200)
  await evaluate(`(async()=>{
    document.querySelector('button[title="back"]').click()
    await until(()=>document.querySelectorAll('.bs-card').length===2)
    const other=window.open('/test.html','mark-editor')
    try {
      await until(()=>other?.document.querySelectorAll('.bs-card').length===2)
      await Promise.all([openBook('Windows'),other.openBook('Windows')])
      await Promise.all([window,other].map(w=>w.until(()=>w.document.querySelectorAll('.bs-toc-label').length===2)))
      other.document.querySelectorAll('.bs-toc-label')[1].click()
      await other.until(()=>other.document.querySelector('.bs-epub-frame').contentDocument.body.textContent.includes('Bravo'))
      async function edit(w, bookmarkLabel, annotationLabel, kind) {
        const doc=w.document
        w.asideTabs()[1].click()
        await w.until(()=>w.rows().length===4)
        function remove(label) {
          const row=w.rows().find(n=>n.querySelector('.bs-reading-label').textContent===label)
          row.querySelector('.bs-reading-delete').click()
        }
        remove(bookmarkLabel)
        remove(annotationLabel)
        await w.until(()=>doc.querySelector('button[title="addBookmark"]'))
        doc.querySelector('button[title="addBookmark"]').click()
        const chapter=doc.querySelector('.bs-epub-frame').contentDocument
        const para=chapter.querySelector('p'), range=chapter.createRange()
        range.selectNodeContents(para)
        const selection=chapter.defaultView.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        para.dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}))
        await w.until(()=>doc.querySelector('.bs-selection-menu'))
        Array.from(doc.querySelectorAll('.bs-selection-item')).find(n=>n.textContent===kind).click()
      }
      await Promise.all([
        edit(window,'第一章书签','高亮引用文字','selectionHighlight'),
        edit(other,'第二章书签','下划线引用','selectionUnderline'),
      ])
      await untilAsync(async()=>{
        const {state}=await stateFor('Windows')
        return state.bookmarks.length===2 && state.bookmarks.every(b=>!['bm_first','bm_second'].includes(b.id)) &&
          state.annotations.map(a=>a.quote).sort().join('|')==='Alpha paragraph|Bravo paragraph'
      })
      await Promise.all([window,other].map(async w=>{
        w.document.querySelector('button[title="back"]').click()
        await w.until(()=>w.document.querySelectorAll('.bs-card').length===2)
        await w.openBook('Windows')
        w.asideTabs()[1].click()
        await w.until(()=>w.rows().length===4)
        const labels=w.rows().map(row=>row.querySelector('.bs-reading-label').textContent)
        check(labels.includes('Alpha paragraph')&&labels.includes('Bravo paragraph'),'reopened marks: '+labels)
        check(w.kinds().filter(kind=>kind==='bookmark').length===2,'both bookmarks survive reopening')
      }))
      check(!other.errors.length,'second window errors: '+other.errors)
    } finally { other?.close() }
  })()`)
  const { state: merged } = await (await fetch(path)).json()
  assert.deepEqual(merged.bookmarks.map(mark => mark.chapterIndex).sort(), [0, 1])
  assert.deepEqual(merged.annotations.map(mark => mark.type).sort(), ['highlight', 'underline'])
  console.log('Two reader windows added and deleted independent bookmarks and annotations')
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('bookmarks / annotations panel: counts, kind icons, sort, search, delete and chapter jump')
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
