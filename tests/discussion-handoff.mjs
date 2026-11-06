// Isolated browser contract test for the bookshelf -> native conversation -> Books
// handoff. The bookshelf Host, bookshelf Client, Books Client, EPUB reader and
// visible-text capture are real. Only the native Session/rightbar transport is a
// test seam; this is not live-GUI visual acceptance.
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-handoff-'))
const ownedPath = await realpath(temporary)
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(new URL('../index.js', import.meta.url))
let route, chrome, socket, server
apply({ effect: fn => fn(), webServer: { register(value) { route = value; return () => {} } }, logger: { info() {}, warn() {}, error() {} } })

const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}#root{width:1280px;height:900px}#sidebar{position:fixed;right:0;top:0;width:420px;height:100%;overflow:auto;background:#fff}</style></head><body>
<div id="root"></div><div id="sidebar"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>window.__defs=[];window.__ModuleLoader__={load(d){window.__defs.push(d)}};</script>
<script src="/shelf-client.js"></script>
<script>
window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const originalError=console.error;console.error=(...a)=>{errors.push(a.map(String).join(' '));originalError(...a)};
const t=(key,p)=>key;
const tShelf=(key,p)=>key+(p?'('+Object.entries(p).map(([k,v])=>k+'='+v).join(',')+')':'');
const defs=Object.fromEntries(__defs.map(d=>[d.id,d]));
const shelfState={panel:null,tab:null,header:null,composerSeed:null};
const sessions={},createCalls=[],commandCalls=[],openCalls=[],openedKinds=[],draftWrites=[];
let navigation;
const mounted={value:null,listeners:new Set(),getSnapshot(){return this.value},subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}};
const remote={session:{async create(request,...extra){if(extra.length)throw Error('session/create takes one argument');createCalls.push(structuredClone(request));return {ok:true,value:{sessionId:request.sessionId}}}},
 commands:{async execute(sessionId,line,attachments){const payload=JSON.parse(line.slice('/bookshelf-snapshot '.length));commandCalls.push({sessionId,payload,attachments});sessions[sessionId]={snapshot:payload.snapshot};const file={path:'.dsh-bookshelf/'+payload.snapshot.snapshotId+'.md',mention:'@.dsh-bookshelf/'+payload.snapshot.snapshotId+'.md',label:'Handoff · 1 / 1'};return {ok:true,value:{result:{kind:'success',text:JSON.stringify({marker:'bookshelf-page-snapshot-v1',snapshot:payload.snapshot,file})}}}}}};
const shelfCtx={effect(fn){return fn()},locale:{register(){return()=>{}},bind(){return tShelf}},
 slots:{inject(name,fn){fn()},register(spec,component){
   if(spec.name==='main')shelfState.panel=component;
   if(spec.name==='sidebar.right.pane.tab')shelfState.tab=component;
   if(spec.name==='conversation.session.header.utilities')shelfState.header=component;
   if(spec.name==='conversation.composer.dock')shelfState.composerSeed=component;
   return()=>{}}},
 sidebarRightTabs:{register(){return()=>{}}},
 sidebarRight:{mounted,openTab(kind){openedKinds.push(kind);renderSidebar()}},
 uiConversation:{events:{register(){return()=>{}}}},
 remote,uiWorkspace:{openSession(id){openNative(id)}},layout:{beginNavigation(){navigation?.abort();navigation=new AbortController();return navigation.signal},selectPanel(id){if(id==='bookshelf')showShelf()}}};
