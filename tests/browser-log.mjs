// The browser runner's log formatting is the only thing that turns a red CI
// job into a readable failure, so pin its tail selection and escaping here.
import test from 'node:test'
import assert from 'node:assert/strict'

import { clipTail, escapeCommand, formatFailureAnnotation } from '../scripts/browser-log.mjs'

test('keeps the failure lines from the suite tail', () => {
  const output = [
    'PASS: 13 isolated Chrome snapshot cases',
    'opening the reader',
    'AssertionError [ERR_ASSERTION]: expected 3 pages, saw 4',
    '    at file:///tmp/pagination-geometry.mjs:280:10',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
    'Process exited with code 1',
  ].join('\n')
  const tail = clipTail(output)
  assert.match(tail, /AssertionError/)
  assert.match(tail, /pagination-geometry\.mjs:280/)
  assert.ok(!tail.includes('PASS:'), 'a passing line ahead of the failure is dropped')
})

test('falls back to the last lines when nothing looks like an error', () => {
  const output = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight'
  assert.equal(clipTail(output, { lines: 3 }), 'six\nseven\neight')
})

test('strips ANSI colour and bounds the message', () => {
  const output = `\u001b[31mError: boom\u001b[0m\n${'x'.repeat(5000)}`
  const tail = clipTail(output, { maxChars: 80 })
  assert.ok(tail.length <= 81, 'message is clipped to the budget')
  assert.ok(!tail.includes('\u001b'), 'colour is removed')
})

test('escapes workflow command line breaks and percent signs', () => {
  assert.equal(escapeCommand('a%b\r\nc'), 'a%25b%0D%0Ac')
})

test('points the annotation at the suite file, title and log', () => {
  const annotation = formatFailureAnnotation({
    suite: 'tts-playback',
    code: 1,
    signal: null,
    output: 'Error: voice mismatch\nProcess exited with code 1',
    logPath: '.local/browser/run-2026-11-24.log',
  })
  assert.match(annotation, /^::error file=tests\/tts-playback\.mjs,line=1,/)
  assert.match(annotation, /title=Browser suite failed: tts-playback/)
  assert.match(annotation, /voice mismatch/)
  assert.match(annotation, /Log: \.local\/browser\/run-2026-11-24\.log/)
  const body = annotation.slice(annotation.indexOf('::', 2) + 2)
  assert.ok(!body.includes('\n'), 'the annotation body stays on one line')
  assert.match(body, /%0A/, 'line breaks are escaped')
})

test('names the signal when a suite was killed', () => {
  const annotation = formatFailureAnnotation({ suite: 'layout-fonts', code: 1, signal: 'SIGKILL', output: '' })
  assert.match(annotation, /stopped by SIGKILL/)
})
