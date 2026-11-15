// Isolated Chrome functional tests; generated content only, no Host/profile access.
// Run: node tests/reading-snapshot.mjs (Node with native WebSocket; CHROME_BIN optional).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { prepareBrowserEnvironment, browserLaunchArgs } from './helpers/browser-env.mjs'
import { once } from 'node:events'

const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-snapshot-'))
const ownedPath = await realpath(temporary)
const parentPath = await realpath(tmpdir())
let server, chrome, socket
let browserLog = ''
const requests = []
try {
  const { chromePath } = await prepareBrowserEnvironment(temporary, { react: false })
  const module = await readFile(new URL('../assets/reading-snapshot.mjs', import.meta.url))
  const tests = await readFile(new URL('./reading-snapshot.browser.mjs', import.meta.url))
  server = createServer((req, res) => {
    requests.push(req.url)
    if (req.url === '/reading-snapshot.mjs' || req.url === '/tests.mjs') {
      res.setHeader('content-type', 'text/javascript'); res.end(req.url === '/tests.mjs' ? tests : module); return
    }
    if (req.url === '/test.html') {
      res.setHeader('content-type', 'text/html')
      // Assign the promise immediately and include import failures in its result.
      res.end('<!doctype html><html><body><script>window.result=import("/tests.mjs").then(module=>module.run()).then(value=>({ok:true,value}),error=>({ok:false,error:String(error),stack:error.stack}));</script></body></html>'); return
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  chrome = spawn(chromePath, [
    ...browserLaunchArgs(),
    '--enable-logging=stderr', '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--no-default-browser-check',
    `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0', '--window-size=1000,800', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const browserURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 15000)
    let log = ''
    chrome.once('error', error => { clearTimeout(timer); reject(error) })
    chrome.stderr.on('data', chunk => {
      log = (log + chunk).slice(-32000)
      browserLog = (browserLog + chunk).slice(-16000)
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const discoveryStarted = Date.now()
  let target, targets
  while (!target) {
    targets = await (await fetch(`http://${new URL(browserURL).host}/json`)).json()
    target = targets.find(page => page.type === 'page' && page.url === 'about:blank')
    if (target) break
    assert.ok(Date.now() - discoveryStarted < 30000, `Test tab not found: ${JSON.stringify(targets.map(page => page.url))}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(Error(`Browser command timed out: ${method}`)) }, 45000)
      const listener = event => {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        clearTimeout(timer)
        socket.removeEventListener('message', listener)
        if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)))
        else resolve(message.result)
      }
      socket.addEventListener('message', listener)
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  // Snapshot cases create iframe execution contexts while they run. Bind the
  // result evaluation to the actual top-level document, never CDP's implicit
  // context (which may still point at a startup or fixture document).
  const contexts = new Map()
  const contextListener = event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.executionContextCreated') {
      const context = message.params.context
      if (context.auxData?.isDefault !== false) contexts.set(context.id, context)
    } else if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(message.params.executionContextId)
    else if (message.method === 'Runtime.executionContextsCleared') contexts.clear()
  }
  socket.addEventListener('message', contextListener)
  const navigation = await command('Page.navigate', { url: `${origin}/test.html` })
  assert.equal(navigation.errorText, undefined, navigation.errorText)
  await command('Runtime.enable')
  const startup = Date.now()
  let mainContextId, readiness = []
  while (mainContextId === undefined) {
    readiness = []
    for (const contextId of contexts.keys()) {
      try {
        const state = await command('Runtime.evaluate', {
          contextId, expression: '({url:location.href,started:Boolean(window.result)})', returnByValue: true,
        })
        const value = state.result.value
        readiness.push({ contextId, ...value })
        if (value.url === `${origin}/test.html` && value.started) { mainContextId = contextId; break }
      } catch (error) {
        if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error
      }
    }
    assert.ok(Date.now() - startup < 30000, `Test bootstrap not ready: ${JSON.stringify(readiness)}`)
    if (mainContextId === undefined) await new Promise(resolve => setTimeout(resolve, 100))
  }
  socket.removeEventListener('message', contextListener)
  const evaluated = await command('Runtime.evaluate', {
    contextId: mainContextId,
    expression: `(() => { if (!window.result) throw Error('Test bootstrap missing at ' + location.href); return window.result })()`,
    awaitPromise: true, returnByValue: true,
  })
  const result = evaluated.result.value
  assert.equal(result.ok, true, result.stack || result.error)
  console.log(JSON.stringify(result.value, null, 2))
  console.log(`PASS: ${result.value.count} isolated Chrome snapshot cases`)
} catch (error) {
  console.error('Snapshot requests:', JSON.stringify(requests))
  console.error('Snapshot Chrome diagnostics:', browserLog)
  throw error
} finally {
  socket?.close()
  if (chrome && chrome.exitCode === null && chrome.pid) {
    const exited = once(chrome, 'exit')
    chrome.kill('SIGTERM')
    const force = setTimeout(() => chrome.kill('SIGKILL'), 4000)
    await exited
    clearTimeout(force)
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  // Only delete this run's uniquely created directory after resolving and checking
  // its exact path and expected parent/prefix; never touch an existing user profile.
  assert.equal(await realpath(temporary), ownedPath)
  assert.equal(dirname(ownedPath), parentPath)
  assert.ok(basename(ownedPath).startsWith('bookshelf-snapshot-'))
  await rm(ownedPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