function projectionFor(sessionId){return key=>key==='shelfPageSnapshot'?sessions[sessionId]?.snapshot:undefined}
const root=ReactDOM.createRoot(document.getElementById('root'));
const sidebarRoot=ReactDOM.createRoot(document.getElementById('sidebar'));
const inputActions={setDraft(value){draftWrites.push(structuredClone(value))}};
function Shell(){
 const Header=shelfState.header, Composer=shelfState.composerSeed;
 const sessionId=mounted.value;
 return React.createElement('div',null,Header?React.createElement(Header,{sessionId,useProjection:projectionFor(sessionId)}):null,Composer?React.createElement(Composer,{sessionId,useProjection:projectionFor(sessionId),inputActions}):null,React.createElement('div',{id:'native-marker'},'native:'+sessionId));
}
function renderSidebar(){
 if(!shelfState.tab||!mounted.value)return;
 const sessionId=mounted.value;
 ReactDOM.flushSync(()=>sidebarRoot.render(React.createElement(shelfState.tab,{sessionId,useProjection:projectionFor(sessionId),inputActions,useTabInfo:()=>({tab:{signal:new AbortController().signal,actions:{}}})})));
}
function openNative(sessionId){
 openCalls.push(sessionId);mounted.value=sessionId;
 ReactDOM.flushSync(()=>root.render(React.createElement(Shell)));
}
function showShelf(){
 mounted.value=null;
 ReactDOM.flushSync(()=>sidebarRoot.render(null));
 ReactDOM.flushSync(()=>root.render(React.createElement(shelfState.panel,{t:tShelf,useWorkspaces:()=>[{workspaceId:'ws-1',path:'/tmp/fixture-workspace'}]})));
}
window.wait=ms=>new Promise(r=>setTimeout(r,ms));
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<15000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.ready=async()=>{
 const shelfPlugin=defs['@local/dsh-bookshelf'].factory(id=>{if(id==='react')return React;throw Error(id)});
 if(!shelfPlugin.inject?.includes('remote.session'))throw Error('bookshelf client must inject remote.session');
 shelfPlugin.apply(shelfCtx);
 showShelf();
 await until(()=>document.querySelector('.bs-cover'));
 const caps=await (await fetch('/bookshelf/api/capabilities')).json();
 const appleButton=()=>document.querySelector('button[title="importAppleBooks"]');
 const platformUi={caps,initial:Boolean(appleButton()),disabled:null,enabled:null};
 if(caps.appleBooks){
   await until(()=>appleButton());
   const settingsButton=[...document.querySelectorAll('#root button')].find(b=>b.title==='shelfSettings');
   if(!settingsButton)throw Error('missing shelf settings');
   ReactDOM.flushSync(()=>settingsButton.click());
   await until(()=>document.querySelector('.bs-setting-toggle input'));
   const checkbox=document.querySelector('.bs-setting-toggle input');
   checkbox.click();await wait(80);
   platformUi.disabled=!appleButton();
   checkbox.click();await wait(80);
   platformUi.enabled=Boolean(appleButton());
   const close=document.querySelector('.bs-reader-settings button[title="dismiss"]');
   if(close)close.click();
   await until(()=>!document.querySelector('.bs-reader-settings'));
 }
 window.__platformUi=platformUi;
 document.querySelector('.bs-cover').click();
 await until(()=>document.querySelector('.bs-epub-frame'));
 await wait(1200);
};
window.remountShelf=()=>{ReactDOM.flushSync(()=>root.render(null));showShelf();};
window.discussDirect=async()=>{
 const button=document.querySelector('button[title="discussPage"]');if(!button)throw Error('missing discuss');
 ReactDOM.flushSync(()=>button.click());
 await until(()=>openCalls.length>=2);
 await until(()=>document.getElementById('sidebar').textContent.length>0);
 await until(()=>draftWrites.length>=2);
 return {createCalls,commandCalls,openCalls,openedKinds,draftWrites,snapshot:sessions[openCalls[1]]?.snapshot};
};
window.discuss=async()=>{
 const button=document.querySelector('button[title="discussPage"]');if(!button)throw Error('missing discuss');
 ReactDOM.flushSync(()=>button.click());
 await until(()=>document.querySelector('.bs-discussion-dialog'));
 const select=document.querySelector('.bs-discussion-workspace select');if(!select)throw Error('missing workspace select');
 Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'ws-1');
 select.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(80);
 const create=[...document.querySelectorAll('.bs-discussion-dialog button')].find(b=>b.textContent==='discussionCreate');
 if(!create)throw Error('missing create button');
 await until(()=>!create.disabled);
 ReactDOM.flushSync(()=>create.click());
 await until(()=>draftWrites.length>0);
 await until(()=>openedKinds.length>0);
 await until(()=>document.getElementById('sidebar').textContent.length>0);
 return {sessions,createCalls,commandCalls,openCalls,openedKinds,draftWrites,snapshot:sessions[openCalls[0]]?.snapshot};
};
Object.assign(window,{sessions,createCalls,commandCalls,openCalls,openedKinds,draftWrites});
window.diagnostics=()=>({createCalls,commandCalls,openCalls,openedKinds,draftWrites,mounted:mounted.value,errors,
 root:document.getElementById('root').textContent,sidebar:document.getElementById('sidebar').textContent,
 dialog:document.querySelector('.bs-discussion-dialog')?.textContent||'',header:Boolean(booksState.header),tab:Boolean(booksState.tab),panel:Boolean(shelfCtxState.panel)});
