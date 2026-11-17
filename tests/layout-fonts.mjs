// Real Host/Client functional regression in an owned browser profile. Font-access
// responses are controlled fixtures; no personal font permission is granted.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { prepareBrowserEnvironment, browserLaunchArgs, navigateTestPage } from './helpers/browser-env.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-layout-fonts-'))
const owned = await realpath(temporary)
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(new URL('../index.js', import.meta.url))
let route, chrome, socket, server
apply({ effect: fn => fn(), webServer: { register(value) { route = value; return () => {} } }, logger: { info() {}, warn() {}, error() {} } })
const page = `<!doctype html><html data-platform="win32" data-windows-titlebar style="--dsh-frame-top-clearance:36px"><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;font:14px Arial}#root{width:1600px;height:900px}</style></head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load(d){window.definition=d}};</script><script src="/client.js"></script><script>
window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const originalError=console.error;console.error=(...a)=>{errors.push(a.map(String).join(' '));originalError(...a)};
const t=(key,p)=>key+(p?'('+Object.entries(p).map(([k,v])=>k+'='+v).join(',')+')':'');
const regs=[];definition.factory(id=>{if(id==='react')return React;throw Error(id)}).apply({effect:fn=>fn(),locale:{register(){return()=>{}},bind(){return t}},slots:{inject(k,fn){fn()},register(o,C){regs.push({o,C});return()=>{}}}});
const Panel=regs.find(r=>r.o.name==='main').C;const root=ReactDOM.createRoot(document.getElementById('root'));root.render(React.createElement(Panel,{t}));
window.wait=ms=>new Promise(r=>setTimeout(r,ms));window.until=async fn=>{const s=Date.now();while(Date.now()-s<12000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.click=title=>{const b=document.querySelector('button[title="'+title+'"]');if(!b)throw Error('missing '+title);ReactDOM.flushSync(()=>b.click())};
window.choose=(label,value)=>{const s=document.querySelector('select[aria-label="'+label+'"]');if(!s)throw Error('missing '+label);if(![...s.options].some(o=>o.value===String(value)))throw Error('missing option '+value+' for '+label);s.value=String(value);ReactDOM.flushSync(()=>s.dispatchEvent(new Event('change',{bubbles:true})))};
window.nativeFontBlob=(weight,italic,variable)=>{
 const tables=variable?2:1,os=12+tables*16,fvar=os+64,b=new ArrayBuffer(fvar+(variable?36:0)),v=new DataView(b),tag=(p,s)=>{for(let i=0;i<4;i++)v.setUint8(p+i,s.charCodeAt(i))};
 v.setUint32(0,65536);v.setUint16(4,tables);tag(12,'OS/2');v.setUint32(20,os);v.setUint32(24,64);v.setUint16(os+4,weight);v.setUint16(os+62,italic?1:0);
 if(variable){tag(28,'fvar');v.setUint32(36,fvar);v.setUint32(40,36);v.setUint16(fvar,1);v.setUint16(fvar+4,16);v.setUint16(fvar+8,1);v.setUint16(fvar+10,20);tag(fvar+16,'wght');v.setInt32(fvar+20,200*65536);v.setInt32(fvar+24,400*65536);v.setInt32(fvar+28,900*65536)}
 return new Blob([b]);
};
window.scanMode='success';window.scanCalls=0;
window.queryLocalFonts=async()=>{
 if(!navigator.userActivation.isActive)throw Error('font access lost user gesture');scanCalls++;
 if(scanMode==='denied')throw new DOMException('test permission denied','NotAllowedError');
 return [['Georgia','Regular',400,false,false],['Georgia','Bold',700,false,false],['Georgia','Italic',400,true,false],['Georgia','Bold Italic',700,true,false],['Noto Serif SC','Regular',400,false,true],['Source Han Serif CN','Medium',500,false,false]].map(([family,style,weight,italic,variable])=>({family,style,blob:async()=>nativeFontBlob(weight,italic,variable)}));
};
window.fontQueryFixture=window.queryLocalFonts;
window.capture=()=>{const f=document.querySelector('.bs-epub-frame'),d=f.contentDocument,w=f.contentWindow,s=w.getComputedStyle(d.body),r=d.caretRangeFromPoint(parseFloat(s.paddingLeft)+3,parseFloat(s.paddingTop)+3);if(!r)throw Error('no anchor');window.anchor={node:r.startContainer,offset:r.startOffset};return true};
window.anchorVisible=()=>{const f=document.querySelector('.bs-epub-frame'),d=f.contentDocument,w=f.contentWindow,r=d.createRange();r.setStart(anchor.node,anchor.offset);r.setEnd(anchor.node,Math.min(anchor.offset+1,anchor.node.length));const q=r.getBoundingClientRect();return q.left>=-1&&q.right<=w.innerWidth+1&&q.top>=-1&&q.bottom<=w.innerHeight+1};
</script></body></html>`

