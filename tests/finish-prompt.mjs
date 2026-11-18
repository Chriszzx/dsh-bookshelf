// Functional browser regression for the "mark as finished?" prompt: closing a
// PDF on its last page offers the status, confirming swaps the shelf card to
// "finished 100%" without a progress bar, and a later re-read returns the card
// to "continue reading". The real Host and Client run in isolated Chrome.
// Run: node tests/finish-prompt.mjs (needs Chrome and React UMD fixtures).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { prepareBrowserEnvironment, browserLaunchArgs, navigateTestPage } from './helpers/browser-env.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-finish-'))
process.env.DSH_HOME = join(temporary, 'home')
import { applyTestHost as apply } from './helpers/host-context.mjs'
let route, chrome, socket, server

apply({
  effect: fn => fn(),
  webServer: { register(value) { route = value; return () => {} } },
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
window.sub=()=>document.querySelector('.bs-book-sub')?.textContent||'';
window.openBook=async(page=5)=>{document.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-reader'));await until(()=>{const canvas=document.querySelector('[data-page-number="'+page+'"] canvas');return canvas&&canvas.style.opacity==='1'})};
window.closeBook=async()=>{document.querySelector('[aria-label="back"]').click();await until(()=>document.querySelector('.bs-shelf'))};
window.promptOpen=()=>Boolean(document.querySelector('.bs-apple-dialog [role="alert"], .bs-apple-dialog'));
mount();
</script></body></html>`

try {
  const { fixtures, chromePath } = await prepareBrowserEnvironment(temporary, { books: true })
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

  // A five-page PDF saved on its last page opens at 100% but is not finished
  // yet: reaching the end only offers the status.
  const imported = await fetch(`${api}/books?name=mixed.pdf&title=Mixed&format=pdf`, {
    method: 'POST',
    body: await readFile(join(fixtures, 'mixed.pdf')),
  })
  assert.equal(imported.status, 201)
  const { book } = await imported.json()
  const saveProgress = (page, percent) => fetch(`${api}/books/${book.id}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress: { format: 'pdf', page, percent, updatedAt: Date.now() } }),
  })
  assert.equal((await saveProgress(5, 1)).status, 200)

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

  // An unconfirmed 100% book still reads as "continue reading" on the shelf.
  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelector('.bs-book-title'));
    check(sub().includes('statusReading 100%'),'unconfirmed end-of-book stays in continue reading: '+sub());
    check(!!document.querySelector('.bs-card-progress'),'progress bar is shown before finishing');
    return true;
  })()`), true)

  // Closing on the last page asks once; the prompt is the only path.
  assert.equal(await evaluate(`(async()=>{
    await openBook();
    await closeBook();
    await until(()=>document.querySelector('.bs-apple-dialog'));
    check(document.querySelector('.bs-apple-dialog').textContent.includes('finishPromptTitle'),'finish prompt title');
    check(document.querySelector('.bs-apple-dialog').textContent.includes('finishPromptBody(title=Mixed)'),'finish prompt names the book');
    return true;
  })()`), true)

  // Confirming swaps the card to "finished 100%" and removes the bar.
  assert.equal(await evaluate(`(async()=>{
    [...document.querySelectorAll('.bs-apple-dialog button')].find(node=>node.textContent==='finishPromptConfirm').click();
    await until(()=>!document.querySelector('.bs-apple-dialog'));
    await until(()=>sub().includes('statusFinished'));
    check(!document.querySelector('.bs-card-progress'),'finished cards hide the progress bar');
    return true;
  })()`), true)
  let listed = await (await fetch(`${api}/books`)).json()
  assert.equal(listed.books[0].status, 'finished')
  assert.equal(listed.books[0].statusManual, true)

  // Reopening and leaving again at the last page does not ask twice.
  assert.equal(await evaluate(`(async()=>{
    await openBook();
    await closeBook();
    await wait(400);
    check(!document.querySelector('.bs-apple-dialog'),'already finished books are not asked again');
    return true;
  })()`), true)

  // Re-reading below the last page returns the card to "continue reading" and
  // drops the finished override on the Host.
  assert.equal((await saveProgress(2, 0.4)).status, 200)
  await navigateTestPage(socket, `${origin}/test.html`)
  await waitForMount()
  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelector('.bs-book-title'));
    check(sub().includes('statusReading 40%'),'re-reading shows continue reading: '+sub());
    check(!!document.querySelector('.bs-card-progress'),'progress bar returns after re-reading');
    check(document.querySelector('.bs-card-progress').getAttribute('aria-valuenow')==='40','progress shows the saved page');
    return true;
  })()`), true)

  // A book below the last page exits without the prompt.
  assert.equal(await evaluate(`(async()=>{
    await openBook(2);
    await closeBook();
    await wait(400);
    check(!document.querySelector('.bs-apple-dialog'),'partial reads never prompt');
    return true;
  })()`), true)

  listed = await (await fetch(`${api}/books`)).json()
  assert.equal(listed.books[0].status, 'reading')
  assert.equal(listed.books[0].statusManual, false)
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('finish prompt: last-page confirmation, finished card, re-read reset')
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
