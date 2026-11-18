// The shelf settings window: tabs for reading, read-aloud and other options.
// Verifies that read-aloud is configurable without opening a book, and that the
// existing reading settings still persist from the new dialog.
// Run: node tests/settings-dialog.mjs (needs Chrome and React UMD fixtures).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { prepareBrowserEnvironment, browserLaunchArgs, navigateTestPage } from './helpers/browser-env.mjs'

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-settings-dialog-'))
process.env.DSH_HOME = join(temporary, 'home')
import { applyTestHost as apply } from './helpers/host-context.mjs'
let route, chrome, socket, server
const calls = { settings: 0, ttsSettings: 0, cacheClear: 0 }
let hangSynthesize = false

function makeRun() {
  return async (command, args) => {
    if (args[0] === '-v' && args[1] === '?') {
      return { stdout: 'Tingting (中文（中国大陆）)     zh_CN    # 你好！我叫婷婷。\nMeijia (中文（台湾）)  zh_TW  # 你好，我叫美佳。\n' }
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
window.until=async(fn)=>{const start=Date.now();while(Date.now()-start<20000){if(fn())return;await wait(40)}throw Error('Timed out: '+fn)};
window.check=(condition,message)=>{if(!condition)throw Error(message)};
window.dialog=()=>document.querySelector('.bs-settings-dialog');
window.tab=(label)=>[...document.querySelectorAll('.bs-settings-tab')].find(node=>node.textContent===label);
window.choose=(label,value)=>{const select=document.querySelector('select[aria-label="'+label+'"]');check(!!select,'select '+label);const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;setter.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}))};
window.openSettings=async()=>{document.querySelector('[aria-label="shelfSettings"]').click();await until(()=>dialog())};
window.closeSettings=async()=>{document.querySelector('.bs-settings-dialog [aria-label="dismiss"]').click();await until(()=>!dialog())};
mount();
</script></body></html>`

try {
  const { fixtures, chromePath } = await prepareBrowserEnvironment(temporary)
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://test').pathname
      if (path === '/bookshelf/api/settings' && req.method === 'PUT') calls.settings += 1
      if (path === '/bookshelf/api/tts/settings' && req.method === 'PUT') calls.ttsSettings += 1
      if (path === '/bookshelf/api/tts/cache' && req.method === 'DELETE') calls.cacheClear += 1
      if (hangSynthesize && path === '/bookshelf/api/tts/synthesize') return
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
  await fetch(`${api}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fontFamily: 'serif', fontSize: 15, pageMode: 'paged' }),
  })
  // One synthesised sentence so the cache panel has something to clear.
  const seededAudio = await fetch(`${api}/tts/synthesize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'macos', voice: 'Tingting', text: '缓存测试。', speed: 1 }),
  })
  assert.equal(seededAudio.status, 200)

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

  // The settings window opens with three tabs and starts on reading.
  assert.equal(await evaluate(`(async()=>{
    await openSettings();
    const tabs=[...document.querySelectorAll('.bs-settings-tab')].map(node=>node.textContent);
    check(tabs.join(',')==='settingsTabReading,settingsTabSpeech,settingsTabOther','tabs: '+tabs.join(','));
    check(tab('settingsTabReading').getAttribute('aria-selected')==='true','reading tab selected');
    check(!!document.querySelector('select[aria-label="fontFamily"]'),'reading controls are present');
    return true;
  })()`), true)

  // Reading settings still persist from the dialog.
  await evaluate(`(async()=>{choose('fontFamily','preset:mono');await wait(600)})()`)
  assert.ok(calls.settings > 0, 'font choice must save')
  const savedDefaults = await (await fetch(`${api}/settings`)).json()
  assert.equal(savedDefaults.settings.fontFamily, 'mono')

  // Read-aloud is configurable here without opening a book.
  assert.equal(await evaluate(`(async()=>{
    tab('settingsTabSpeech').click();
    await until(()=>document.querySelector('.bs-tts-settings') || document.querySelector('.bs-settings-body .bs-tts-field'));
    await until(()=>[...document.querySelectorAll('.bs-settings-body select')].some(node=>[...node.options].some(option=>option.value==='deepseek')));
    const providers=[...document.querySelectorAll('.bs-settings-body select')][0];
    check(providers.value==='macos','default provider is the local voice: '+providers.value);
    const openaiOption=[...providers.options].find(option=>option.value==='openai');
    check(!!openaiOption,'openai option available');
    check(!openaiOption.disabled,'openai option must stay selectable before it is configured');
    const unavailable=[...providers.options].filter(option=>option.disabled).map(option=>option.value);
    check(unavailable.join(',')==='windows','only the foreign-OS engine is disabled: '+unavailable.join(','));
    check([...providers.options].filter(option=>!option.disabled).length>=5,'cloud and local providers stay selectable');
    const ids=[...providers.options].map(option=>option.value);
    for(const expected of ['macos','windows','edge','deepseek','openai','local']){
      check(ids.includes(expected),'provider '+expected+' listed: '+ids.join(','));
    }
    check(!!document.querySelector('.bs-settings-cache'),'cache row is shown');
    const voiceSelect=document.querySelector('select[aria-label="ttsVoice"]');
    check(!!voiceSelect,'voice select is present');
    check(voiceSelect.options[0].value===''&&voiceSelect.options[0].textContent==='ttsVoiceAuto','automatic voice is the first option: '+[...voiceSelect.options].map(o=>o.value).join(','));
    check(voiceSelect.value==='','automatic language selection is the default');
    check(voiceSelect.options.length===3,'two host voices plus automatic: '+voiceSelect.options.length);
    const languageFilter=document.querySelector('select[aria-label="ttsLanguage"]');
    check(!!languageFilter,'language filter for multi-locale voices');
    // Choosing a concrete voice pins it (and must not snap back to automatic).
    const voiceSetter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    const manual=voiceSelect.options[1].value;
    voiceSetter.call(voiceSelect,manual);voiceSelect.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(400);
    check(voiceSelect.value===manual,'manual voice sticks: '+voiceSelect.value);
    return true;
  })()`), true)

  // The Windows engine is advertised but not selectable on macOS; Edge and the
  // local placeholder are, and the placeholder reports that it cannot speak.
  assert.equal(await evaluate(`(async()=>{
    const providerSelect=[...document.querySelectorAll('.bs-settings-body select')][0];
    const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    const chooseProvider=(value)=>{setter.call(providerSelect,value);providerSelect.dispatchEvent(new Event('change',{bubbles:true}))};
    const windowsOption=[...providerSelect.options].find(option=>option.value==='windows');
    check(windowsOption.disabled,'windows provider is disabled on macOS');
    chooseProvider('edge');
    await until(()=>[...document.querySelectorAll('.bs-settings-body select')].some(node=>node.getAttribute('aria-label')==='ttsVoice'));
    const edgeVoices=[...document.querySelectorAll('.bs-settings-body select')].find(node=>node.getAttribute('aria-label')==='ttsVoice');
    check(edgeVoices.options.length>5,'edge voices listed: '+edgeVoices.options.length);
    chooseProvider('local');
    await until(()=>[...document.querySelectorAll('.bs-settings-body input')].length>=3);
    [...document.querySelectorAll('.bs-settings-foot button')].find(node=>node.textContent==='ttsTest').click();
    await until(()=>(document.querySelector('.bs-rename-error')||{}).textContent);
    check(document.querySelector('.bs-rename-error').textContent.includes('尚未实现'),'local placeholder reports it is not implemented');
    chooseProvider('openai');
    await until(()=>[...document.querySelectorAll('.bs-settings-body input[type="url"]')].length>0);
    return true;
  })()`), true)

  // Choosing another provider shows its fields; saving persists.
  assert.equal(await evaluate(`(async()=>{
    const providerSelect=[...document.querySelectorAll('.bs-settings-body select')][0];
    const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    setter.call(providerSelect,'openai');providerSelect.dispatchEvent(new Event('change',{bubbles:true}));
    await until(()=>[...document.querySelectorAll('.bs-settings-body input[type="url"]')].length>0);
    // Quick setup fills the base URL and model for a known service.
    const preset=document.querySelector('.bs-settings-body select[aria-label="ttsPreset"]')||[...document.querySelectorAll('.bs-settings-body select')].find(node=>[...node.options].some(option=>option.value==='siliconflow'));
    check(!!preset,'quick setup select');
    const presetSetter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    presetSetter.call(preset,'siliconflow');preset.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(150);
    const urlValue=document.querySelector('.bs-settings-body input[type="url"]').value;
    check(urlValue==='https://api.siliconflow.cn/v1','preset filled base url: '+urlValue);
    const urlInput=document.querySelector('.bs-settings-body input[type="url"]');
    const inputSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    inputSetter.call(urlInput,'https://api.siliconflow.cn/v1');urlInput.dispatchEvent(new Event('input',{bubbles:true}));
    [...document.querySelectorAll('.bs-settings-footer button, .bs-settings-foot button')].find(node=>node.textContent==='settingsSaveSpeech').click();
    await until(()=>document.querySelector('.bs-settings-notice'));
    return true;
  })()`), true)
  assert.ok(calls.ttsSettings > 0, 'read-aloud settings must save')
  const ttsSettings = await (await fetch(`${api}/tts/settings`)).json()
  assert.equal(ttsSettings.settings.provider, 'openai')
  assert.equal(ttsSettings.settings.autoVoice, false, 'picking a manual voice turns automatic off')
  assert.equal(ttsSettings.settings.openai.baseUrl, 'https://api.siliconflow.cn/v1')

  // The cache can be cleared from the same tab.
  assert.equal(await evaluate(`(async()=>{
    [...document.querySelectorAll('.bs-settings-cache button')].find(node=>node.textContent==='ttsCacheClear').click();
    await wait(400);
    return true;
  })()`), true)
  assert.ok(calls.cacheClear > 0, 'cache clear must reach the Host')

  // A stuck speech service must abort the test button instead of hanging.
  hangSynthesize = true
  assert.equal(await evaluate(`(async()=>{
    await closeSettings();
    await openSettings();
    tab('settingsTabSpeech').click();
    await until(()=>document.querySelector('select[aria-label="ttsProvider"]'));
    const button=[...document.querySelectorAll('.bs-settings-foot button')].find(node=>node.textContent==='ttsTest');
    check(!!button,'test button');
    const startedAt=Date.now();
    button.click();
    await until(()=>document.querySelector('.bs-rename-error'));
    const elapsed=Date.now()-startedAt;
    const text=document.querySelector('.bs-rename-error').textContent;
    check(text.includes('ttsTimeout'),'timeout is reported: '+text);
    check(elapsed<15000,'the test aborts instead of hanging: '+elapsed+'ms');
    return true;
  })()`), true)
  hangSynthesize = false

  // Other options live on their own tab.
  assert.equal(await evaluate(`(async()=>{
    tab('settingsTabOther').click();
    await until(()=>document.querySelector('.bs-settings-tab[aria-selected="true"]').textContent==='settingsTabOther');
    check(!!document.querySelector('.bs-settings-body'),'other tab body');
    return true;
  })()`), true)

  // Escape closes the window, and reopening keeps the saved read-aloud choice.
  assert.equal(await evaluate(`(async()=>{
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await until(()=>!dialog());
    await openSettings();
    tab('settingsTabSpeech').click();
    await until(()=>[...document.querySelectorAll('.bs-settings-body select')].some(node=>node.value==='openai'));
    return true;
  })()`), true)

  await evaluate(`(async()=>{await closeSettings();return true})()`)
  assert.deepEqual(await evaluate('window.errors'), [])
  console.log('settings dialog: tabs, reading persistence, read-aloud configuration, cache clear')
} finally {
  try { socket?.close() } catch {}
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill('SIGKILL')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))])
  }
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)) }
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
