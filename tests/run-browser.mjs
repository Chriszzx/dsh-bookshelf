import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser } from './helpers/browser-env.mjs'

const suites = ['reading-snapshot', 'file-import', 'discussion-handoff', 'tab-persistence', 'pagination-geometry', 'layout-fonts', 'shelf-tags', 'finish-prompt', 'list-layout']
const selected = process.argv.slice(2)
for (const name of selected) {
  if (!suites.includes(name)) throw new Error(`Unknown browser suite: ${name}. Choose ${suites.join(', ')}.`)
}
const browser = await findBrowser()
console.log(`Browser: ${browser}`)

async function stopTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'inherit' })
      killer.once('error', () => { child.kill(); resolve() })
      killer.once('exit', resolve)
    })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
  }
}

for (const name of selected.length ? selected : suites) {
  console.log(`\nRunning browser suite: ${name}`)
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-suite-'))
  const owned = await realpath(temporary)
  const parent = await realpath(tmpdir())
  let child, timer, stopping
  let code
  try {
    // Child homes, fixtures and browser profiles stay inside this owned root,
    // including when a failed suite cannot reach its own finally block.
    child = spawn(process.execPath, [fileURLToPath(new URL(`${name}.mjs`, import.meta.url))], {
      stdio: 'inherit', detached: process.platform !== 'win32',
      env: { ...process.env, CHROME_BIN: browser, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
    })
    timer = setTimeout(() => {
      console.error(`Browser suite timed out after 240 seconds: ${name}`)
      stopping = stopTree(child)
    }, 240000)
    code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (status, signal) => resolve(signal ? 1 : status ?? 1))
    })
  } finally {
    clearTimeout(timer)
    await (stopping ?? stopTree(child))
    assert.equal(await realpath(temporary), owned)
    assert.equal(dirname(owned), parent)
    assert.ok(basename(owned).startsWith('bookshelf-suite-'))
    await rm(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  if (code !== 0) process.exit(code)
}
console.log('\nAll selected browser suites passed.')
