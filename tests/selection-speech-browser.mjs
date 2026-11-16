// Functional browser regression for "read selected text": the selection is cut
// into its own uncached sentence queue, a scratch audio URL that has expired is
// synthesized once more, and when the queue ends continuous read-aloud resumes
// at the chapter sentence containing the selection end (that sentence is read
// again). No real speech service is contacted.
// Run: node tests/selection-speech-browser.mjs (needs Chrome and React UMD fixtures).
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-selection-speech-'))
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
let route, chrome, socket, server

function makeRun() {
  return async (command, args) => {
    if (args[0] === '-v' && args[1] === '?') {
      return { stdout: 'Tingting (中文（中国大陆）)     zh_CN    # 你好！我叫婷婷。\nSamantha (English (US))  en_US  # Hello.\n' }
    }
    const out = args[args.indexOf('-o') + 1]
    if (typeof out === 'string' && out.endsWith('.wav')) {
      await (await import('node:fs/promises')).writeFile(out, Buffer.from('RIFFmockwav'))
    }
    return { stdout: '' }
  }
}

apply(
  {
    effect: fn => fn(),
    webServer: { register(value) { route = value; return () => {} } },
    logger: { info() {}, warn() {}, error() {} },
  },
  { tts: { platform: 'darwin', run: makeRun() } },
)

