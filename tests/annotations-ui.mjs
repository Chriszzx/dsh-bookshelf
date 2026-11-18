// Functional browser regression for the annotation style panel: the toolbar
// button sits right of the bookmark button, the popover exposes mode / colour /
// strength / thickness / underline style controls with a live preview, the
// defaults come from assets/lib/annotations.mjs, and the chosen style is stored
// in state.settings.annotationStyle so it survives leaving and reopening the
// book. Run: node tests/annotations-ui.mjs (needs Chrome and React UMD fixtures).
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-annotations-ui-'))
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
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:33333333-3333-4333-8333-333333333333</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test</dc:creator><dc:language>en</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`
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
window.api=async(path,options)=>{const response=await fetch('/bookshelf/api'+path,options);return response.json()};
window.stateFor=async(title)=>{const list=await api('/books');const book=list.books.find(item=>item.title===title);check(!!book,'book '+title);const payload=await api('/books/'+book.id+'/state');return {book,state:payload.state||{}}};
window.openBook=async(title)=>{const cards=[...document.querySelectorAll('.bs-card')];const card=cards.find(node=>node.querySelector('.bs-book-title')?.textContent===title);check(!!card,'book card '+title);card.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-reader')&&document.querySelector('.bs-epub-frame'))};
window.closeReader=async()=>{document.querySelector('.bs-reader-bar [aria-label="back"]').click();await until(()=>document.querySelector('.bs-shelf')&&!document.querySelector('.bs-reader'))};
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

  const epubResponse = await fetch(`${api}/books?name=annotations-ui.epub&title=Annotations&format=epub`, {
    method: 'POST',
    body: epubBytes('Annotations', [
      ['The first chapter carries a selection to annotate.', 'A second paragraph keeps the chapter readable.'],
      ['The second chapter stays untouched by the style panel.'],
    ]),
  })
  assert.equal(epubResponse.status, 201)

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

  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-card').length===1);
    await openBook('Annotations');
    await until(()=>{
      const button=document.querySelector('.bs-reader-bar [aria-label="annotationStyle"]');
      return !!button&&!button.disabled;
    });
    // The marker button is the bookmark button's right-hand neighbour.
    const controls=[...document.querySelectorAll('.bs-reader-controls .bs-icon-button')];
    const bookmarkIndex=controls.findIndex(node=>{
      const label=node.getAttribute('aria-label');
      return label==='addBookmark'||label==='removeBookmark';
    });
    const annotationIndex=controls.findIndex(node=>node.getAttribute('aria-label')==='annotationStyle');
    check(bookmarkIndex>=0,'bookmark button present');
    check(annotationIndex===bookmarkIndex+1,'annotation button is right of the bookmark button: '+bookmarkIndex+'/'+annotationIndex);
    // Defaults must come from assets/lib/annotations.mjs, not a local copy.
    const annotationsModule=await import('/bookshelf/assets/lib/annotations.mjs');
    const defaults=annotationsModule.DEFAULT_ANNOTATION_STYLE;
    document.querySelector('.bs-reader-bar [aria-label="annotationStyle"]').click();
    await until(()=>document.querySelector('.bs-annotation-menu'));
    const menu=document.querySelector('.bs-annotation-menu');
    check(menu.getAttribute('role')==='dialog','annotation menu role');
    check(menu.getAttribute('aria-label')==='annotationStyle','annotation menu label');
    check(!!document.querySelector('.bs-popover-backdrop'),'popover backdrop');
    const pressed=(selector)=>[...document.querySelectorAll(selector)].find(node=>node.getAttribute('aria-pressed')==='true');
    const tabs=()=>[...document.querySelectorAll('.bs-annotation-tab')];
    check(tabs().length===2,'two annotation categories: '+tabs().map(node=>node.textContent).join('|'));
    check(tabs().find(node=>node.getAttribute('aria-selected')==='true').textContent==='annotationHighlight','default category is highlight');
    const colorInput=document.querySelector('.bs-annotation-color-input');
    check(colorInput.getAttribute('type')==='color','colour picker is input[type=color]');
    check(colorInput.value.toLowerCase()===defaults.color,'default colour from the module: '+colorInput.value+' vs '+defaults.color);
    check(Number(document.querySelector('.bs-annotation-strength').value)===Math.round(defaults.strength*100),'default strength');
    check(!document.querySelector('.bs-annotation-thickness'),'highlight category hides underline thickness');
    check(!document.querySelector('.bs-annotation-underline-options'),'highlight category hides underline styles');
    check(document.querySelector('.bs-annotation-hue').getAttribute('type')==='range','hue is a range input');
    check(document.querySelector('.bs-annotation-preview').textContent.startsWith('Lorem ipsum dolor sit amet'),'live preview specimen');
    const specimenStyle=getComputedStyle(document.querySelector('.bs-annotation-preview'));
    check(specimenStyle.fontSize==='19px','preview follows the reading font size: '+specimenStyle.fontSize);
    check(specimenStyle.fontFamily.includes('serif'),'preview follows the reading font family: '+specimenStyle.fontFamily);
    // The preview is exclusive: highlight mode paints a background and never an
    // underline.
    const highlightPreview=getComputedStyle(document.querySelector('.bs-annotation-preview'));
    check(highlightPreview.textDecorationLine==='none','highlight preview has no underline: '+highlightPreview.textDecorationLine);
    check(highlightPreview.backgroundColor!=='rgba(0, 0, 0, 0)','highlight preview shows its tint: '+highlightPreview.backgroundColor);
    // Underline is its own category with only its own sub-options.
    tabs().find(node=>node.textContent==='annotationUnderline').click();
    await until(()=>document.querySelector('.bs-annotation-preview').getAttribute('data-mode')==='underline');
    check(!document.querySelector('.bs-annotation-strength'),'underline category hides highlight strength');
    check(Number(document.querySelector('.bs-annotation-thickness').value)===defaults.thickness,'default thickness');
    check(pressed('.bs-annotation-underline-options .bs-segment').textContent==='underlineSolid','default underline style');
    setValue(colorInput,'#112233');
    setValue(document.querySelector('.bs-annotation-thickness'),'4');
    [...document.querySelectorAll('.bs-annotation-underline-options .bs-segment')].find(node=>node.textContent==='underlineWavy').click();
    await wait(120);
    const preview=getComputedStyle(document.querySelector('.bs-annotation-preview'));
    check(preview.textDecorationStyle==='wavy','preview underline style: '+preview.textDecorationStyle);
    check(preview.textDecorationColor==='rgb(17, 34, 51)','preview colour: '+preview.textDecorationColor);
    check(preview.textDecorationThickness==='4px','preview thickness: '+preview.textDecorationThickness);
    check(preview.backgroundColor==='rgba(0, 0, 0, 0)','underline preview must not paint a highlight background: '+preview.backgroundColor);
    // Back to the highlight category: its own sub-options return and strength
    // changes do not leak into the underline preview.
    tabs().find(node=>node.textContent==='annotationHighlight').click();
    await until(()=>document.querySelector('.bs-annotation-preview').getAttribute('data-mode')==='highlight');
    setValue(document.querySelector('.bs-annotation-strength'),'50');
    await wait(120);
    // Persisted in state.settings.annotationStyle through the Host sanitizer.
    await untilAsync(async()=>{
      const {state}=await stateFor('Annotations');
      const saved=state.settings&&state.settings.annotationStyle;
      return saved&&saved.mode==='highlight'&&saved.color==='#112233'&&saved.strength===0.5&&saved.thickness===4&&saved.underlineStyle==='wavy';
    });
    // The style is per book: leaving and reopening the reader restores it.
    document.querySelector('.bs-annotation-menu [aria-label="dismiss"]').click();
    await until(()=>!document.querySelector('.bs-annotation-menu'));
    await closeReader();
    await openBook('Annotations');
    await until(()=>{
      const button=document.querySelector('.bs-reader-bar [aria-label="annotationStyle"]');
      return !!button&&!button.disabled;
    });
    document.querySelector('.bs-reader-bar [aria-label="annotationStyle"]').click();
    await until(()=>document.querySelector('.bs-annotation-menu'));
    check(document.querySelector('.bs-annotation-preview').getAttribute('data-mode')==='highlight','saved category is restored');
    check(document.querySelector('.bs-annotation-color-input').value.toLowerCase()==='#112233','saved colour is restored: '+document.querySelector('.bs-annotation-color-input').value);
    check(Number(document.querySelector('.bs-annotation-strength').value)===50,'saved strength is restored');
    [...document.querySelectorAll('.bs-annotation-tab')].find(node=>node.textContent==='annotationUnderline').click();
    await until(()=>document.querySelector('.bs-annotation-preview').getAttribute('data-mode')==='underline');
    check(Number(document.querySelector('.bs-annotation-thickness').value)===4,'saved thickness is restored');
    check(pressed('.bs-annotation-underline-options .bs-segment').textContent==='underlineWavy','saved underline style is restored');
    // Escape closes the popover without leaving the book.
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await until(()=>!document.querySelector('.bs-annotation-menu'));
    check(!!document.querySelector('.bs-reader'),'Escape keeps the reader open');
    // The hue strip is a rainbow range that produces a legal hex colour.
    document.querySelector('.bs-reader-bar [aria-label="annotationStyle"]').click();
    await until(()=>document.querySelector('.bs-annotation-menu'));
    setValue(document.querySelector('.bs-annotation-hue'),'120');
    await wait(120);
    const hueColor=document.querySelector('.bs-annotation-color-input').value;
    check(/^#[0-9a-f]{6}$/i.test(hueColor),'hue slider produced a hex colour: '+hueColor);
    await untilAsync(async()=>{
      const {state}=await stateFor('Annotations');
      return state.settings&&state.settings.annotationStyle&&state.settings.annotationStyle.color===hueColor;
    });
    return true;
  })()`), true)

  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('annotation style panel: toolbar button, live preview, defaults, persistence and Escape')
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