try {
  const { fixtures, chromePath } = await prepareBrowserEnvironment(temporary, { books: true })
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://test').pathname
      const files = { '/react.js': join(fixtures, 'node_modules/react/umd/react.development.js'), '/react-dom.js': join(fixtures, 'node_modules/react-dom/umd/react-dom.development.js'), '/client.js': join(pluginDir, 'client.js') }
      if (path === '/test.html') { res.setHeader('content-type', 'text/html'); res.end(page); return }
      if (files[path]) { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(files[path])); return }
      await route.handler(req, res)
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const archive = await readFile(join(fixtures, 'paged-long.epub'))
  const books = []
  for (let i = 0; i < 16; i++) {
    const response = await fetch(`${origin}/bookshelf/api/books?name=layout-${i}.epub&title=Layout%20${i}&format=epub`, { method: 'POST', body: archive })
    assert.equal(response.status, 201)
    books.push((await response.json()).book)
  }
  for (const [book, settings] of [
    [books[0], { fontFamily: 'mono', fontSize: 18 }],
    [books[1], { fontFamily: 'serif', fontName: 'Unavailable Font For Test', fontWeight: 0, fontStyle: 'normal' }],
  ]) {
    assert.equal((await fetch(`${origin}/bookshelf/api/books/${book.id}/state`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings }) })).status, 200)
  }
  await fetch(`${origin}/bookshelf/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fontFamily: 'sans', pageMode: 'paged', pageSpread: 'single' }) })
  chrome = spawn(chromePath, [...browserLaunchArgs(), '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0', '--window-size=1800,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const browserUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 10000)
    let output = ''
    chrome.once('error', error => { clearTimeout(timer); reject(error) })
    chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
  })
  const targets = await (await fetch('http://' + new URL(browserUrl).host + '/json')).json()
  const target = targets.find(entry => entry.url === 'about:blank')
  assert.ok(target)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  await navigateTestPage(socket, `${origin}/test.html`)
  let sequence = 0
  async function command(method, params) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(Error('CDP timeout')) }, 45000)
      const listener = event => {
        const result = JSON.parse(event.data)
        if (result.id !== id) return
        clearTimeout(timer); socket.removeEventListener('message', listener)
        if (result.error || result.result?.exceptionDetails) reject(Error(JSON.stringify(result.error || result.result.exceptionDetails)))
        else resolve(result.result)
      }
      socket.addEventListener('message', listener)
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  const evaluate = async expression => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value
  const trustedClick = async label => {
    const point = await evaluate(`(()=>{const b=document.querySelector('button[aria-label="${label}"]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
    await evaluate('wait(300)')
  }
  const started = Date.now()
  while (true) {
    try { if (await evaluate('typeof window.until === \"function\"')) break } catch (error) { if (!error.message.includes('Execution context was destroyed')) throw error }
    assert.ok(Date.now() - started < 10000, 'test page initialized')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await evaluate(`(async()=>{await until(()=>document.querySelectorAll('.bs-card').length===16)})()`)
  const widths = []
  for (const width of [1260, 1600, 480, 1600]) {
    const state = await evaluate(`(async()=>{document.getElementById('root').style.width='${width}px';await wait(120);const root=document.querySelector('.bs-root'),g=document.querySelector('.bs-grid'),cards=[...g.children],a=cards[0].getBoundingClientRect(),r=root.getBoundingClientRect();const row=cards.filter(c=>Math.abs(c.getBoundingClientRect().top-a.top)<1);const last=row[row.length-1].getBoundingClientRect();return{viewport:innerWidth,left:a.left-r.left,card:a.width,columns:row.length,rowRight:last.right,gridRight:g.getBoundingClientRect().right,width:r.width,overflow:root.scrollWidth-root.clientWidth}})()`)
    assert.equal(state.width, width)
    assert.ok(Math.abs(state.left - (width <= 720 ? 20 : 24)) < 1, 'grid starts at the content padding')
    assert.ok(state.card >= 163.5, 'cards keep a comfortable minimum width')
    assert.ok(Math.abs(state.rowRight - state.gridRight) < 1.5, 'a full row reaches the grid edge')
    assert.ok(state.overflow < 2, 'content width does not overflow')
    widths.push(state)
  }
  assert.ok(widths[1].columns > widths[0].columns, 'collapsing a sidebar adds columns without changing the window width')
  assert.equal(widths[0].viewport, widths[1].viewport)
  await evaluate(`(async()=>{click('shelfSettings');await until(()=>!document.querySelector('button[aria-label="scanSystemFonts"]').disabled)})()`)
  await evaluate('window.queryLocalFonts=undefined')
  await trustedClick('scanSystemFonts')
  assert.ok(await evaluate(`document.querySelector('.bs-font-status').textContent.includes('fontAccessUnavailable')`))
  await evaluate('window.queryLocalFonts=window.fontQueryFixture')
  await trustedClick('scanSystemFonts')
  assert.equal(await evaluate('scanCalls'), 1)
  await evaluate(`(async()=>{await until(()=>[...document.querySelector('select[aria-label="fontFamily"]').options].some(o=>o.value==='font:Source Han Serif CN'));choose('fontFamily','font:Source Han Serif CN');await until(()=>[...document.querySelector('select[aria-label="fontWeight"]').options].some(o=>o.value==='500'));choose('fontWeight',500);await wait(900)})()`)
  let defaults = await (await fetch(`${origin}/bookshelf/api/settings`)).json()
  assert.equal(defaults.settings.fontName, 'Source Han Serif CN')
  assert.equal(defaults.settings.fontWeight, 500)
  await evaluate(`(async()=>{window.scanMode='denied'})()`)
  await trustedClick('scanSystemFonts')
  assert.ok(await evaluate(`document.querySelector('.bs-font-status').textContent.includes('fontAccessDenied')`))
  assert.equal(await evaluate(`document.querySelector('select[aria-label="fontFamily"]').value`), 'font:Source Han Serif CN')
  await evaluate(`(async()=>{click('dismiss');document.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-epub-frame'));await wait(900)})()`)
  const title = await evaluate(`document.querySelector('.bs-reader-title').textContent`)
  const winHeader = await evaluate(`(()=>{const b=document.querySelector('.bs-reader-bar'),r=b.getBoundingClientRect();return{height:r.height,padding:parseFloat(getComputedStyle(b).paddingTop),subtitle:getComputedStyle(document.querySelector('.bs-reader-sub')).display}})()`)
  assert.equal(winHeader.padding, 6, 'Windows caption space is not added a second time')
  assert.ok(winHeader.height >= 48 && winHeader.height < 51)
  assert.notEqual(winHeader.subtitle, 'none')
  assert.ok((await evaluate(`document.querySelector('.bs-epub-frame').contentWindow.getComputedStyle(document.querySelector('.bs-epub-frame').contentDocument.body).fontFamily`)).includes('Source Han Serif CN'))
  await evaluate(`(async()=>{click('nextPage');await wait(500);capture();click('readingSettings');await until(()=>[...document.querySelector('select[aria-label="fontFamily"]').options].some(o=>o.value==='font:Georgia'));choose('fontFamily','font:Georgia');await until(()=>[...document.querySelector('select[aria-label="fontWeight"]').options].some(o=>o.value==='700'));await wait(450);choose('fontWeight',700);await wait(450);choose('fontStyle','italic');await wait(600)})()`)
  assert.ok(await evaluate('anchorVisible()'), 'font family, weight and italic changes retain the visible reading anchor')
  const applied = await evaluate(`(()=>{const f=document.querySelector('.bs-epub-frame'),s=f.contentWindow.getComputedStyle(f.contentDocument.body);return{family:s.fontFamily,weight:s.fontWeight,style:s.fontStyle}})()`)
  assert.ok(applied.family.includes('Georgia'), JSON.stringify(applied))
  assert.equal(applied.weight, '700')
  assert.equal(applied.style, 'italic')
  const popup = await evaluate(`(()=>{const p=document.querySelector('.bs-reader-settings').getBoundingClientRect(),b=document.querySelector('.bs-reader-bar').getBoundingClientRect();return{top:p.top,bottom:b.bottom}})()`)
  assert.ok(popup.top >= popup.bottom + 6 && popup.top <= popup.bottom + 10, 'settings follow measured toolbar geometry')
  await evaluate(`(async()=>{document.documentElement.dataset.platform='darwin';document.documentElement.style.setProperty('--dsh-frame-top-clearance','48px');await wait(200)})()`)
  assert.equal(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.bs-reader-bar')).paddingTop)`), 54, 'macOS keeps its overlay clearance')
  await evaluate(`(async()=>{document.documentElement.dataset.platform='win32';document.getElementById('root').style.width='480px';await wait(300)})()`)
  const narrow = await evaluate(`(()=>{const s=document.querySelector('.bs-reader').getBoundingClientRect(),p=document.querySelector('.bs-reader-settings').getBoundingClientRect();return{inside:p.left>=s.left&&p.right<=s.right+1&&p.bottom<=s.bottom+1,subtitle:getComputedStyle(document.querySelector('.bs-reader-sub')).display}})()`)
  assert.ok(narrow.inside, 'narrow settings stay inside the content panel')
  assert.notEqual(narrow.subtitle, 'none')
  await evaluate(`(async()=>{click('dismiss');click('back');await until(()=>document.querySelector('.bs-cover'));document.getElementById('root').style.width='1600px';document.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-epub-frame'));await wait(900)})()`)
  assert.equal(await evaluate(`document.querySelector('.bs-reader-title').textContent`), title)
  assert.equal(await evaluate(`document.querySelector('.bs-epub-frame').contentWindow.getComputedStyle(document.querySelector('.bs-epub-frame').contentDocument.body).fontStyle`), 'italic', 'per-book font style survives reopen')
  defaults = await (await fetch(`${origin}/bookshelf/api/settings`)).json()
  assert.equal(defaults.settings.fontName, 'Source Han Serif CN', 'book changes preserve global defaults')
  await evaluate(`(async()=>{click('back');await until(()=>document.querySelector('.bs-card'));[...document.querySelectorAll('.bs-card')].find(c=>c.querySelector('.bs-book-title')?.textContent==='Layout 0').querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-epub-frame'));await wait(800)})()`)
  const legacyFont = await evaluate(`document.querySelector('.bs-epub-frame').contentWindow.getComputedStyle(document.querySelector('.bs-epub-frame').contentDocument.body).fontFamily`)
  assert.ok(legacyFont.includes('monospace') && !legacyFont.includes('Source Han'), 'legacy per-book presets override new named global defaults')
  await evaluate(`(async()=>{click('back');await until(()=>document.querySelector('.bs-card'));[...document.querySelectorAll('.bs-card')].find(c=>c.querySelector('.bs-book-title')?.textContent==='Layout 1').querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-epub-frame'));await wait(800);click('readingSettings');await until(()=>document.querySelector('select[aria-label="fontFamily"]'));await wait(200)})()`)
  assert.equal(await evaluate(`document.querySelector('select[aria-label="fontFamily"]').value`), 'font:Unavailable Font For Test')
  assert.ok(await evaluate(`document.querySelector('.bs-reader-settings').textContent.includes('fontMissingHint')`), 'missing fonts retain the saved preference and explain the fallback')
  assert.ok(await evaluate(`document.querySelector('.bs-epub-frame').contentDocument.querySelector('p').getBoundingClientRect().height>0`), 'missing fonts still render readable content')
  assert.deepEqual(await evaluate('errors'), [])
  console.log('Layout, platform clearance, font access fallback, native styles, persistence and reading-anchor regressions passed.', widths)
} finally {
  if (socket) socket.close()
  if (chrome && chrome.exitCode === null) {
    await new Promise(resolve => { chrome.once('exit', resolve); chrome.kill() })
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  assert.equal(await realpath(temporary), owned)
  assert.equal(dirname(owned), await realpath(tmpdir()))
  assert.ok(basename(owned).startsWith('bookshelf-layout-fonts-'))
  await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
