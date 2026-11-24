// Formatting helpers for the browser regression log.
//
// `tests/run-browser.mjs` tees every suite's output into `.local/browser/` and,
// when one fails, emits a workflow command that points GitHub Actions at the
// suite file. Keeping the formatting here lets the runner stay about process
// control and lets a plain Node test cover escaping and tail selection.

const ANSI = /\u001b\[[0-9;]*m/g
const FAILURE_HINT = /(?:^|\s)(?:[A-Za-z]*Error|AssertionError|failed|FAIL|✖|not ok|timed out)\b/

/**
 * Keep the last few lines that look like a failure, falling back to the tail.
 *
 * @param {string} output - captured stdout and stderr of one suite.
 * @param {{ lines?: number, maxChars?: number }} [limits]
 * @returns {string}
 */
export function clipTail(output, { lines = 6, maxChars = 2000 } = {}) {
  const clean = String(output ?? '').replace(ANSI, '')
  const rows = clean.split('\n').map(line => line.trimEnd()).filter(line => line !== '')
  const hint = rows.reduce((found, line, index) => (FAILURE_HINT.test(line) ? index : found), -1)
  const chosen = hint === -1 ? rows.slice(-lines) : rows.slice(hint, hint + lines)
  const body = chosen.join('\n')
  return body.length > maxChars ? `${body.slice(0, maxChars)}…` : body
}

/**
 * Escape a value for a GitHub Actions workflow command.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCommand(value) {
  return String(value ?? '')
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
}

/**
 * Build the `::error` annotation for a failed suite.
 *
 * @param {{ suite: string, code: number | null, signal: string | null, output: string, logPath?: string }} failure
 * @returns {string}
 */
export function formatFailureAnnotation({ suite, code, signal, output, logPath }) {
  const status = signal ? `was stopped by ${signal}` : `exited with code ${code ?? 1}`
  const detail = clipTail(output)
  const lines = [`Browser suite ${suite} ${status}.`]
  if (detail) lines.push(detail)
  if (logPath) lines.push(`Log: ${logPath}`)
  return `::error file=tests/${suite}.mjs,line=1,title=${escapeCommand(`Browser suite failed: ${suite}`)}::${escapeCommand(lines.join('\n'))}`
}
