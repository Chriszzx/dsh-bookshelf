// Functional browser regression for read-aloud: the reader walks the chapter
// into sentences, the Host returns audio (fake `say` here), the player follows
// the text, turns pages and moves into the next chapter, and pause/next/close
// behave. No real speech service is contacted.
// Run: node tests/tts-playback.mjs (needs Chrome and React UMD fixtures).
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
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-tts-playback-'))
process.env.DSH_HOME = join(temporary, 'home')
const { apply } = await import(pathToFileURL(join(pluginDir, 'index.js')).href)
let route, chrome, socket, server
const calls = { synthesize: 0, settings: 0 }

const spoken = []

function makeRun() {
  return async (command, args) => {
    if (args[0] === '-v' && args[1] === '?') {
      return { stdout: 'Tingting (中文（中国大陆）)     zh_CN    # 你好！我叫婷婷。\nMeijia (中文（台湾）)  zh_TW  # 你好，我叫美佳。\nSamantha (English (US))  en_US  # Hello.\nReed (德语（德国）)  de_DE  # Hallo.\n' }
    }
    const voiceIndex = args.indexOf('-v')
    spoken.push(voiceIndex === -1 ? '' : String(args[voiceIndex + 1]))
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
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:22222222-2222-4222-8222-222222222222</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test</dc:creator><dc:language>${language}</dc:language></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`
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
// Fake media: record calls and finish quickly so the queue advances.
window.__audio=[];window.__audioMs=260;
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
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<15000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.caption=()=>document.querySelector('.bs-tts-caption-text')?.textContent||'';
window.barButton=(label)=>document.querySelector('.bs-tts-dock [aria-label="'+label+'"]');
window.barClick=(label)=>{const node=barButton(label);if(!node)throw Error('missing menu button '+label+' menu='+Boolean(document.querySelector('.bs-tts-dock'))+' caption='+caption());node.click()};
window.openBook=async(title)=>{const card=[...document.querySelectorAll('.bs-card')].find(node=>node.querySelector('.bs-book-title')?.textContent===title);check(!!card,'book card '+title);card.querySelector('.bs-cover').click();await until(()=>document.querySelector('.bs-reader'))};
window.openTts=async()=>{if(!document.querySelector('.bs-tts-dock')){document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click()}await until(()=>document.querySelector('.bs-tts-dock'))};
window.startReading=async()=>{await openTts();await until(()=>barButton('ttsPlay')||barButton('ttsPause'));if(barButton('ttsPlay'))barClick('ttsPlay')};
window.audioEvents=(type)=>window.__audio.filter(item=>!type||item.type===type);
mount();
</script></body></html>`

try {
  const { fixtures, chromePath } = await prepareBrowserEnvironment(temporary, { books: true })
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://test').pathname
      if (path === '/bookshelf/api/tts/synthesize' && req.method === 'POST') calls.synthesize += 1
      if (path === '/bookshelf/api/tts/settings' && req.method === 'PUT') calls.settings += 1
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

  // Two chapters of three sentences each, plus the five-page PDF fixture.
  const epubResponse = await fetch(`${api}/books?name=tts.epub&title=Speech&format=epub`, {
    method: 'POST',
    body: epubBytes('Speech', [
      ['第一章第一句话。', '第一章第二句话。', '第一章第三句话。'],
      ['第二章第一句话。', '第二章第二句话。', '第二章第三句话。', '第二章第四句话。'],
    ]),
  })
  assert.equal(epubResponse.status, 201)
  const englishResponse = await fetch(`${api}/books?name=english.epub&title=English&format=epub`, {
    method: 'POST',
    body: epubBytes('English', [['The first English sentence.', 'The second English sentence.']], 'en'),
  })
  assert.equal(englishResponse.status, 201)
  const longResponse = await fetch(`${api}/books?name=long.epub&title=Long&format=epub`, {
    method: 'POST',
    body: epubBytes('Long', [Array.from({ length: 120 }, (_, index) => `Paragraph ${index} keeps the paged layout stable and gives read-aloud enough sentences to cross pages.`) ]),
  })
  assert.equal(longResponse.status, 201)
  const pdfResponse = await fetch(`${api}/books?name=mixed.pdf&title=Mixed&format=pdf`, {
    method: 'POST',
    body: await readFile(join(fixtures, 'mixed.pdf')),
  })
  assert.equal(pdfResponse.status, 201)

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

  // EPUB: every sentence plays in order and the reader continues into chapter 2.
  assert.equal(await evaluate(`(async()=>{
    await until(()=>document.querySelectorAll('.bs-card').length===4);
    await openBook('Speech');
    await until(()=>document.querySelector('.bs-epub-frame'));
    window.__caps=[];
    const poll=setInterval(()=>{const value=caption();if(value&&window.__caps[window.__caps.length-1]!==value)window.__caps.push(value)},12);
    // Opening read-aloud must select the sentence immediately: the highlight and
    // preview may not wait for the first audio request.
    const playsBefore=window.audioEvents('play').length;
    document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click();
    await until(()=>document.querySelector('.bs-tts-dock'));
    await until(()=>caption().length>0);
    window.__preview=caption();
    const previewFrame=document.querySelector('.bs-epub-frame');
    await until(()=>previewFrame.contentDocument.querySelector('[data-bb-glass-band]'));
    await wait(200);
    check(window.audioEvents('play').length===playsBefore,'preview must not play audio');
    check(!!document.querySelector('.bs-tts-caption'),'preview card appears before play');
    await startReading();
    await until(()=>window.__caps[0]===window.__preview);
    await until(()=>window.__caps.includes('第二章第一句话。'));
    clearInterval(poll);
    const seen=window.__caps;
    for(const expected of ['第一章第一句话。','第一章第二句话。','第一章第三句话。','第二章第一句话。']){
      check(seen.includes(expected),'missing caption '+expected+': '+seen.join(','));
    }
    check(seen.indexOf('第一章第三句话。')<seen.indexOf('第二章第一句话。'),'chapter order: '+seen.join(','));
    check(document.querySelector('.bs-reader-sub').textContent.includes('chapterOf(current=2,total=2)'),'advanced to chapter 2');
    const everything=window.audioEvents('src').map(item=>item.value);
    check(everything.some(value=>value.startsWith('data:audio/wav')),'a silent clip unlocks playback inside the click');
    const sources=everything.filter(value=>!value.startsWith('data:'));
    check(sources.length>0,'audio src was set');
    check(sources.every(value=>value.includes('/bookshelf/api/tts/audio/')),'audio served from the cache route: '+sources[0]);
    check(sources.every(value=>!value.startsWith('blob:')),'blob media is blocked by the app CSP: '+sources[0]);
    return true;
  })()`), true)

  // The page theme must follow DSH desktop: "follow" mirrors the live scheme,
  // and the pinned Light/Dark options use the DSH palettes themselves instead of
  // an approximation of them.
  assert.equal(await evaluate(`(async()=>{
    const style=document.createElement('style');
    style.id='dsh-tokens';
    style.textContent='body{--dsw-static-neutral-bluish-00:#ffffff;--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00);--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#61666b;--dsw-alias-border-l1:rgba(0,0,0,.1);--dsw-alias-brand-primary:#0f1115;--dsw-alias-bg-layer-2:#f1f3f5}body[data-ds-dark-theme]{--dsw-static-neutral-bluish-00:#151517;--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00);--dsw-alias-label-primary:#f9fafb;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-border-l1:rgba(255,255,255,.12);--dsw-alias-brand-primary:#f9fafb;--dsw-alias-bg-layer-2:#232324}';
    document.head.append(style);
    const frame=document.querySelector('.bs-epub-frame');
    const root=frame.contentDocument.documentElement;
    const value=(name)=>root.style.getPropertyValue(name);
    const scheme=()=>value('--bb-scheme');
    document.body.setAttribute('data-ds-dark-theme','');
    await until(()=>scheme()==='dark');
    check(value('--bb-fg')==='#f9fafb','follow mode must use the DSH dark text: '+value('--bb-fg'));
    check(value('--bb-bg')==='#151517','follow mode must use the DSH dark surface: '+value('--bb-bg'));
    document.querySelector('.bs-reader-bar [aria-label="readingSettings"]').click();
    await until(()=>document.querySelector('.bs-reader-settings'));
    const pick=(label)=>{const node=[...document.querySelectorAll('.bs-reader-settings button')].find(item=>item.textContent===label);check(!!node,'theme option '+label);node.click()};
    pick('themeLight');
    await until(()=>scheme()==='light');
    check(value('--bb-fg')==='#0f1115','pinned light must use the DSH light text: '+value('--bb-fg'));
    check(value('--bb-bg')==='#ffffff','pinned light must use the DSH light surface: '+value('--bb-bg'));
    pick('themeDark');
    await until(()=>scheme()==='dark');
    check(value('--bb-fg')==='#f9fafb','pinned dark must use the DSH dark text: '+value('--bb-fg'));
    pick('themeAuto');
    await until(()=>scheme()==='dark');
    document.body.removeAttribute('data-ds-dark-theme');
    await until(()=>scheme()==='light');
    check(value('--bb-fg')==='#0f1115','follow mode must track DSH back to light: '+value('--bb-fg'));
    document.querySelector('.bs-reader-bar [aria-label="readingSettings"]').click();
    await until(()=>!document.querySelector('.bs-reader-settings'));
    style.remove();
    return true;
  })()`), true)

  // Selecting text opens the reader's own context menu. Before this change the
  // reader had no contextmenu handler, so right-click fell through to the
  // desktop menu whose only action was Copy.
  assert.equal(await evaluate(`(async()=>{
    window.__audioMs=120;
    window.__clipped=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__clipped.push(text)}}});
    const SENTENCE='第二章第一句话。';
    const current=()=>{
      const frame=document.querySelector('.bs-epub-frame');
      check(!!frame,'reader frame present');
      return {frame,document:frame.contentDocument,window:frame.contentWindow};
    };
    const selectSentence=()=>{
      const targets=current();
      const walker=targets.document.createTreeWalker(targets.document.body,NodeFilter.SHOW_TEXT);
      let node=null;
      while((node=walker.nextNode())){ if((node.nodeValue||'').includes('第二章第一句话')) break }
      check(!!node,'chapter text present');
      const offset=node.nodeValue.indexOf(SENTENCE);
      const range=targets.document.createRange();
      range.setStart(node,offset);
      range.setEnd(node,offset+SENTENCE.length);
      const selection=targets.window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return {node,range,window:targets.window};
    };
    const openMenu=()=>{
      const target=selectSentence();
      const box=target.range.getBoundingClientRect();
      const event=new target.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+4,clientY:box.top+4});
      target.node.parentElement.dispatchEvent(event);
      return event;
    };
    const items=()=>[...document.querySelectorAll('.bs-selection-menu .bs-selection-item')];
    const clickItem=(label)=>{
      const item=items().find(node=>node.textContent===label);
      check(!!item,'menu item '+label+': '+items().map(node=>node.textContent).join('|'));
      item.click();
    };
    const event=openMenu();
    check(event.defaultPrevented===true,'the reader must own the selection menu');
    await until(()=>document.querySelector('.bs-selection-menu'));
    const menu=document.querySelector('.bs-selection-menu');
    check(menu.getAttribute('role')==='menu','menu role');
    for(const label of ['selectionCopy','selectionCopyCite','selectionSpeak','selectionHighlight','selectionUnderline']){
      check(items().some(node=>node.textContent===label),'missing menu item '+label+': '+items().map(node=>node.textContent).join('|'));
    }
    check(!items().some(node=>node.textContent==='selectionSelectAll'),'select-all item removed: '+items().map(node=>node.textContent).join('|'));
    const host=document.querySelector('.bs-epub-body').getBoundingClientRect();
    const menuRect=menu.getBoundingClientRect();
    check(menuRect.width>0&&menuRect.height>0,'menu is visible');
    check(menuRect.left>=host.left-1&&menuRect.top>=host.top-1,'menu stays inside the reading area');
    clickItem('selectionCopy');
    await until(()=>window.__clipped.length>0);
    check(window.__clipped[0]===SENTENCE,'copy keeps the selection: '+window.__clipped[0]);
    await until(()=>!document.querySelector('.bs-selection-menu'));
    openMenu();
    await until(()=>document.querySelector('.bs-selection-menu'));
    clickItem('selectionCopyCite');
    await until(()=>window.__clipped.length>1);
    check(window.__clipped[1].includes(SENTENCE),'cite copy keeps the text');
    check(window.__clipped[1].includes('Speech'),'cite copy names the book: '+window.__clipped[1]);
    await until(()=>!document.querySelector('.bs-selection-menu'));
    openMenu();
    await until(()=>document.querySelector('.bs-selection-menu'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await until(()=>!document.querySelector('.bs-selection-menu'));
    const chapterBefore=document.querySelector('.bs-reader-sub').textContent;
    const plays=window.audioEvents('play').length;
    openMenu();
    await until(()=>document.querySelector('.bs-selection-menu'));
    clickItem('selectionSpeak');
    await until(()=>window.audioEvents('play').length>plays);
    await until(()=>caption().includes('第二章第一句话'));
    check(document.querySelector('.bs-reader-sub').textContent===chapterBefore,'reading a selection must not follow the page');
    openMenu();
    await until(()=>document.querySelector('.bs-selection-menu'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await until(()=>!document.querySelector('.bs-selection-menu'));
    const cleared=current();
    const rest=cleared.window.getSelection();
    if(rest)rest.removeAllRanges();
    const plain=new cleared.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true});
    cleared.document.body.dispatchEvent(plain);
    await wait(200);
    check(!document.querySelector('.bs-selection-menu'),'no menu without a selection');
    check(plain.defaultPrevented===false,'plain right-click keeps the desktop menu');
    window.__audioMs=260;
    return true;
  })()`), true)

  // The Chinese book picked a Chinese system voice, never the German locale
  // of a shared voice name.
  assert.ok(spoken.some(voice => voice.includes('Tingting')), 'zh book uses a zh voice: ' + spoken.slice(0, 4).join(','))
  assert.ok(!spoken.some(voice => voice.includes('Reed')), 'no silent German fallback: ' + spoken.slice(0, 4).join(','))

  // The in-reader panel used to reset its draft on every render, so every
  // change snapped back to the saved settings.
  assert.equal(await evaluate(`(async()=>{
    if(!document.querySelector('.bs-tts-dock')){
      document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click();
      await until(()=>document.querySelector('.bs-tts-dock'));
    }
    await until(()=>document.querySelector('.bs-tts-voice'));
    const voiceButton=document.querySelector('.bs-tts-voice');
    voiceButton.click();
    await until(()=>document.querySelector('.bs-tts-settings'));
    const providerSelect=document.querySelector('.bs-tts-settings select[aria-label="ttsProvider"]');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    setter.call(providerSelect,'edge');providerSelect.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(400);
    check(providerSelect.value==='edge','provider change sticks: '+providerSelect.value);
    const voiceSelect=document.querySelector('.bs-tts-settings select[aria-label="ttsVoice"]');
    check(!!voiceSelect,'edge voice select appears');
    const option=[...voiceSelect.options].find(item=>item.value.includes('en-US'))||voiceSelect.options[1];
    setter.call(voiceSelect,option.value);voiceSelect.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(400);
    check(voiceSelect.value===option.value,'voice change sticks: '+voiceSelect.value);
    const cancel=[...document.querySelectorAll('.bs-tts-settings button')].find(node=>node.textContent==='cancel');
    check(!!cancel,'cancel button: '+[...document.querySelectorAll('.bs-tts-settings button')].map(node=>node.textContent).join('|'));
    cancel.click();
    await until(()=>!document.querySelector('.bs-tts-settings'));
    return true;
  })()`), true)

  // Pause stops the audio element and resumes it; next skips a sentence.
  assert.equal(await evaluate(`(async()=>{
    // Slow the fake player and restart the queue so this block cannot race the
    // end of the previous one.
    window.__audioMs=2000;
    if(document.querySelector('.bs-tts-dock')){
      barClick('dismiss');
      await until(()=>!document.querySelector('.bs-tts-dock'));
    }
    document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click();
    await until(()=>document.querySelector('.bs-tts-dock'));
    if(!barButton('ttsPause')&&barButton('ttsPlay'))barClick('ttsPlay');
    await until(()=>barButton('ttsPause'));
    barClick('ttsPause');
    await until(()=>window.audioEvents('pause').length>0);
    await wait(80);
    const captionAtPause=caption();
    barClick('ttsPlay');
    await wait(80);
    check(window.audioEvents('play').length>1,'resume must call play again');
    const plays=window.audioEvents('play').length;
    barClick('ttsNext');
    await until(()=>caption()!==captionAtPause);
    await wait(150);
    check(window.audioEvents('play').length===plays,'switching sentences must not auto-play');
    check(!!barButton('ttsPlay'),'switching leaves the queue paused');
    barClick('ttsPlay');
    await until(()=>window.audioEvents('play').length>plays,'play must resume the selected sentence');
    window.__audioMs=260;
    return true;
  })()`), true)

  // Closing the dock stops playback but keeps the last sentence on screen: in
  // paged mode that text is the only reliable position cue. The floating text
  // can be dismissed on its own.
  assert.equal(await evaluate(`(async()=>{
    const before=caption();
    check(before.length>0,'a caption must be visible while playing: '+before);
    barClick('dismiss');
    await until(()=>!document.querySelector('.bs-tts-dock'));
    const shown=document.querySelector('.bs-tts-caption-text');
    check(!!shown,'caption overlay must survive stopping read-aloud');
    check(shown.textContent===before,'stopped caption differs: '+before+' -> '+shown.textContent);
    check(document.querySelector('.bs-tts-caption-label').textContent==='ttsCaptionLast','stopped label');
    const plays=window.audioEvents('play').length;
    await wait(200);
    check(window.audioEvents('play').length===plays,'closing must stop the queue');
    document.querySelector('.bs-tts-caption-close').click();
    await until(()=>!document.querySelector('.bs-tts-caption'));
    check(window.errors.length===0,'console errors: '+window.errors.join(' | '));
    return true;
  })()`), true)

  // Settings: changing speed persists through the Host.
  assert.equal(await evaluate(`(async()=>{
    await startReading();
    await until(()=>document.querySelector('.bs-tts-voice'));
    // The popover lists every provider; cancel it and use the inline speed
    // selector, which persists immediately.
    document.querySelector('.bs-tts-voice').click();
    await until(()=>document.querySelector('.bs-tts-settings'));
    [...document.querySelectorAll('.bs-tts-settings .bs-button')].find(node=>node.textContent==='cancel').click();
    await until(()=>!document.querySelector('.bs-tts-settings'));
    const select=document.querySelector('.bs-tts-dock .bs-tts-speed select');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    setter.call(select,'1.5');select.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(400);
    return true;
  })()`), true)
  assert.ok(calls.settings > 0, 'speed change must persist')
  const saved = await (await fetch(`${api}/tts/settings`)).json()
  assert.equal(saved.settings.speed, 1.5)

  // PDF: reading advances page by page automatically.
  assert.equal(await evaluate(`(async()=>{
    barClick('dismiss');
    await until(()=>!document.querySelector('.bs-tts-dock'));
    document.querySelector('.bs-reader-bar [aria-label="back"]').click();
    await until(()=>document.querySelector('.bs-shelf'));
    await openBook('Mixed');
    await until(()=>document.querySelector('.bs-pdf-page canvas'));
    // PDF has no text layer: the preview shows the sentence in the floating card.
    const pdfPlays=window.audioEvents('play').length;
    document.querySelector('.bs-reader-bar [aria-label="readAloud"]').click();
    await until(()=>document.querySelector('.bs-tts-dock'));
    await until(()=>caption().includes('Generated test page 1'));
    await wait(200);
    check(window.audioEvents('play').length===pdfPlays,'PDF preview must not play audio');
    await startReading();
    await until(()=>caption().includes('Generated test page 1'));
    await until(()=>caption().includes('Generated test page 2'));
    return true;
  })()`), true)

  // An English book switches to an English voice automatically.
  spoken.length = 0
  assert.equal(await evaluate(`(async()=>{
    const dismiss=document.querySelector('.bs-tts-dock [aria-label="dismiss"]');
    if(dismiss)dismiss.click();
    await until(()=>!document.querySelector('.bs-tts-dock'));
    document.querySelector('.bs-reader-bar [aria-label="back"]').click();
    await until(()=>document.querySelector('.bs-shelf'));
    await openBook('English');
    await until(()=>document.querySelector('.bs-epub-frame'));
    await startReading();
    await until(()=>caption().includes('English sentence'));
    return true;
  })()`), true)
  assert.ok(spoken.some(voice => voice.includes('Samantha')), 'en book uses an en voice: ' + spoken.join(','))
  assert.ok(!spoken.some(voice => voice.includes('Tingting')), 'en book does not use the zh voice: ' + spoken.join(','))

  // Turning automatic selection off pins the chosen voice instead.
  await fetch(`${api}/tts/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { autoVoice: false, voice: 'Meijia (中文（台湾）)' } }),
  })
  spoken.length = 0
  assert.equal(await evaluate(`(async()=>{
    document.querySelector('.bs-tts-dock [aria-label="dismiss"]')?.click();
    await until(()=>!document.querySelector('.bs-tts-dock'));
    document.querySelector('.bs-reader-bar [aria-label="back"]').click();
    await until(()=>document.querySelector('.bs-shelf'));
    await openBook('English');
    await until(()=>document.querySelector('.bs-epub-frame'));
    await startReading();
    await until(()=>caption().includes('English sentence'));
    return true;
  })()`), true)
  assert.ok(spoken.length > 0 && spoken.every(voice => voice === 'Meijia (中文（台湾）)'), 'pinned voice wins: ' + spoken.join(','))

  // A chapter long enough to paginate: following the text must only ever move
  // forward, and leaving read-aloud must keep the page the reader is on. The
  // regression this guards snapped back to the previous page on every turn and
  // again when the player closed.
  await fetch(`${api}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pageMode: 'paged' }),
  })
  const pagedDefaults = await (await fetch(`${api}/settings`)).json()
  assert.equal(pagedDefaults.settings.pageMode, 'paged')
  await navigateTestPage(socket, pageUrl)
  await waitForMount()
  await new Promise(resolve => setTimeout(resolve, 600))

  assert.equal(await evaluate(`(async()=>{
    window.__audioMs=60;
    await until(()=>document.querySelector('.bs-shelf'));
    await openBook('Long');
    await until(()=>document.querySelector('.bs-epub-frame'));
    const pageNumber=()=>{
      const label=((document.querySelector('.bs-control-label')||{}).textContent)||'';
      const at=label.indexOf('current=');
      if(at<0)return null;
      const match=/^([0-9]+)/.exec(label.slice(at+8));
      return match?Number(match[1]):null;
    };
    await until(()=>pageNumber()!==null);
    await wait(800);
    // Starting read-aloud used to insert a player bar above the page content.
    // That shrank the paged reading area, re-flowed the columns, and moved the
    // reader forward by a spread. The controls are now a floating menu, so the
    // reading area and the page must stay exactly where they were.
    for(let turn=0;turn<6;turn+=1){
      const next=document.querySelector('button[title="nextPage"]');
      check(!next.disabled,'next page available');
      next.click();
      await wait(120);
    }
    await wait(400);
    const frameHeight=()=>Math.round(document.querySelector('.bs-epub-frame').getBoundingClientRect().height);
    const beforeHeight=frameHeight();
    const beforePage=pageNumber();
    window.__audioMs=6000;
    await startReading();
    await wait(900);
    check(document.querySelector('.bs-tts-dock'),'read-aloud dock is open');
    const layerStyle=getComputedStyle(document.querySelector('.bs-tts-overlay'));
    check(layerStyle.position==='absolute','controls must float above the page');
    const dockStyle=getComputedStyle(document.querySelector('.bs-tts-dock'));
    check(parseFloat(dockStyle.borderTopLeftRadius)>=20,'dock must be a rounded bar');
    check(dockStyle.backdropFilter.includes('blur'),'dock must be frosted glass');
    const frame=document.querySelector('.bs-epub-frame');
    const bands=[...frame.contentDocument.querySelectorAll('[data-bb-glass-band]')];
    check(bands.length>0,'highlight bands cover the sentence');
    check(getComputedStyle(bands[0]).position==='fixed','highlight floats without joining the paged columns');
    const bandStyle=getComputedStyle(bands[0]);
    check(!bandStyle.backdropFilter.includes('blur'),'the words must stay crisp under the marker');
    check(parseFloat(bandStyle.borderTopLeftRadius)>0,'highlight is rounded');
    const rgbParts=bandStyle.backgroundColor.replace(/[^0-9.,]/g,'').split(',');
    const alpha=Number(rgbParts[3]);
    check(Number.isFinite(alpha)&&alpha>0.2&&alpha<=0.7,'marker must stay see-through: '+bandStyle.backgroundColor);
    check(['multiply','screen'].includes(bandStyle.mixBlendMode),'marker blends into the page: '+bandStyle.mixBlendMode);
    const covered=bands.reduce((sum,band)=>sum+band.getBoundingClientRect().width,0);
    check(covered>frame.getBoundingClientRect().width*0.5,'highlight covers the whole sentence, not just its opening');
    const preview=document.querySelector('.bs-tts-caption');
    check(!!preview&&preview.getBoundingClientRect().width>0,'floating preview card stays visible next to the marker');
    check(document.querySelector('.bs-tts-caption-label').textContent==='ttsCaptionNow','preview label');
    check(frameHeight()===beforeHeight,'read-aloud menu resized the reading area: '+beforeHeight+' -> '+frameHeight());
    check(pageNumber()===beforePage,'starting read-aloud moved the page: '+beforePage+' -> '+pageNumber());
    barClick('dismiss');
    await until(()=>!document.querySelector('.bs-tts-dock'));
    await wait(500);
    check(frameHeight()===beforeHeight,'closing read-aloud resized the reading area');
    check(pageNumber()===beforePage,'closing read-aloud moved the page: '+beforePage+' -> '+pageNumber());
    window.__audioMs=60;
    window.__pages=[];
    const poll=setInterval(()=>{
      const page=pageNumber();
      if(page===null)return;
      if(window.__pages[window.__pages.length-1]!==page)window.__pages.push(page);
    },15);
    await startReading();
    await until(()=>window.__pages.length>=2);
    await wait(500);
    clearInterval(poll);
    const pages=window.__pages.slice();
    for(let index=1;index<pages.length;index+=1){
      check(pages[index]>=pages[index-1],'read-aloud went back: '+pages.join(','));
    }
    const beforeClose=pageNumber();
    barClick('dismiss');
    await until(()=>!document.querySelector('.bs-tts-dock'));
    await wait(700);
    check(pageNumber()===beforeClose,'closing read-aloud moved the page: '+beforeClose+' -> '+pageNumber());
    return true;
  })()`), true)

  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('read aloud: sentence queue, chapter advance, pause/next, settings, PDF page turn')
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
