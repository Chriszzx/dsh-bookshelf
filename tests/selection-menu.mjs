// Functional browser regression for the reader selection context menu: the menu
// offers copy / copy-with-source / read-selection plus highlight and underline
// (no select-all), creates annotations through assets/lib/annotations.mjs with
// the current style, replaces an annotation of the same type on the same anchor
// instead of stacking duplicates, keeps the two types independent, and disables
// the annotation actions when the selection cannot be anchored.
// Run: node tests/selection-menu.mjs (needs Chrome and React UMD fixtures).
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-selection-menu-'))
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
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
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:55555555-5555-4555-8555-555555555555</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test</dc:creator><dc:language>en</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`
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
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<15000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.untilAsync=async(fn)=>{const start=Date.now();while(Date.now()-start<15000){if(await fn())return;await wait(80)}throw Error('Timed out: '+fn)};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.api=async(path,options)=>{const response=await fetch('/bookshelf/api'+path,options);return response.json()};
window.stateFor=async(title)=>{const list=await api('/books');const book=list.books.find(item=>item.title===title);check(!!book,'book '+title);const payload=await api('/books/'+book.id+'/state');return {book,state:payload.state||{}}};
window.openBook=async(title)=>{const cards=[...document.querySelectorAll('.bs-card')];const card=cards.find(node=>node.querySelector('.bs-book-title')?.textContent===title);check(!!card,'book card '+title);card.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-reader')&&document.querySelector('.bs-epub-frame'))};
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

  const epubResponse = await fetch(`${api}/books?name=selection-menu.epub&title=Selection&format=epub`, {
    method: 'POST',
    body: epubBytes('Selection', [
      ['Alpha bravo charlie delta echo.', 'Second paragraph foxtrot golf.'],
    ]),
  })
  assert.equal(epubResponse.status, 201)
  const book = (await epubResponse.json()).book

  // The style created by the selection menu is the stored per-book style.
  const styleResponse = await fetch(`${api}/books/${book.id}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      settings: {
        annotationStyle: { mode: 'underline', color: '#112233', strength: 0.5, thickness: 4, underlineStyle: 'wavy' },
      },
    }),
  })
  assert.equal(styleResponse.status, 200)

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
    await openBook('Selection');
    await until(()=>{
      const frame=document.querySelector('.bs-epub-frame');
      const doc=frame&&frame.contentDocument;
      return doc&&doc.body&&(doc.body.innerText||'').includes('Alpha bravo');
    });
    // onFrameLoad paints the frame before it binds the selection listener; wait
    // for the painted marker so a right click cannot race the binding.
    await until(()=>{
      const frame=document.querySelector('.bs-epub-frame');
      const doc=frame&&frame.contentDocument;
      return doc&&doc.documentElement&&doc.documentElement.style.getPropertyValue('--bb-font-size')!=='';
    });
    const SENTENCE='charlie delta echo.';
    const SECOND='foxtrot golf.';
    const current=()=>{
      const frame=document.querySelector('.bs-epub-frame');
      check(!!frame,'reader frame present');
      return {frame,document:frame.contentDocument,window:frame.contentWindow};
    };
    const selectText=(text)=>{
      const targets=current();
      const walker=targets.document.createTreeWalker(targets.document.body,NodeFilter.SHOW_TEXT);
      let node=null;
      while((node=walker.nextNode())){ if((node.nodeValue||'').includes(text)) break }
      check(!!node,'chapter text present: '+text);
      const offset=node.nodeValue.indexOf(text);
      const range=targets.document.createRange();
      range.setStart(node,offset);
      range.setEnd(node,offset+text.length);
      const selection=targets.window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return {node,range,window:targets.window};
    };
    const openMenu=()=>{
      const target=selectText(SENTENCE);
      const box=target.range.getBoundingClientRect();
      const event=new target.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+4,clientY:box.top+4});
      target.node.parentElement.dispatchEvent(event);
      return event;
    };
    const items=()=>[...document.querySelectorAll('.bs-selection-menu .bs-selection-item')];
    const item=(label)=>items().find(node=>node.textContent===label);
    const clickItem=(label)=>{
      const node=item(label);
      check(!!node,'menu item '+label+': '+items().map(entry=>entry.textContent).join('|'));
      node.click();
    };
    // The reader owns the selection menu and offers the new annotation actions.
    const event=openMenu();
    check(event.defaultPrevented===true,'the reader owns the selection menu');
    await until(()=>document.querySelector('.bs-selection-menu'));
    check(items().map(node=>node.textContent).join(',')==='selectionCopy,selectionCopyCite,selectionSpeak,selectionHighlight,selectionUnderline','menu items: '+items().map(node=>node.textContent).join(','));
    check(!item('selectionSelectAll'),'select-all chapter item removed');
    // The menu must open where the pointer was, not at the sentence box.
    const frameRect=document.querySelector('.bs-epub-frame').getBoundingClientRect();
    const menuRect=document.querySelector('.bs-selection-menu').getBoundingClientRect();
    check(Math.abs(menuRect.left-(frameRect.left+event.clientX))<=1.5,'menu x follows the pointer: '+menuRect.left+' vs '+(frameRect.left+event.clientX));
    check(Math.abs(menuRect.top-(frameRect.top+event.clientY))<=1.5,'menu y follows the pointer: '+menuRect.top+' vs '+(frameRect.top+event.clientY));
    check(item('selectionHighlight').disabled===false,'highlight action enabled');
    check(item('selectionUnderline').disabled===false,'underline action enabled');
    // Highlight: created through fromSelection with the current style.
    clickItem('selectionHighlight');
    await untilAsync(async()=>{
      const {state}=await stateFor('Selection');
      return Array.isArray(state.annotations)&&state.annotations.length===1;
    });
    const first=(await stateFor('Selection')).state.annotations[0];
    check(first.type==='highlight','created annotation type: '+first.type);
    check(first.chapterIndex===0,'annotation chapter: '+first.chapterIndex);
    check(Number.isInteger(first.start)&&Number.isInteger(first.end)&&first.end>first.start,'annotation offsets: '+first.start+'-'+first.end);
    check(first.quote===SENTENCE,'annotation quote: '+first.quote);
    check(first.color==='#112233','annotation colour from state.settings.annotationStyle: '+first.color);
    check(first.strength===0.5,'annotation strength: '+first.strength);
    check(first.thickness===4,'annotation thickness: '+first.thickness);
    check(first.underlineStyle==='wavy','annotation underline style: '+first.underlineStyle);
    check(first.prefix.includes('Alpha bravo'),'annotation prefix context: '+first.prefix);
    check(first.label===SENTENCE,'annotation label: '+first.label);
    check(!document.querySelector('.bs-selection-menu'),'menu closes after the action');
    // The same anchor replaces the previous annotation instead of stacking.
    openMenu();
    await until(()=>document.querySelector('.bs-selection-menu'));
    clickItem('selectionHighlight');
    await untilAsync(async()=>{
      const {state}=await stateFor('Selection');
      return state.annotations.length===1&&state.annotations[0].id!==first.id;
    });
    const replaced=(await stateFor('Selection')).state.annotations;
    check(replaced[0].quote===SENTENCE,'replacement keeps the anchor quote');
    // A different type on the same span is a different anchor key, so it stacks.
    openMenu();
    await until(()=>document.querySelector('.bs-selection-menu'));
    clickItem('selectionUnderline');
    await untilAsync(async()=>{
      const {state}=await stateFor('Selection');
      return state.annotations.length===2;
    });
    const underlined=(await stateFor('Selection')).state.annotations.find(annotation=>annotation.type==='underline');
    check(!!underlined,'underline annotation created');
    check(underlined.quote===SENTENCE,'underline keeps the same span');
    check(underlined.color==='#112233'&&underlined.thickness===4&&underlined.underlineStyle==='wavy','underline uses the stored style: '+JSON.stringify(underlined));
    // A live selection that is not part of the chapter text cannot be anchored:
    // the menu still opens, but both annotation actions are disabled and inert.
    // The frame head's style text is outside the indexed chapter body.
    const unanchorable=()=>{
      const targets=current();
      const style=targets.document.head.querySelector('style');
      check(!!style&&!!style.firstChild,'frame style element present');
      const walker=targets.document.createTreeWalker(targets.document.body,NodeFilter.SHOW_TEXT);
      const bodyText=walker.nextNode();
      check(!!bodyText,'chapter text node present');
      const range=targets.document.createRange();
      range.setStart(style.firstChild,0);
      range.setEnd(bodyText,Math.min(10,bodyText.nodeValue.length));
      const selection=targets.window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const contextmenu=new targets.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true});
      style.dispatchEvent(contextmenu);
      return contextmenu;
    };
    const blocked=unanchorable();
    check(blocked.defaultPrevented===true,'menu opens for a live selection with text');
    await until(()=>document.querySelector('.bs-selection-menu'));
    check(item('selectionHighlight').disabled===true,'highlight disabled without an anchor');
    check(item('selectionUnderline').disabled===true,'underline disabled without an anchor');
    item('selectionHighlight').click();
    await wait(300);
    check((await stateFor('Selection')).state.annotations.length===2,'disabled action must not create an annotation');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await until(()=>!document.querySelector('.bs-selection-menu'));
    // Copy still owns the plain clipboard path next to the annotation actions.
    window.__clipped=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__clipped.push(text)}}});
    openMenu();
    await until(()=>document.querySelector('.bs-selection-menu'));
    clickItem('selectionCopy');
    await untilAsync(async()=>window.__clipped.length>0);
    check(window.__clipped[0]===SENTENCE,'copy keeps the selection: '+window.__clipped[0]);
    await until(()=>!document.querySelector('.bs-selection-menu'));
    // A plain right click with no selection still lets the desktop menu through.
    const cleared=current();
    const rest=cleared.window.getSelection();
    if(rest)rest.removeAllRanges();
    const plain=new cleared.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true});
    cleared.document.body.dispatchEvent(plain);
    await wait(200);
    check(!document.querySelector('.bs-selection-menu'),'no menu without a selection');
    check(plain.defaultPrevented===false,'plain right-click keeps the desktop menu');
    return true;
  })()`), true)

  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('selection menu: items, anchor creation, same-anchor replace, style, disabled fallback and copy')
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
