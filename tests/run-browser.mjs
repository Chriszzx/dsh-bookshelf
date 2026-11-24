import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatFailureAnnotation } from '../scripts/browser-log.mjs'
import { findBrowser } from './helpers/browser-env.mjs'

const suites = ['reading-snapshot', 'file-import', 'discussion-handoff', 'tab-persistence', 'pagination-geometry', 'layout-fonts', 'shelf-tags', 'finish-prompt', 'list-layout', 'tts-playback', 'settings-dialog', 'audiobook-dialog', 'audiobook-playback', 'annotations-ui', 'annotations-panel', 'selection-menu', 'highlights-browser', 'selection-speech-browser', 'toc-sticky', 'shelf-grid']
const selected = process.argv.slice(2)
for (const name of selected) {
  if (!suites.includes(name)) throw new Error(`Unknown browser suite: ${name}. Choose ${suites.join(', ')}.`)
}
const root = fileURLToPath(new URL('../', import.meta.url))
const browser = await findBrowser()

// Every suite's output also lands on disk so a failed CI job can upload it and
// a local failure keeps the full output after the terminal scrolls away.
const logDirectory = join(root, '.local', 'browser')
mkdirSync(logDirectory, { recursive: true })
const logFile = join(logDirectory, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
const logPath = relative(root, logFile)
function out(text) {
  appendFileSync(logFile, text)
  process.stdout.write(text)
}
function browserVersion(executable) {
  try {
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 15000 })
    return String(result.stdout || '').trim().split('\n')[0]
  } catch {
    return ''
  }
}
const version = browserVersion(browser)
out(`Browser: ${browser}${version ? ` (${version})` : ''}\n`)
out(`Platform: ${process.platform} ${process.arch}, Node ${process.version}\n`)
out(`Suites: ${(selected.length ? selected : suites).join(', ')}\n`)
out(`Log: ${logPath}\n`)

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
  out(`\n===== ${name} =====\n\nRunning browser suite: ${name}\n`)
  const temporary = await mkdtemp(join(tmpdir(), 'bookshelf-suite-'))
  const owned = await realpath(temporary)
  const parent = await realpath(tmpdir())
  let child, timer, stopping
  let code
  let signal = null
  let captured = ''
  try {
    // Child homes, fixtures and browser profiles stay inside this owned root,
    // including when a failed suite cannot reach its own finally block.
    child = spawn(process.execPath, [fileURLToPath(new URL(`${name}.mjs`, import.meta.url))], {
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: { ...process.env, CHROME_BIN: browser, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
    })
    const relay = chunk => {
      const text = chunk.toString()
      captured = (captured + text).slice(-200_000)
      out(text)
    }
    child.stdout.on('data', relay)
    child.stderr.on('data', relay)
    timer = setTimeout(() => {
      out(`\nBrowser suite timed out after 240 seconds: ${name}\n`)
      stopping = stopTree(child)
    }, 240000)
    code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (status, exitSignal) => {
        signal = exitSignal
        resolve(exitSignal ? 1 : status ?? 1)
      })
    })
  } finally {
    clearTimeout(timer)
    await (stopping ?? stopTree(child))
    assert.equal(await realpath(temporary), owned)
    assert.equal(dirname(owned), parent)
    assert.ok(basename(owned).startsWith('bookshelf-suite-'))
    await rm(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  if (code !== 0) {
    // The annotation points Actions at the suite file and repeats the last
    // useful lines, so the failure is readable before the artifact is opened.
    out(`\n${formatFailureAnnotation({ suite: name, code, signal, output: captured, logPath })}\n`)
    process.exit(code)
  }
}
out('\nAll selected browser suites passed.\n')
