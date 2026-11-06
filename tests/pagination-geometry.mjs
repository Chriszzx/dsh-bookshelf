// Functional browser regression of the installed reader's pagination geometry.
// Uses an isolated Host and generated EPUB; does not inspect a personal browser
// or claim to verify the live DSH shell. React UMD fixtures are supplied separately.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { zipSync, strToU8 } from '../assets/fflate.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const fixtures = process.env.BOOKSHELF_TEST_FIXTURES || '/tmp/batch1-test'
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-geometry-'))
const ownedPath = await realpath(temporary)
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(new URL('../index.js', import.meta.url))
let route, chrome, socket, server
apply({ effect: fn => fn(), webServer: { register(value) { route = value; return () => {} } }, logger: { info() {}, warn() {}, error() {} } })
const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}#root{width:1400px;height:900px}</style></head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>window.__ModuleLoader__={load(d){window.definition=d}};</script><script src="/client.js"></script>
<script>
window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const originalError=console.error;console.error=(...a)=>{errors.push(a.map(String).join(' '));originalError(...a)};
const t=(key,p)=>key+(p?'('+Object.entries(p).map(([k,v])=>k+'='+v).join(',')+')':'');
const regs=[];const plugin=definition.factory(id=>{if(id==='react')return React;throw Error(id)});
plugin.apply({effect:fn=>fn(),locale:{register(){return()=>{}},bind(){return t}},slots:{inject(k,fn){fn()},register(o,C){regs.push({o,C});return()=>{}}}});
const Panel=regs.find(r=>r.o.name==='main').C;
const root=ReactDOM.createRoot(document.getElementById('root'));root.render(React.createElement(Panel,{t}));
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<12000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.click=title=>{const b=document.querySelector('button[title="'+title+'"]');if(!b)throw Error('missing '+title);ReactDOM.flushSync(()=>b.click())};
window.segment=text=>{const b=[...document.querySelectorAll('.bs-segment')].find(b=>b.textContent===text);if(!b)throw Error('missing '+text);ReactDOM.flushSync(()=>b.click())};
window.label=()=>[...document.querySelectorAll('.bs-control-label')].map(e=>e.textContent).find(s=>s.includes('pageOf')||s.includes('pageRangeOf'))||'';
window.remount=()=>{ReactDOM.flushSync(()=>root.render(null));ReactDOM.flushSync(()=>root.render(React.createElement(Panel,{t})))};
window.inspect=()=>{
 const f=document.querySelector('.bs-epub-frame'),d=f.contentDocument,w=f.contentWindow,b=d.body,s=w.getComputedStyle(b);
 const left=parseFloat(s.paddingLeft),right=w.innerWidth-parseFloat(s.paddingRight),top=parseFloat(s.paddingTop),bottom=w.innerHeight-parseFloat(s.paddingBottom);
 const columns=parseInt(s.columnCount)||1,step=b.getBoundingClientRect().width/columns;
 const leaks=[];let visible=0;const walker=d.createTreeWalker(b,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){const node=walker.currentNode;if(!node.textContent.trim()||node.parentElement.closest('.bb-table-wrap'))continue;const r=d.createRange();r.selectNodeContents(node);for(const q of r.getClientRects()){
   if(q.width<.1||q.height<.1||q.right<=0||q.left>=w.innerWidth||q.bottom<=0||q.top>=w.innerHeight)continue;
   const col=Math.floor((q.left-left+1)/step),colLeft=left+col*step,colRight=colLeft+step-parseFloat(s.columnGap);
   visible++;if(col<0||col>=columns||q.left<colLeft-1||q.right>colRight+1||q.top<top-1||q.bottom>bottom+1)leaks.push({left:q.left,right:q.right,top:q.top,bottom:q.bottom,text:node.textContent.slice(0,35)});
 }}
 return {width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,left,right,gap:parseFloat(s.columnGap),columns,column:step-parseFloat(s.columnGap),padded:b.hasAttribute('data-bb-pad-spread'),scroll:b.scrollLeft,scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,label:label(),visible,leaks:leaks.slice(0,4)};
};
window.capture=()=>{const f=document.querySelector('.bs-epub-frame'),d=f.contentDocument,w=f.contentWindow,s=w.getComputedStyle(d.body);const r=d.caretRangeFromPoint(parseFloat(s.paddingLeft)+3,parseFloat(s.paddingTop)+3);if(!r)throw Error('no anchor');window.anchor={node:r.startContainer,offset:r.startOffset};return {text:r.startContainer.textContent.slice(r.startOffset,r.startOffset+40)}};
window.anchorVisible=()=>{const f=document.querySelector('.bs-epub-frame'),d=f.contentDocument,w=f.contentWindow,r=d.createRange();r.setStart(anchor.node,anchor.offset);r.setEnd(anchor.node,Math.min(anchor.offset+1,anchor.node.length));const q=r.getBoundingClientRect();return {visible:q.left>=-1&&q.right<=w.innerWidth+1&&q.top>=-1&&q.bottom<=w.innerHeight+1,left:q.left,top:q.top}};
</script></body></html>`
try {
 server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://test').pathname
  const files={'/react.js':join(fixtures,'node_modules/react/umd/react.development.js'),'/react-dom.js':join(fixtures,'node_modules/react-dom/umd/react-dom.development.js'),'/client.js':join(pluginDir,'client.js')}
  if(path==='/test.html'){res.setHeader('content-type','text/html');res.end(page);return}
  if(files[path]){res.setHeader('content-type','text/javascript');res.end(await readFile(files[path]));return}
  await route.handler(req,res)
 }catch(e){res.writeHead(500);res.end(String(e))}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const origin=`http://127.0.0.1:${server.address().port}`
 const paragraphs=Array.from({length:160},(_,i)=>`<p id="p${i}">${Array.from({length:35},(_,j)=>`Paragraph${i}word${j} reading pagination keeps every line inside its own page.`).join(' ')}</p>`).join('')
 const archive=zipSync({mimetype:[strToU8('application/epub+zip'),{level:0}],
 'META-INF/container.xml':strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
 'book.opf':strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">geometry</dc:identifier><dc:title>Geometry</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>'),
 'one.xhtml':strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Geometry</title></head><body>'+paragraphs+'</body></html>')})
 const imported=await fetch(`${origin}/bookshelf/api/books?name=geometry.epub&title=Geometry&format=epub`,{method:'POST',body:archive});assert.equal(imported.status,201)
 const {book}=await imported.json()
 assert.equal((await fetch(`${origin}/bookshelf/api/books/${book.id}/state`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings:{pageMode:'paged',pageMargin:'standard',fontSize:19,pageSpread:'single'}})})).status,200)
 chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking',`--user-data-dir=${join(temporary,'chrome')}`,'--remote-debugging-port=0','--window-size=1600,1000',`${origin}/test.html`],{stdio:['ignore','ignore','pipe']})
 const browserUrl=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),10000);let log='';chrome.once('error',e=>{clearTimeout(timer);reject(e)});chrome.stderr.on('data',c=>{log+=c;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1])}})})
 const targets=await(await fetch('http://'+new URL(browserUrl).host+'/json')).json();const target=targets.find(p=>p.url===`${origin}/test.html`);assert.ok(target)
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j})
 let sequence=0
 async function command(method,params){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.removeEventListener('message',listener);reject(Error('CDP timeout'))},45000);const listener=event=>{const m=JSON.parse(event.data);if(m.id!==id)return;clearTimeout(timer);socket.removeEventListener('message',listener);if(m.error||m.result?.exceptionDetails)reject(Error(JSON.stringify(m.error||m.result.exceptionDetails)));else resolve(m.result)};socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method,params}))})}
 async function evaluate(expression){return (await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}))?.result?.value}
 const start=Date.now();while(true){try{if(await evaluate('Boolean(window.inspect)'))break}catch(e){if(!e.message.includes('Execution context was destroyed'))throw e}assert.ok(Date.now()-start<10000);await new Promise(r=>setTimeout(r,100))}
 await evaluate(`(async()=>{await until(()=>document.querySelector('.bs-cover'));document.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-epub-frame'));await wait(1000)})()`)
 const baseline=await evaluate('inspect()');console.log('Initial geometry',baseline)
 assert.deepEqual(baseline.leaks,[],'adjacent page text must not appear inside the current page margins')
 const pointer=await evaluate(`(()=>{const r=document.querySelector('.bs-epub-frame').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
 await command('Input.dispatchMouseEvent',{type:'mouseWheel',...pointer,deltaX:baseline.width*.55,deltaY:0})
 await evaluate('wait(250)')
 const afterWheel=await evaluate('inspect()');console.log('After horizontal trackpad input',afterWheel)
 assert.equal(afterWheel.scroll,baseline.scroll,'horizontal trackpad must not leave a fractional page')
 assert.deepEqual(afterWheel.leaks,[],'trackpad must not reveal parts of adjacent pages')
 // A progress hover/focus must never resize the reading viewport or repaginate.
 async function checkProgressGeometry() {
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2})
  await evaluate('document.activeElement?.blur();wait(200)')
  const before=await evaluate('inspect()')
  await evaluate('capture()')
  const track=await evaluate(`(()=>{const p=document.querySelector('.bs-progress'),r=p.getBoundingClientRect(),shell=p.closest('.bs-reader').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,bottom:r.bottom,shellBottom:shell.bottom}})()`)
  for(let i=0;i<3;i++){
   await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:track.x,y:track.y})
   await evaluate('wait(180)')
   const hovered=await evaluate('inspect()')
   assert.equal(hovered.height,before.height,'progress hover must not resize reading viewport')
   assert.equal(hovered.label,before.label,'progress hover must not change page counts or position')
   assert.equal(hovered.scroll,before.scroll,'progress hover must not shift displayed text')
   assert.ok((await evaluate('anchorVisible()')).visible,'progress hover preserves the visible text')
   await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2})
   await evaluate('wait(180)')
   assert.deepEqual(await evaluate('inspect()'),before,'leaving progress must preserve pagination')
  }
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  await evaluate(`document.querySelector('.bs-progress').focus();wait(200)`)
  assert.deepEqual(await evaluate('inspect()'),before,'keyboard focus must preserve pagination')
  assert.ok(Math.abs(track.bottom-track.shellBottom)<1,'progress lives at the bottom of the reader')
  assert.ok(await evaluate(`[...document.querySelectorAll('.bs-progress,.bs-progress-fill,.bs-progress-thumb')].every(n=>getComputedStyle(n).transitionDuration.split(',').every(v=>parseFloat(v)===0))`),'progress has no transition animations')
  await evaluate('document.activeElement.blur()')
 }
 await checkProgressGeometry()
 const rows=[]
 for(const margin of ['Standard','Compact','Fill']){
  await evaluate(`(async()=>{if(!document.querySelector('.bs-reader-settings'))click('readingSettings');segment('margin${margin}');await wait(350)})()`)
  for(const [width,height] of [[1200,850],[807,701],[511,600],[1049.5,810.5]]){
   await evaluate(`(async()=>{const root=document.getElementById('root');root.style.width='${width}px';root.style.height='${height}px';await wait(650)})()`)
   for(let turn=0;turn<3;turn++){
    const state=await evaluate('inspect()');assert.deepEqual(state.leaks,[],`${margin} ${width}x${height} page ${turn}: no adjacent/partial lines`);assert.ok(state.visible>0)
    assert.ok(Math.abs(state.column+state.gap-state.width)<.1,'column + gap must equal actual reading viewport')
    assert.ok(Math.abs(state.scroll/state.width-Math.round(state.scroll/state.width))<.002,'page scroll must align with viewport')
    assert.equal(Number(state.label.match(/total=(\d+)/)?.[1]),Math.ceil((state.scrollWidth-1)/state.width),'hidden probe and visible chapter agree on page count')
    if(turn===0)rows.push({margin,width:state.width,height:state.height,page:state.label})
    await evaluate(`(async()=>{click('nextPage');await wait(60)})()`)
   }
  }
 }
 await evaluate(`(async()=>{segment('marginStandard');document.getElementById('root').style.width='1200px';await wait(650);click('nextPage');await wait(100)})()`)
 const anchor=await evaluate('capture()')
 for(const [width,height] of [[819,650],[1333,940],[611,777]]){
  await evaluate(`(async()=>{document.getElementById('root').style.width='${width}px';document.getElementById('root').style.height='${height}px';await wait(650)})()`)
  const result=await evaluate('anchorVisible()');assert.ok(result.visible,`same text anchor survives resize to ${width}x${height}: ${JSON.stringify(result)}`)
 }
 for(const action of ['fontLarger','fontLarger','fontLarger','toc','toc','fontSmaller','fontSmaller','fontSmaller']){
  await evaluate(`(async()=>{click('${action}');await wait(450)})()`)
  assert.ok((await evaluate('anchorVisible()')).visible,`reading anchor survives ${action}`)
  assert.deepEqual((await evaluate('inspect()')).leaks,[],`page boundaries survive ${action}`)
 }
 const last=await evaluate(`(async()=>{document.querySelector('.bs-progress').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));await wait(600);return inspect()})()`)
 assert.deepEqual(last.leaks,[],'last page remains aligned and clipped')
 assert.ok(/current=(\d+),total=\1/.test(last.label),'last page label reaches total')
 const tail=await evaluate(`(()=>{const f=document.querySelector('.bs-epub-frame'),d=f.contentDocument,w=f.contentWindow,r=d.createRange();r.selectNodeContents(d.querySelector('p:last-child').lastChild);const q=[...r.getClientRects()].at(-1);return q.left>=0&&q.right<=w.innerWidth+1&&q.bottom<=w.innerHeight+1})()`)
 assert.ok(tail,'final line is reachable, without clipping away text')
 // Auto spreads: actual width and font size choose columns; anchors survive both directions.
 await evaluate(`(async()=>{document.getElementById('root').style.width='1500px';document.getElementById('root').style.height='900px';segment('spreadAuto');await wait(700);document.querySelector('.bs-progress').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));await wait(150);click('nextPage');await wait(100)})()`)
 let dual=await evaluate('inspect()');console.log('First dual spread',dual)
 assert.equal(dual.columns,2);assert.match(dual.label,/current=3,end=4/);assert.deepEqual(dual.leaks,[])
 await checkProgressGeometry()
 const dualAnchor=await evaluate('capture()')
 for(const width of [1000,1500,1100,1500]){
  await evaluate(`(async()=>{document.getElementById('root').style.width='${width}px';await wait(650)})()`)
  const state=await evaluate('inspect()');assert.equal(state.columns,width===1500?2:1)
  assert.ok((await evaluate('anchorVisible()')).visible,'same text remains visible through single/dual reflow');assert.deepEqual(state.leaks,[])
 }
 // Font 19 fits two 24em columns, font 25 does not at this actual width.
 for(let i=0;i<6;i++)await evaluate(`(async()=>{click('fontLarger');await wait(60)})()`)
 await evaluate('wait(650)');assert.equal((await evaluate('inspect()')).columns,1);assert.ok((await evaluate('anchorVisible()')).visible)
 for(let i=0;i<6;i++)await evaluate(`(async()=>{click('fontSmaller');await wait(60)})()`)
 await evaluate('wait(650)');assert.equal((await evaluate('inspect()')).columns,2);assert.ok((await evaluate('anchorVisible()')).visible)
 for(const choice of ['spreadSingle','spreadAuto']){
  await evaluate(`(async()=>{segment('${choice}');await wait(650)})()`)
  assert.equal((await evaluate('inspect()')).columns,choice==='spreadSingle'?1:2)
  assert.ok((await evaluate('anchorVisible()')).visible)
 }
 const tailParities=new Set()
 for(let height=810;height<=950 && tailParities.size<2;height+=11){
  await evaluate(`(async()=>{document.getElementById('root').style.height='${height}px';await wait(650);document.querySelector('.bs-progress').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));await wait(250)})()`)
  const state=await evaluate('inspect()'),total=Number(state.label.match(/total=(\d+)/)?.[1]);tailParities.add(total%2)
  assert.equal(state.columns,2);assert.deepEqual(state.leaks,[],'tail is aligned without neighboring fragments')
  assert.ok(Math.abs(state.scroll/state.width-Math.round(state.scroll/state.width))<.002,'odd tail must not clamp between spreads')
  assert.equal(state.padded,total%2===1,'only odd tails have a blank partner')
  assert.equal(Math.ceil((state.scrollWidth-1)/(state.width/2))-(state.padded?1:0),total,'blank tail excluded from total')
  assert.ok(await evaluate(`document.querySelector('button[title="nextPage"]').disabled`),'last spread disables next')
  assert.ok(await evaluate(`(()=>{const f=document.querySelector('.bs-epub-frame'),d=f.contentDocument,r=d.createRange();r.selectNodeContents(d.querySelector('p:last-child').lastChild);const q=[...r.getClientRects()].at(-1);return q.left>=0&&q.right<=f.contentWindow.innerWidth+1})()`),'last line visible')
  const before=state.label
  await evaluate(`(async()=>{remount();await until(()=>document.querySelector('.bs-epub-frame'));await wait(1100)})()`)
  assert.equal((await evaluate('inspect()')).label,before,'last spread restores after panel remount')
  await evaluate(`(async()=>{click('previousPage');await wait(100);click('nextPage');await wait(100)})()`)
  assert.equal((await evaluate('inspect()')).label,before,'back/forward returns to same final spread')
 }
 assert.equal(tailParities.size,2,'exercise both odd and even chapter tails')
 const saved=await(await fetch(`${origin}/bookshelf/api/books/${book.id}/state`)).json();assert.equal(saved.state.settings.pageSpread,'auto');assert.equal(saved.state.progress.scrollRatio,1)
 await evaluate(`(async()=>{click('readingSettings');segment('spreadSingle');await wait(700);remount();await until(()=>document.querySelector('.bs-epub-frame'));await wait(1000)})()`)
 assert.equal((await evaluate('inspect()')).columns,1,'single-page preference persists after remount')
 assert.equal((await(await fetch(`${origin}/bookshelf/api/books/${book.id}/state`)).json()).state.settings.pageSpread,'single')
 // Three short spine entries: one text page, an empty chapter, and another
 // text page. Each starts a fresh spread, without inventing numbered blanks.
 const shortArchive=zipSync({
  mimetype:[strToU8('application/epub+zip'),{level:0}],
  'META-INF/container.xml':strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
  'book.opf':strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">short</dc:identifier><dc:title>Short</dc:title><dc:language>en</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>'),
  'a.xhtml':strToU8('<html><body><p>First short chapter.</p></body></html>'),
  'b.xhtml':strToU8('<html><body></body></html>'),
  'c.xhtml':strToU8('<html><body><p>Last short chapter.</p><table><tr>'+Array.from({length:20},()=>'<td style="white-space:nowrap">WideTableContent1234567890</td>').join('')+'</tr></table></body></html>')})
 const shortResponse=await fetch(`${origin}/bookshelf/api/books?name=short.epub&title=Short&format=epub`,{method:'POST',body:shortArchive});assert.equal(shortResponse.status,201)
 const shortBook=(await shortResponse.json()).book
 await fetch(`${origin}/bookshelf/api/books/${shortBook.id}/state`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings:{pageMode:'paged',pageSpread:'auto'}})})
 await evaluate(`(async()=>{click('back');remount();await until(()=>[...document.querySelectorAll('.bs-book-title')].some(n=>n.textContent==='Short'));const title=[...document.querySelectorAll('.bs-book-title')].find(n=>n.textContent==='Short');title.closest('.bs-card').querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-epub-frame'));await wait(1000)})()`)
 for(const current of [1,2,3]){
  const state=await evaluate('inspect()');assert.equal(state.columns,2);assert.equal(state.label,`pageOf(current=${current},total=3)`,'short/empty chapters count one real page each');assert.equal(state.scroll,0);assert.deepEqual(state.leaks,[])
  if(current<3)await evaluate(`(async()=>{click('nextPage');await wait(700)})()`)
 }
 assert.ok(await evaluate(`(()=>{const table=document.querySelector('.bs-epub-frame').contentDocument.querySelector('.bb-table-wrap');return table.scrollWidth>table.clientWidth})()`),'wide table really overflows within its own scroller without adding pages')
 await evaluate(`(async()=>{click('previousPage');await wait(700)})()`)
 assert.equal((await evaluate('inspect()')).label,'pageOf(current=2,total=3)','previous chapter restores final spread')
 assert.deepEqual(await evaluate('errors'),[])
 console.log(JSON.stringify({matrix:rows,anchor,dualAnchor,tailParities:[...tailParities],lastPage:last.label,errors:[]},null,2));console.log('PASS: single/dual geometry, typography, reflow, tail counts and persistence')
} finally {
 socket?.close()
 if(chrome&&chrome.exitCode===null){const exited=once(chrome,'exit');chrome.kill('SIGTERM');await exited}
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}
 assert.equal(await realpath(temporary),ownedPath);await rm(ownedPath,{recursive:true,force:true})
}
