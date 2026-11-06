// Isolated Chrome functional tests; generated content only, no Host/profile access.
// Run: node tests/reading-snapshot.mjs (Node with native WebSocket; CHROME_BIN optional).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-snapshot-'))
const ownedPath = await realpath(temporary)
const parentPath = await realpath(tmpdir())
let server, chrome, socket
try {
  const module = await readFile(new URL('../assets/reading-snapshot.mjs', import.meta.url))
  const tests = await readFile(new URL('./reading-snapshot.browser.mjs', import.meta.url))
  server = createServer((req, res) => {
    if (req.url === '/reading-snapshot.mjs' || req.url === '/tests.mjs') {
      res.setHeader('content-type', 'text/javascript'); res.end(req.url === '/tests.mjs' ? tests : module); return
    }
    if (req.url === '/test.html') {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><html><body><script type="module">import {run} from "/tests.mjs";window.result=run().then(value=>({ok:true,value}),error=>({ok:false,error:String(error),stack:error.stack}));</script></body></html>'); return
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--no-default-browser-check',
    `--user-data-dir=${join(temporary, 'chrome')}`, '--remote-debugging-port=0', '--window-size=1000,800', `${origin}/test.html`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const browserURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 15000)
    let log = ''
    chrome.once('error', error => { clearTimeout(timer); reject(error) })
    chrome.stderr.on('data', chunk => {
      log = (log + chunk).slice(-32000)
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const targets = await (await fetch(`http://${new URL(browserURL).host}/json`)).json()
  const target = targets.find(page => page.url === `${origin}/test.html`)
  assert.ok(target, 'isolated test tab exists')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const evaluate = () => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(Error('Browser test timeout')) }, 45000)
    const listener = event => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timer)
      socket.removeEventListener('message', listener)
      if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)))
      else resolve(message.result.result.value)
    }
    socket.addEventListener('message', listener)
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
      expression: `(async()=>{const started=Date.now();while(!window.result){if(Date.now()-started>10000)throw Error('Test module failed to load');await new Promise(r=>setTimeout(r,25))}return await window.result})()`,
      awaitPromise: true, returnByValue: true,
    } }))
  })
  let result
  const started = Date.now()
  while (!result) {
    try { result = await evaluate() } catch (error) {
      // CDP may attach to the initial about:blank context just before navigation.
      // Reattach only for that specific startup race, never rerun a failed case.
      if (!error.message.includes('Execution context was destroyed') || Date.now() - started > 10000) throw error
    }
  }
  assert.equal(result.ok, true, result.stack || result.error)
  console.log(JSON.stringify(result.value, null, 2))
  console.log(`PASS: ${result.value.count} isolated Chrome snapshot cases`)
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
  await rm(ownedPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
