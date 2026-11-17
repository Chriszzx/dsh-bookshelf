// Regression: the cover grid measures its row width first, then fits the
// largest comfortable column count. Gutters stay at 20px, cards stay between
// 164 and 196px, full rows reach the grid edge, and a short last row is
// left-aligned instead of being stretched or decorated.
// Run: node tests/shelf-grid.mjs (needs Chrome and React UMD fixtures).
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-shelf-grid-'))
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
let route, chrome, socket, server

apply({ effect: fn => fn(), webServer: { register(value) { route = value; return () => {} } }, logger: { info() {}, warn() {}, error() {} } })

function epubBytes(title) {
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:66666666-6666-4666-8666-666666666666</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>`
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/ch.xhtml': strToU8('<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>One.</p></body></html>'),
  })
}

const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}#root{width:1440px}</style></head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>window.__ModuleLoader__={load(d){window.definition=d}};</script><script src="/client.js"></script>
<script>
window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const t=(key)=>key;const regs=[];
definition.factory(id=>{if(id==='react')return React;throw Error(id)}).apply({effect:fn=>fn(),locale:{register(){return()=>{}},bind(){return t}},slots:{inject(k,fn){fn()},register(o,C){regs.push({o,C})}}});
const Panel=regs.find(r=>r.o.name==='main').C;
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<15000){if(fn())return;await wait(40)}throw Error('Timed out')};
ReactDOM.flushSync(()=>ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Panel,{t})));
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
  for (let index = 0; index < 12; index += 1) {
    const response = await fetch(`${origin}/bookshelf/api/books?name=g${index}.epub&title=Book${index}&format=epub`, { method: 'POST', body: epubBytes(`Book ${index}`) })
    assert.equal(response.status, 201)
  }

  chrome = spawn(chromePath, [
    ...browserLaunchArgs(), '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
    `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0', '--window-size=1800,1000', 'about:blank',
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
  const evaluate = expression => new Promise((resolve, reject) => {
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
    try { if (await evaluate('Boolean(document.querySelectorAll(".bs-card").length===12)')) break } catch {}
    assert.ok(Date.now() - startup < 10000, 'shelf mounted')
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const measure = width => evaluate(`(async()=>{
    document.getElementById('root').style.width='${width}px';
    await wait(250);
    const grid=document.querySelector('.bs-grid');
    const cards=[...grid.children];
    const firstTop=cards[0].getBoundingClientRect().top;
    const rows=[];
    for(const card of cards){
      const rect=card.getBoundingClientRect();
      const row=rows.find(item=>Math.abs(item.top-rect.top)<1);
      if(row)row.cards.push(rect); else rows.push({top:rect.top,cards:[rect]});
    }
    const allWidths=cards.map(card=>card.getBoundingClientRect().width);
    const first=rows[0].cards;
    const last=rows[rows.length-1].cards;
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      rowSizes: rows.map(row=>row.cards.length),
      minCard: Math.min(...allWidths),
      maxCard: Math.max(...allWidths),
      gap: first.length>1?first[1].left-first[0].right:0,
      rowRight: first[first.length-1].right,
      gridRight: grid.getBoundingClientRect().right,
      gridLeft: grid.getBoundingClientRect().left,
      lastRowLeft: last[0].left,
      lastRowRight: last[last.length-1].right,
      overflow: grid.scrollWidth-grid.clientWidth,
    };
  })()`)

  for (const [width, columns, rowSizes] of [[1440, 7, [7, 5]], [1600, 8, [8, 4]], [480, 2, [2, 2, 2, 2, 2, 2]]]) {
    const state = await measure(width)
    assert.equal(state.columns, columns, `width ${width} uses ${columns} columns: ${JSON.stringify(state)}`)
    assert.deepEqual(state.rowSizes, rowSizes, `width ${width} keeps row counts: ${JSON.stringify(state)}`)
    assert.ok(Math.abs(state.maxCard - state.minCard) < 0.5, `cover widths are equal: ${JSON.stringify(state)}`)
    assert.ok(Math.abs(state.gap - 20) < 0.6, `gutters stay at 20px: ${JSON.stringify(state)}`)
    assert.ok(Math.abs(state.rowRight - state.gridRight) < 1.5, `a full row reaches the grid edge: ${JSON.stringify(state)}`)
    assert.ok(Math.abs(state.lastRowLeft - state.gridLeft) < 1.5, `the short last row stays left-aligned: ${JSON.stringify(state)}`)
    assert.ok(state.minCard >= 164, `cards are not cramped: ${JSON.stringify(state)}`)
    if (width !== 480) assert.ok(state.maxCard <= 196, `cards do not outgrow the comfortable range: ${JSON.stringify(state)}`)
    assert.ok(state.overflow < 2, `grid does not overflow: ${JSON.stringify(state)}`)
  }
  assert.equal(await evaluate(`Boolean(document.querySelector('.bs-card-ornament'))`), false, 'no bookend decorations remain')
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('shelf grid: fixed 20px gutters, 164-196px covers, left-aligned short row')
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
