// Functional browser regression for the read-aloud / annotation painting:
// the spoken sentence is a true colour inversion (CSS Custom Highlight API),
// stored annotations paint above it, the plan is rebuilt on sentence, font,
// theme and chapter changes, and a browser without the API keeps the legacy
// marker band instead of failing. No real speech service is contacted.
// Run: node tests/highlights-browser.mjs (needs Chrome and React UMD fixtures).
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-highlights-'))
process.env.DSH_HOME = join(temporary, 'home')
import { applyTestHost as apply } from './helpers/host-context.mjs'
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
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:33333333-3333-4333-8333-333333333333</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test</dc:creator><dc:language>${language}</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`
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
// Fake media: every sentence finishes quickly so the queue advances.
window.__audio=[];window.__audioMs=40;
class FakeAudio {
  constructor(src){ this.onended=null; this.onerror=null; this.playbackRate=1; this._paused=false; this._src=''; this.volume=1; if(typeof src==='string'&&src!=='') this.src=src }
  set src(value){ this._src=String(value); window.__audio.push({type:'src', value:String(value)}) }
  get src(){ return this._src }
  play(){ this._paused=false; window.__audio.push({type:'play', rate:this.playbackRate}); setTimeout(()=>{ if(!this._paused && typeof this.onended==='function') this.onended() }, window.__audioMs); return Promise.resolve() }
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
window.barButton=(label)=>document.querySelector('.bs-tts-dock [aria-label="'+label+'"]');
window.barClick=(label)=>{const node=barButton(label);if(!node)throw Error('missing menu button '+label);node.click()};
window.openBook=async(title)=>{const card=[...document.querySelectorAll('.bs-card')].find(node=>node.querySelector('.bs-book-title')?.textContent===title);check(!!card,'book card '+title);card.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-reader'))};
window.frame=()=>document.querySelector('.bs-epub-frame');
window.frameWindow=()=>{const node=window.frame();return node?node.contentWindow:null};
window.frameDocument=()=>{const node=window.frame();return node?node.contentDocument:null};
window.chapterText=()=>{const doc=window.frameDocument();return doc&&doc.body?doc.body.innerText:''};
window.highlightNames=()=>{const win=window.frameWindow();return win&&win.CSS&&win.CSS.highlights?[...win.CSS.highlights.keys()]:[]};
window.highlightText=(name)=>{const win=window.frameWindow();const item=win&&win.CSS&&win.CSS.highlights?win.CSS.highlights.get(name):null;return item?[...item].map(range=>range.toString()).join(' '):''};
window.highlightPriority=(name)=>{const win=window.frameWindow();const item=win&&win.CSS&&win.CSS.highlights?win.CSS.highlights.get(name):null;return item?item.priority:null};
window.highlightRules=()=>{const doc=window.frameDocument();const style=doc?doc.querySelector('style[data-bb-highlight-styles]'):null;return style?style.textContent:''};
window.normalizedText=(value)=>String(value||'').replace(/\\s+/g,' ').trim();
window.openTts=async()=>{if(!document.querySelector('.bs-tts-dock')){document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click()}await until(()=>document.querySelector('.bs-tts-dock'))};
window.settingsButton=()=>document.querySelector('.bs-reader-bar [aria-label="readingSettings"]');
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

  // A retained light preference from an older release must yield to the host theme.
  const preferenceResponse = await fetch(`${api}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'light' }),
  })
  assert.equal(preferenceResponse.status, 200)

  const epubResponse = await fetch(`${api}/books?name=annotated.epub&title=Annotated&format=epub`, {
    method: 'POST',
    body: epubBytes('Annotated', [
      ['第一句话。第二句话。第三句话。'],
      ['第二章第一句话。第二章第二句话。'],
      ['第三章第一句话。'],
    ]),
  })
  assert.equal(epubResponse.status, 201)
  const bookId = (await epubResponse.json()).book.id
  assert.equal(typeof bookId, 'string')

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

  // — 1. Read-aloud inversion and annotation anchor discovery ————————————
  const anchors = await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-card').length===1);
    await openBook('Annotated');
    await until(()=>chapterText().includes('第二句话'),'chapter one renders');
    await until(()=>frameDocument()?.documentElement.style.getPropertyValue('--bb-fg'),'reader applies its palette to the chapter');
    const doc=frameDocument();
    const rootStyle=doc.documentElement.style;
    check(rootStyle.getPropertyValue('--bb-fg')==='#0f1115','light host foreground: '+rootStyle.getPropertyValue('--bb-fg'));
    check(rootStyle.getPropertyValue('--bb-bg')==='#ffffff','light host background: '+rootStyle.getPropertyValue('--bb-bg'));
    // Annotation anchors are chapter-text offsets: compute them with the same
    // module the reader resolves ranges with.
    const textIndex=await import('/bookshelf/assets/lib/text-index.mjs');
    const flat=textIndex.buildSpeechIndex(doc).flat;
    const second=flat.indexOf('第二句话。');
    const third=flat.indexOf('第三句话。');
    check(second>=0&&third>second,'chapter one contains both quotes: '+flat);
    // Opening read-aloud must paint the inverted sentence before any audio.
    document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click();
    await until(()=>document.querySelector('.bs-tts-dock'),'read-aloud dock opens');
    await until(()=>caption().length>0,'preview caption');
    await until(()=>highlightNames().includes('bb-ra'),'bb-ra highlight registered');
    const preview=normalizedText(caption());
    check(highlightPriority('bb-ra')===0,'read-aloud priority 0: '+highlightPriority('bb-ra'));
    check(normalizedText(highlightText('bb-ra'))===preview,'bb-ra covers the preview sentence: '+highlightText('bb-ra')+' vs '+preview);
    const ruleText=highlightRules();
    check(ruleText.includes('::highlight(bb-ra)'),'bb-ra rule written: '+ruleText);
    check(ruleText.includes('color: #ffffff;'),'inverted ink is palette.bg: '+ruleText);
    check(ruleText.includes('background-color: #0f1115;'),'inverted band is palette.fg: '+ruleText);
    check(window.errors.length===0,'console errors: '+window.errors.join(' | '));
    document.querySelector('.bs-reader-bar [aria-label="back"]').click();
    await until(()=>document.querySelector('.bs-shelf'),'back to the shelf');
    return {second,third};
  })()`)
  assert.ok(Number.isInteger(anchors.second) && anchors.third > anchors.second, 'anchor offsets returned')

  // Store two annotations of the first chapter: a highlight and an underline.
  await new Promise(resolve => setTimeout(resolve, 300))
  const annotationState = await fetch(`${api}/books/${bookId}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      state: {
        progress: { format: 'epub', chapterIndex: 0, scrollRatio: 0, percent: 0, anchor: '', updatedAt: Date.now() },
        annotations: [
          {
            id: 'an_g2hl01', type: 'highlight', chapterIndex: 0,
            start: anchors.second, end: anchors.second + '第二句话。'.length,
            quote: '第二句话。', color: '#ffd23f', strength: 0.35, thickness: 2, underlineStyle: 'solid',
            createdAt: Date.now(), label: '第二句话。',
          },
          {
            id: 'an_g2ul02', type: 'underline', chapterIndex: 0,
            start: anchors.third, end: anchors.third + '第三句话。'.length,
            quote: '第三句话。', color: '#0a84ff', strength: 0.35, thickness: 2, underlineStyle: 'dashed',
            createdAt: Date.now(), label: '第三句话。',
          },
        ],
      },
    }),
  })
  assert.equal(annotationState.status, 200)
  const stored = (await annotationState.json()).state
  assert.equal(stored.annotations.length, 2)

  // — 2. Annotation layers, overlap, rebuilds and chapter clearing ————————
  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-card').length===1);
    await openBook('Annotated');
    await until(()=>chapterText().includes('第二句话'),'chapter one renders');
    // Stored annotations paint as soon as the chapter document is live.
    await until(()=>highlightNames().includes('bb-an-an_g2hl01'),'annotation layer registered');
    check(highlightPriority('bb-an-an_g2hl01')===100,'annotation priority 100: '+highlightPriority('bb-an-an_g2hl01'));
    check(normalizedText(highlightText('bb-an-an_g2hl01'))==='第二句话。','annotation range: '+highlightText('bb-an-an_g2hl01'));
    const highlightRule=highlightRules();
    check(highlightRule.includes('::highlight(bb-an-an_g2hl01)'),'annotation rule: '+highlightRule);
    check(highlightRule.includes('background-color: color-mix(in srgb, #ffd23f 35%, transparent)'),'annotation colour mix: '+highlightRule);
    await until(()=>highlightNames().includes('bb-an-an_g2ul02'),'underline layer registered');
    check(highlightPriority('bb-an-an_g2ul02')===100,'underline priority 100');
    check(highlightRule.includes('text-decoration-line: underline'),'underline rule: '+highlightRule);
    check(highlightRule.includes('text-decoration-style: dashed'),'underline style: '+highlightRule);
    // Read-aloud paints above the page, annotations paint above read-aloud.
    document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click();
    await until(()=>highlightNames().includes('bb-ra'),'bb-ra painted for the preview');
    await until(()=>caption().length>0,'preview caption');
    barClick('ttsNext');
    await until(()=>caption()==='第一句话。','first sentence selected');
    barClick('ttsNext');
    await until(()=>caption()==='第二句话。','second sentence selected');
    await until(()=>normalizedText(highlightText('bb-ra'))==='第二句话。','bb-ra follows the sentence switch: '+highlightText('bb-ra'));
    check(highlightNames().includes('bb-an-an_g2hl01'),'annotated sentence keeps its layer: '+highlightNames().join(','));
    check(highlightPriority('bb-an-an_g2hl01')>highlightPriority('bb-ra'),'annotation covers the read-aloud layer');
    // A font-size change reflows the chapter: both layers must be rebuilt.
    settingsButton().click();
    await until(()=>document.querySelector('.bs-reader-settings'),'settings popover');
    const larger=()=>document.querySelector('.bs-reader-settings [aria-label="fontLarger"]');
    larger().click();
    await wait(120);
    larger().click();
    await until(()=>frameDocument().documentElement.style.getPropertyValue('--bb-font-size')==='21px','font size applied');
    await wait(80);
    check(highlightNames().includes('bb-ra'),'read-aloud layer survives a font change: '+highlightNames().join(','));
    check(normalizedText(highlightText('bb-ra'))==='第二句话。','read-aloud layer still covers the sentence');
    check(highlightNames().includes('bb-an-an_g2hl01'),'annotation layer survives a font change');
    // A theme change must invert with the new palette.
    document.body.setAttribute('data-ds-dark-theme','');
    await until(()=>frameDocument().documentElement.style.getPropertyValue('--bb-scheme')==='dark','dark palette applied');
    await until(()=>highlightRules().includes('color: #151517;'),'dark inversion: '+highlightRules());
    check(highlightRules().includes('background-color: #f9fafb;'),'dark band is the dark palette.fg: '+highlightRules());
    check(highlightRules().includes('background-color: color-mix(in srgb, #ffd23f 35%, transparent)'),'annotation colour survives the theme change');
    document.querySelector('.bs-reader-settings [aria-label="dismiss"]').click();
    await until(()=>!document.querySelector('.bs-reader-settings'),'settings closed');
    // Chapter switch: every layer of the old document is cleared and the new
    // chapter (which has no annotations) starts clean.
    const nextChapter=document.querySelectorAll('.bs-toc-label')[1];
    check(!!nextChapter,'next chapter button');
    nextChapter.click();
    await until(()=>chapterText().includes('第二章第一句话'),'chapter two renders');
    await wait(200);
    check(highlightNames().length===0,'chapter switch clears the highlight registry: '+highlightNames().join(','));
    check(!highlightRules().includes('bb-an-'),'chapter switch clears the annotation rules: '+highlightRules());
    check(window.errors.length===0,'console errors: '+window.errors.join(' | '));
    return true;
  })()`), true)

  // — 3. Overlay fallback when the CSS Custom Highlight API is missing ————
  await fetch(`${api}/books/${bookId}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      state: { progress: { format: 'epub', chapterIndex: 0, scrollRatio: 0, percent: 0, anchor: '', updatedAt: Date.now() } },
    }),
  })
  await navigateTestPage(socket, pageUrl)
  await waitForMount()
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelector('.bs-shelf'));
    await openBook('Annotated');
    await until(()=>chapterText().includes('第一句话'),'chapter one renders');
    const win=frameWindow();
    // Hide the API the way an older browser would expose it.
    let patched=false;
    try{Object.defineProperty(win.CSS,'highlights',{configurable:true,get(){return undefined}});patched=typeof win.CSS.highlights==='undefined'}catch{}
    if(!patched){try{Object.defineProperty(win,'Highlight',{configurable:true,value:undefined});patched=typeof win.Highlight!=='function'}catch{}}
    check(patched,'the highlight API can be hidden for the fallback test');
    document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click();
    await until(()=>document.querySelector('.bs-tts-dock'),'read-aloud dock opens');
    await until(()=>frameDocument().querySelector('[data-bb-glass-band]'),'overlay marker band painted');
    const bands=[...frameDocument().querySelectorAll('[data-bb-glass-band]')];
    check(bands.length>0,'fallback paints the marker band');
    check(bands.every(band=>getComputedStyle(band).position==='fixed'),'fallback band keeps the legacy fixed overlay');
    check(!highlightRules().includes('::highlight'),'fallback writes no CSS highlight rules: '+highlightRules());
    check(window.errors.length===0,'fallback must not log console errors: '+window.errors.join(' | '));
    return true;
  })()`), true)

  console.log('highlights: inverted read-aloud layer, annotation coverage, rebuilds and overlay fallback')
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
