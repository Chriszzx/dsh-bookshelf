// Whole-book audiobook dialog: menu entry, estimate, stubbed DeepSeek render and
// download. The provider is injected, so this never spends credit or renders a
// real book; the fixture is three sentences long.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { prepareBrowserEnvironment, browserLaunchArgs, navigateTestPage } from './helpers/browser-env.mjs'
import { zipSync, strToU8 } from '../assets/fflate.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-audiobook-dialog-'))
process.env.DSH_HOME = join(temporary, 'home')
process.env.DEEPSEEK_API_KEY = 'test-key'
import { applyTestHost as apply } from './helpers/host-context.mjs'
let route, chrome, socket, server
const providerCalls = []

function makeWav(samples = 8) {
  const data = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) data.writeInt16LE(index * 8, index * 2)
  const buffer = Buffer.alloc(44 + data.length)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + data.length, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24)
  buffer.writeUInt32LE(48000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(data.length, 40)
  data.copy(buffer, 44)
  return buffer
}

function tinyEpub(title) {
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'book.opf': strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">dialog-book</dc:identifier><dc:title>${title}</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>`),
    'one.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>第一句话。第二句话。第三句话。</p></body></html>'),
  })
}

apply(
  {
    effect: fn => fn(),
    webServer: { register(value) { route = value; return () => {} } },
    logger: { info() {}, warn() {}, error() {} },
  },
  {
    tts: {
      platform: 'win32',
      fetchImpl: async (url, init) => {
        providerCalls.push({ url, body: JSON.parse(init.body) })
        return new Response(makeWav(8), { status: 200, headers: { 'content-type': 'audio/wav' } })
      },
    },
  },
)

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
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<25000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.dialog=()=>document.querySelector('.bs-audiobook-dialog');
window.item=(label)=>[...document.querySelectorAll('.bs-audiobook-item')].find(node=>node.textContent.startsWith(label));
window.value=(label)=>{const node=item(label);return node?node.textContent.slice(label.length):null};
window.button=(label)=>[...document.querySelectorAll('.bs-audiobook-dialog button')].find(node=>node.textContent===label);
window.openDialog=async()=>{
  const card=document.querySelector('.bs-card');
  check(!!card,'book card');
  card.querySelector('.bs-more').click();
  await until(()=>document.querySelector('.bs-cover-menu'));
  const entry=[...document.querySelectorAll('.bs-cover-menu [role="menuitem"]')].find(node=>node.textContent==='audiobookMenu');
  check(!!entry,'audiobook menu entry');
  entry.click();
  await until(()=>dialog());
};
mount();
</script></body></html>`

const initialJobState = Promise.withResolvers()
let delayEstimate = false
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
      if (req.method === 'GET' && path.endsWith('/audio')) await initialJobState.promise
      if (delayEstimate && path.endsWith('/audio/plan')) await new Promise(resolve => setTimeout(resolve, 400))
      await route.handler(req, res)
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const api = `${origin}/bookshelf/api`
  const imported = await fetch(`${api}/books?name=dialog.epub&title=Dialog&format=epub`, { method: 'POST', body: tinyEpub('Dialog') })
  assert.equal(imported.status, 201)

  chrome = spawn(chromePath, [
    ...browserLaunchArgs(), '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
    `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0',
    '--window-size=1200,900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const browserUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 10000)
    let log = ''
    chrome.once('error', error => { clearTimeout(timer); reject(error) })
    chrome.stderr.on('data', chunk => {
      log = (log + chunk).slice(-32000)
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
  const startup = Date.now()
  while (true) {
    try { if (await evaluate('Boolean(window.mount && document.querySelector(".bs-card"))')) break } catch (error) {
      if (!error.message.includes('Execution context was destroyed')) throw error
    }
    assert.ok(Date.now() - startup < 10000, 'test page initialized')
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const estimate = await evaluate(`(async()=>{
    await openDialog();
    await until(()=>value('audiobookSentences')!==null);
    return {
      sentences:value('audiobookSentences'),
      characters:value('audiobookCharacters'),
      cost:value('audiobookCost'),
      size:value('audiobookSize'),
      billed:value('audiobookBilled'),
      title:Boolean(document.querySelector('.bs-audiobook-dialog')),
      startEnabled:!button('audiobookStart').disabled,
    };
  })()`)
  assert.equal(estimate.sentences, '3')
  assert.ok(Number(estimate.characters) > 0)
  assert.match(estimate.cost, /^¥/)
  assert.ok(estimate.billed !== '')
  assert.ok(estimate.size !== '')
  assert.equal(estimate.startEnabled, false, 'wait for the existing job state before enabling generation')
  initialJobState.resolve()
  assert.equal(providerCalls.length, 0, 'estimating must not synthesise anything')

  const done = await evaluate(`(async()=>{
    await until(()=>button('audiobookStart') && !button('audiobookStart').disabled);
    button('audiobookStart').click();
    await until(()=>document.querySelector('.bs-audiobook-done'));
    await until(()=>document.querySelector('.bs-audiobook-done a'));
    const link=document.querySelector('.bs-audiobook-done a');
    return { href:link.getAttribute('href'), text:link.textContent, hint:document.querySelector('.bs-audiobook-done .bs-audiobook-hint').textContent };
  })()`)
  assert.equal(done.text, 'audiobookDownload')
  assert.match(done.href, /\/audio\/file$/)
  assert.match(done.hint, /audiobookDone/)
  assert.equal(providerCalls.length, 3)
  assert.ok(providerCalls.every(call => call.url.includes('/tools/tts') && call.body.voice_id === 'stella'))

  const download = await fetch(new URL(done.href, origin))
  assert.equal(download.status, 200)
  const bytes = Buffer.from(await download.arrayBuffer())
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(bytes.readUInt32LE(40), 24 * 2)

  delayEstimate = true
  const switched = await evaluate(`(async()=>{
    const select=document.querySelector('.bs-audiobook-dialog select[aria-label="audiobookProviderLabel"]');
    check(!!select,'provider select');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    setter.call(select,'edge');select.dispatchEvent(new Event('change',{bubbles:true}));
    await until(()=>dialog().textContent.includes('audiobookEstimating'));
    check(button('audiobookReestimate').disabled,'start disabled until new estimate arrives');
    check(value('audiobookCost')===null,'previous price hidden during estimate update');
    await until(()=>document.querySelector('.bs-audiobook-dialog').textContent.includes('audiobookUnpricedHint'));
    await until(()=>!button('audiobookRegenerate').disabled);
    const text=document.querySelector('.bs-audiobook-dialog').textContent;
    return {
      hasCost:text.includes('audiobookCost'),
      hasBilled:text.includes('audiobookBilled'),
      hasUnpriced:text.includes('audiobookUnpricedHint'),
      hasLink:text.includes('audiobookSettingsLink'),
    };
  })()`)
  assert.equal(switched.hasCost, false, 'non-DeepSeek services hide the cost estimate')
  assert.equal(switched.hasBilled, false, 'non-DeepSeek services hide billed characters')
  assert.equal(switched.hasUnpriced, true)
  assert.equal(switched.hasLink, true)
  assert.equal(providerCalls.length, 3, 'switching the service does not synthesise')

  const jumped = await evaluate(`(async()=>{
    [...document.querySelectorAll('.bs-audiobook-dialog button')].find(node=>node.textContent==='audiobookSettingsLink').click();
    await until(()=>document.querySelector('.bs-settings-dialog'));
    const active=document.querySelector('.bs-settings-tab[aria-selected="true"]');
    return {dialogGone:!dialog(), tab:active?active.textContent:null};
  })()`)
  assert.equal(jumped.dialogGone, true)
  assert.equal(jumped.tab, 'settingsTabSpeech')
  await evaluate(`(async()=>{
    document.querySelector('.bs-settings-dialog [aria-label="dismiss"]').click();
    await until(()=>!document.querySelector('.bs-settings-dialog'));
    return true;
  })()`)
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('audiobook dialog: menu entry, estimate, stubbed render and WAV download')
} finally {
  initialJobState.resolve()
  try { socket?.close() } catch {}
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill('SIGKILL')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))])
  }
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  if (process.env.DEEPSEEK_API_KEY === 'test-key') delete process.env.DEEPSEEK_API_KEY
}
