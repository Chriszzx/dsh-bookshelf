// Reader integration for pre-rendered whole-book audio: the read-aloud menu
// offers the generated WAV, asks for confirmation, then plays the file instead
// of synthesising sentences. The provider stays injected.
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-audiobook-playback-'))
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
    'book.opf': strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">playback-book</dc:identifier><dc:title>${title}</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>`),
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
const t=(key,p)=>key+(p?'('+Object.entries(p).map(([k,v])=>k+'='+v).join(',')+')':'');
window.__audios=[];window.__plays=0;
class FakeAudio {
  constructor(src){
    this._src='';this.paused=true;this.currentTime=0;this.duration=12;this.listeners={};
    window.__audios.push(this);
    if(typeof src==='string'&&src!=='')this.src=src;
  }
  addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn)}
  removeEventListener(){}
  set src(value){this._src=String(value)}
  get src(){return this._src}
  play(){this.paused=false;window.__plays+=1;(this.listeners.playing||[]).forEach(fn=>fn());return Promise.resolve()}
  pause(){if(!this.paused){this.paused=true;(this.listeners.pause||[]).forEach(fn=>fn())}}
  removeAttribute(){}
  load(){}
}
window.Audio=FakeAudio;
const regs=[];
const plugin=definition.factory(id=>{if(id==='react')return React;throw Error(id)});
plugin.apply({effect:fn=>fn(),locale:{register(){return()=>{}},bind(){return t}},slots:{inject(k,fn){fn()},register(o,C){regs.push({o,C});return()=>{}}}});
const Panel=regs.find(r=>r.o.name==='main').C;
const root=ReactDOM.createRoot(document.getElementById('root'));
window.mount=()=>ReactDOM.flushSync(()=>root.render(React.createElement(Panel,{t})));
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<20000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.readerButton=(label)=>document.querySelector('.bs-reader-bar [aria-label="'+label+'"]');
window.menuButton=(label)=>[...document.querySelectorAll('.bs-tts-dock button')].find(node=>node.textContent===label);
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
  const imported = await fetch(`${api}/books?name=playback.epub&title=Playback&format=epub`, { method: 'POST', body: tinyEpub('Playback') })
  assert.equal(imported.status, 201)
  const book = (await imported.json()).book

  // Pre-render the tiny book once; the reader then plays this file.
  const planned = await fetch(`${api}/books/${book.id}/audio/plan`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '第一句话。第二句话。第三句话。', voice: 'stella', speed: 1 }),
  })
  const started = await fetch(`${api}/books/${book.id}/audio/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ planId: (await planned.json()).plan.id }),
  })
  assert.equal(started.status, 200)
  let state
  for (let attempt = 0; attempt < 200; attempt += 1) {
    state = (await (await fetch(`${api}/books/${book.id}/audio`)).json()).state
    if (state.status === 'done' || state.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.equal(state.status, 'done', state.error)
  const synthesized = providerCalls.length

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
    try { if (await evaluate('Boolean(window.mount && document.querySelector(".bs-cover"))')) break } catch (error) {
      if (!error.message.includes('Execution context was destroyed')) throw error
    }
    assert.ok(Date.now() - startup < 10000, 'test page initialized')
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const filePlay = await evaluate(`(async()=>{
    document.querySelector('.bs-cover').click();
    await until(()=>document.querySelector('.bs-epub-frame'));
    readerButton('readAloud').click();
    await until(()=>document.querySelector('.bs-tts-dock'));
    await until(()=>[...document.querySelectorAll('.bs-tts-panels button')].some(node=>node.textContent.startsWith('audiobookUseExisting')));
    const entry=[...document.querySelectorAll('.bs-tts-panels button')].find(node=>node.textContent.startsWith('audiobookUseExisting'));
    entry.click();
    await until(()=>document.body.textContent.includes('audiobookUseConfirm('));
    const confirm=[...document.querySelectorAll('.bs-tts-panels button')].find(node=>node.textContent==='audiobookUseConfirmAction');
    check(!!confirm,'confirmation action');
    confirm.click();
    await until(()=>window.__audios.length>0&&window.__audios[0]._src!=='');
    await wait(150);
    return {src:window.__audios[0]._src,paused:window.__audios[0].paused,plays:window.__plays};
  })()`)
  assert.match(filePlay.src, /\/books\/.+\/audio\/file$/)
  assert.equal(filePlay.plays, 1)
  assert.equal(filePlay.paused, false)
  assert.equal(providerCalls.length, synthesized, 'playing the file must not synthesise')

  const liveSwitch = await evaluate(`(async()=>{
    window.__audioMs=60000;
    const live=document.querySelector('.bs-tts-dock [aria-label="ttsPlay"]');
    check(!!live,'live play button');
    live.click();
    await until(()=>window.__audios.length>1);
    await wait(150);
    return {filePaused:window.__audios[0].paused,audios:window.__audios.length};
  })()`)
  assert.equal(liveSwitch.filePaused, true, 'live read-aloud stops the file')
  assert.ok(liveSwitch.audios > 1, 'live read-aloud starts its own sentence audio')

  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('audiobook playback: confirmation, file playback and live read-aloud switch')
} finally {
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