function epubBytes(title, chapters, language = 'zh') {
  const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  const manifest = chapters.map((_, index) => `<item id="ch${index}" href="ch${index}.xhtml" media-type="application/xhtml+xml"/>`).join('')
  const spine = chapters.map((_, index) => `<itemref idref="ch${index}"/>`).join('')
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:44444444-4444-4444-8444-444444444444</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test</dc:creator><dc:language>${language}</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`
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
// Record every synthesis request so the suite can prove which queue was uncached.
window.__synth=[];
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
  try{
    const url=typeof input==='string'?input:(input&&input.url)||'';
    if(url.includes('/tts/synthesize')&&init&&String(init.method||'').toUpperCase()==='POST'){
      let body=null;
      try{body=JSON.parse(init.body)}catch{}
      if(body&&typeof body.text==='string')window.__synth.push(body);
    }
  }catch{}
  return nativeFetch(input,init);
};
// Fake media: a one-shot error simulates a scratch URL that expired (404).
window.__audio=[];window.__audioMs=40;window.__failNextSrc=false;
class FakeAudio {
  constructor(src){ this.onended=null; this.onerror=null; this.playbackRate=1; this._paused=false; this._src=''; this.volume=1; this._failed=false; if(typeof src==='string'&&src!=='') this.src=src }
  set src(value){
    this._src=String(value); window.__audio.push({type:'src', value:String(value)});
    if(window.__failNextSrc&&!String(value).startsWith('data:')){
      window.__failNextSrc=false; this._failed=true;
      setTimeout(()=>{ this._failed=false; if(typeof this.onerror==='function') this.onerror(new Event('error')) },6);
    }
  }
  get src(){ return this._src }
  play(){ this._paused=false; window.__audio.push({type:'play', rate:this.playbackRate}); if(this._failed) return Promise.resolve(); setTimeout(()=>{ if(!this._paused && typeof this.onended==='function') this.onended() }, window.__audioMs); return Promise.resolve() }
  pause(){ this._paused=true; window.__audio.push({type:'pause'}) }
}
window.Audio = FakeAudio;
const regs=[];
const plugin=definition.factory(id=>{if(id==='react')return React;throw Error(id)});
plugin.apply({effect:fn=>fn(),locale:{register(){return()=>{}},bind(){return t}},slots:{inject(k,fn){fn()},register(o,C){regs.push({o,C});return()=>{}}}});
const Panel=regs.find(r=>r.o.name==='main').C;
const root=ReactDOM.createRoot(document.getElementById('root'));
window.mount=()=>ReactDOM.flushSync(()=>root.render(React.createElement(Panel,{t})));
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.until=async(fn,label)=>{const start=Date.now();while(Date.now()-start<30000){if(fn())return;await wait(40)}throw Error('Timed out: '+(label||fn))};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.caption=()=>document.querySelector('.bs-tts-caption-text')?.textContent||'';
window.openBook=async(title)=>{const card=[...document.querySelectorAll('.bs-card')].find(node=>node.querySelector('.bs-book-title')?.textContent===title);check(!!card,'book card '+title);card.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-reader'))};
window.frame=()=>document.querySelector('.bs-epub-frame');
window.frameWindow=()=>{const node=window.frame();return node?node.contentWindow:null};
window.frameDocument=()=>{const node=window.frame();return node?node.contentDocument:null};
window.chapterText=()=>{const doc=window.frameDocument();return doc&&doc.body?doc.body.innerText:''};
window.openTts=async()=>{if(!document.querySelector('.bs-tts-dock')){document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click()}await until(()=>document.querySelector('.bs-tts-dock'))};
window.mount();
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

  const preferenceResponse = await fetch(`${api}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'light', pageMode: 'scroll' }),
  })
  assert.equal(preferenceResponse.status, 200)

  const epubResponse = await fetch(`${api}/books?name=selection.epub&title=Selection&format=epub`, {
    method: 'POST',
    body: epubBytes('Selection', [
      ['第一章第一句话。第一章第二句话。'],
      ['第二章第一句话。第二章第二句话。第二章第三句话。第二章第四句话。'],
    ]),
  })
  assert.equal(epubResponse.status, 201)
  assert.equal(typeof (await epubResponse.json()).book.id, 'string')

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
  const pageUrl = `${origin}/test.html`
  await navigateTestPage(socket, pageUrl)
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

  const outcome = await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-card').length===1);
    await openBook('Selection');
    await until(()=>chapterText().includes('第一章第一句话'),'chapter one renders');
    document.querySelector('button[title="nextChapter"]').click();
    await until(()=>chapterText().includes('第二章第一句话'),'chapter two renders');
    // Opening read-aloud arms a driver (preview) without playing anything; the
    // selection queue must resume through that driver afterwards.
    await openTts();
    await until(()=>caption().length>0,'preview caption');
    window.__chapterBefore=document.querySelector('.bs-reader-sub').textContent;
    // Select the second and third sentence of chapter two.
    const doc=frameDocument();
    const win=frameWindow();
    const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);
    let node=null;
    while((node=walker.nextNode())){ if((node.nodeValue||'').includes('第二章第二句话。第二章第三句话。')) break }
    check(!!node,'chapter two text present');
    const start=node.nodeValue.indexOf('第二章第二句话。');
    const end=node.nodeValue.indexOf('第二章第四句话。');
    check(start>=0&&end>start,'selection offsets');
    const range=doc.createRange();
    range.setStart(node,start);
    range.setEnd(node,end);
    const selection=win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const event=new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20});
    node.parentElement.dispatchEvent(event);
    await until(()=>document.querySelector('.bs-selection-menu'),'selection menu');
    const speak=[...document.querySelectorAll('.bs-selection-menu .bs-selection-item')].find(entry=>entry.textContent==='selectionSpeak');
    check(!!speak,'selection speak item');
    window.__caps=[];
    const poll=setInterval(()=>{const value=caption();if(value&&window.__caps[window.__caps.length-1]!==value)window.__caps.push(value)},12);
    // The first selection clip fails once, as an expired scratch URL would.
    window.__failNextSrc=true;
    speak.click();
    await until(()=>window.__synth.some(body=>body.cache===false&&body.text==='第二章第三句话。'),'selection audio is synthesized without cache');
    await until(()=>window.__synth.filter(body=>body.cache===false&&body.text==='第二章第二句话。').length>=2,'expired scratch audio is synthesized once more');
    await until(()=>caption()==='第二章第四句话。','continuous read-aloud continues past the selection');
    clearInterval(poll);
    const caps=window.__caps.slice();
    const uncached=[...new Set(window.__synth.filter(body=>body.cache===false).map(body=>body.text))];
    check(uncached.length===2&&uncached.includes('第二章第二句话。')&&uncached.includes('第二章第三句话。'),'only the selection is uncached: '+uncached.join('|'));
    check(window.__synth.filter(body=>body.cache!==false&&body.text==='第二章第三句话。').length>=1,'the selection end sentence is read again through the normal cache: '+JSON.stringify(window.__synth));
    check(window.__synth.filter(body=>body.cache!==false&&body.text==='第二章第四句话。').length>=1,'reading continues into the next sentence: '+JSON.stringify(window.__synth));
    check(!window.__synth.some(body=>body.text==='第一章第一句话。'),'the selection queue never leaves its chapter');
    for(const expected of ['第二章第二句话。','第二章第三句话。','第二章第四句话。']){
      check(caps.includes(expected),'missing caption '+expected+': '+caps.join(','));
    }
    check(caps.indexOf('第二章第三句话。')<caps.indexOf('第二章第四句话。'),'caption order: '+caps.join(','));
    check(!caps.includes('第二章第一句话。'),'resume starts at the selection end, not the page top: '+caps.join(','));
    check(document.querySelector('.bs-reader-sub').textContent===window.__chapterBefore,'reading a selection must not follow the page');
    check(window.errors.length===0,'console errors: '+window.errors.join(' | '));
    return {caps,uncached};
  })()`)
  assert.ok(outcome && Array.isArray(outcome.caps), 'evaluation outcome returned')
  assert.deepEqual(outcome.uncached.sort(), ['第二章第三句话。', '第二章第二句话。'].sort())

  console.log('selection speech: uncached queue, scratch retry and read-aloud relocation')
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