</script></body></html>`

try {
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://test').pathname
      const files = {
        '/react.js': join(fixtures, 'node_modules/react/umd/react.development.js'),
        '/react-dom.js': join(fixtures, 'node_modules/react-dom/umd/react-dom.development.js'),
        '/shelf-client.js': join(pluginDir, 'client.js'),
      }
      if (path === '/test.html') { res.setHeader('content-type', 'text/html'); res.end(page); return }
      if (files[path]) { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(files[path])); return }
      await route.handler(req, res)
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const archive = zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">handoff</dc:identifier><dc:title>Handoff</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>'),
    'one.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Handoff</title></head><body><h1>Chapter One</h1><p>The visible page begins here. This exact sentence must cross into the conversation unchanged.</p><p>Second paragraph keeps its reading order.</p></body></html>'),
  })
  const imported = await fetch(`${origin}/bookshelf/api/books?name=handoff.epub&title=Handoff&format=epub`, { method: 'POST', body: archive })
  assert.equal(imported.status, 201)
  const { book } = await imported.json()
  await fetch(`${origin}/bookshelf/api/books/${book.id}/state`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { pageMode: 'paged', pageSpread: 'single' } }) })
  const source = await fetch(`${origin}/bookshelf/api/books/${book.id}/file`)
  assert.ok(source.headers.get('x-bookshelf-source-revision')?.startsWith('shelf-file-v1:'), 'Host exposes the source revision')

  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0', '--window-size=1500,1000', `${origin}/test.html`], { stdio: ['ignore', 'ignore', 'pipe'] })
  const browserUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 10000)
    let log = ''
    chrome.once('error', error => { clearTimeout(timer); reject(error) })
    chrome.stderr.on('data', chunk => { log += chunk; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
  })
  const targets = await (await fetch(`http://${new URL(browserUrl).host}/json`)).json()
  const target = targets.find(value => value.url === `${origin}/test.html`)
  assert.ok(target)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  async function command(method, params) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(new Error(`CDP timeout: ${method}`)) }, 45000)
      const listener = event => { const message = JSON.parse(event.data); if (message.id !== id) return; clearTimeout(timer); socket.removeEventListener('message', listener)
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails))); else resolve(message.result) }
      socket.addEventListener('message', listener)
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  const evaluate = async expression => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value
  const start = Date.now()
  while (!(await evaluate('Boolean(window.ready)'))) { assert.ok(Date.now() - start < 10000, 'fixture page booted'); await new Promise(resolve => setTimeout(resolve, 100)) }
  await evaluate('window.ready()')
  const platformUi = await evaluate('window.__platformUi')
  assert.equal(platformUi.caps.platform, process.platform)
  assert.equal(platformUi.caps.appleBooks, process.platform === 'darwin')
  if (process.platform === 'darwin') {
    assert.equal(platformUi.initial, true, 'macOS shows the Apple Books import button by default')
    assert.equal(platformUi.disabled, true, 'turning the macOS import toggle off hides the button')
    assert.equal(platformUi.enabled, true, 'turning it back on restores the button')
  } else {
    assert.equal(platformUi.initial, false, 'non-macOS hides the Apple Books button')
  }
  const visible = await evaluate(`(()=>{const d=document.querySelector('.bs-epub-frame').contentDocument;return d.body.innerText})()`)
  assert.match(visible, /The visible page begins here/)
  let result
  try { result = await evaluate('window.discuss()') }
  catch (error) { console.log('DIAGNOSTICS', JSON.stringify(await evaluate('window.diagnostics()'), null, 2)); throw error }
  assert.equal(result.createCalls.length, 1)
  assert.equal(result.createCalls[0].workspaceId, 'ws-1')
  assert.match(result.createCalls[0].sessionId, /^[0-9a-f-]{36}$/)
  assert.equal(result.commandCalls.length, 1)
  const snapshot = result.commandCalls[0].payload.snapshot
  assert.equal(result.commandCalls[0].payload.action, 'prepare')
  assert.equal(snapshot.sourceRevision.startsWith('shelf-file-v1:'), true)
  assert.match(snapshot.text, /The visible page begins here/)
  assert.match(snapshot.text, /Second paragraph keeps its reading order/)
  assert.equal(snapshot.coordinateKind, 'rendered-dom-text')
  assert.equal(snapshot.bookId, book.id)
  assert.equal(result.openCalls[0], result.createCalls[0].sessionId)
  const file = { path: `.dsh-bookshelf/${snapshot.snapshotId}.md`, mention: `@.dsh-bookshelf/${snapshot.snapshotId}.md`, label: 'Handoff · 1 / 1' }
  assert.equal(result.draftWrites.length, 1, 'the page file is placed in the new composer exactly once')
  const prefix = 'discussionPromptPrefix'
  assert.equal(result.draftWrites[0].text, prefix + file.mention + '\n\n')
  assert.deepEqual(result.draftWrites[0].references, [{ source: 'reference', ref: file.mention, label: file.label,
    appearance: 'file', clipboardText: file.mention, offset: prefix.length, length: file.mention.length }])
  const persisted = await evaluate(`(()=>{const raw=localStorage.getItem('dsh.conversation.${result.openCalls[0]}');return raw?JSON.parse(raw):null})()`)
  const persistedPrefix = 'discussionPromptPrefix'
  assert.equal(persisted?.draft?.text, persistedPrefix + file.mention + '\n\n', 'the prompt draft is written before the session opens')
  assert.deepEqual(persisted?.draft?.references, [{ source: 'reference', ref: file.mention, label: file.label,
    appearance: 'file', clipboardText: file.mention, offset: persistedPrefix.length, length: file.mention.length }])
  assert.deepEqual(result.openedKinds, ['bookshelf-reader'])
  assert.equal(await evaluate(`document.getElementById('sidebar').textContent.includes(${JSON.stringify(snapshot.text)})`), true,
    'Books shows the same immutable text without re-reading the page')
  assert.equal(await evaluate(`document.getElementById('native-marker').textContent`), `native:${result.createCalls[0].sessionId}`)
  assert.equal(await evaluate(`[...document.querySelectorAll('#root button')].some(b=>b.textContent==='sidebarOpen')`), true)
  await evaluate(`(()=>{const b=[...document.querySelectorAll('#sidebar button')].find(b=>b.textContent==='sidebarResume');if(!b)throw Error('missing resume');b.click()})()`)
  await evaluate('until(()=>document.querySelector(".bs-epub-frame"))')
  assert.equal(await evaluate(`document.getElementById('sidebar').textContent`), '', 'Books panel closes when leaving the conversation')
  // A saved preset workspace makes the same button jump straight to a new conversation.
  await evaluate(`(()=>{localStorage.setItem('bookshelf.discussion.workspace.v1','ws-1');window.remountShelf()})()`)
  await evaluate('until(()=>document.querySelector(".bs-epub-frame"))')
  await evaluate('wait(1200)')
  const direct = await evaluate('window.discussDirect()')
  assert.equal(direct.createCalls.length, 2)
  assert.equal(direct.commandCalls[1].payload.action, 'prepare')
  assert.equal(direct.openCalls[1], direct.createCalls[1].sessionId)
  assert.ok(direct.draftWrites.length >= 2)
  assert.match(direct.draftWrites[1].text, /@\.dsh-bookshelf\//)
  assert.equal(await evaluate(`document.querySelector('.bs-discussion-dialog') === null`), true, 'the workspace chooser was skipped')
  const directDraft = await evaluate(`(()=>{const raw=localStorage.getItem('dsh.conversation.${direct.openCalls[1]}');return raw?JSON.parse(raw):null})()`)
  assert.match(directDraft?.draft?.text || '', /@\.dsh-bookshelf\//, 'the direct flow persists its prompt draft')
  assert.equal(await evaluate(`document.getElementById('sidebar').textContent.includes(${JSON.stringify(direct.snapshot.text)})`), true)
  assert.deepEqual(await evaluate('errors'), [])
  console.log(JSON.stringify({ snapshotId: snapshot.snapshotId, text: snapshot.text, sourceRevision: snapshot.sourceRevision, workspace: result.createCalls[0].workspaceId, booksAutoOpened: true, returnToShelf: true, errors: [] }, null, 2))
  console.log('PASS: isolated bookshelf -> native conversation -> static Books handoff')
} finally {
  socket?.close()
  if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill('SIGTERM'); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]) }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  assert.equal(await realpath(temporary), ownedPath)
  await rm(ownedPath, { recursive: true, force: true })
}
