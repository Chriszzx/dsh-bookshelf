/**
 * Sentence segmentation for read-aloud, shared by the browser reader and the
 * Node tests. Text arrives from EPUB chapters (possibly HTML) or PDF pages and
 * is cut into utterance-sized pieces so one request never exceeds a provider's
 * per-request limit and the first audible sentence arrives quickly.
 */

// Longest utterance handed to one synthesis request. Providers bill and cap by
// request; a small ceiling also keeps prefetch predictable.
export const MAX_SENTENCE_CHARS = 120

// A sentence boundary is one of these, optionally followed by closing quotes or
// brackets that belong to the sentence (Chinese "。”", English ".)").
const TERMINATORS = new Set(['。', '！', '？', '；', '…', '!', '?', ';', '．', '.'])
const CLOSERS = new Set(['”', '’', '"', "'", '」', '』', '】', '）', ')', '》', '〉', ']', '}', '…'])
// Secondary break used only when a run exceeds the limit.
const SOFT_BREAKS = new Set(['，', ',', '、', '：', ':', '—', '–', ' '])

// "e.g." / "Mr." style false positives: do not end a sentence after these.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie',
  'fig', 'no', 'vol', 'p', 'pp', 'ch', 'sec', 'approx', 'dept', 'est', 'inc', 'ltd',
])

const ENTITIES = new Map([
  ['&nbsp;', ' '], ['&#160;', ' '], ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'],
  ['&quot;', '"'], ['&#39;', "'"], ['&apos;', "'"],
])

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (match, code) => {
      const point = Number(code)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match
    })
    .replace(/&[a-z]+;/gi, (match) => ENTITIES.get(match.toLowerCase()) ?? match)
}

// Block-level tags become paragraph breaks; other tags vanish. This is only used
// for building speech text, never for rendering.
export function htmlToSpeakText(html) {
  if (typeof html !== 'string' || html === '') return ''
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|section|article|li|blockquote|h[1-6]|tr|figcaption|dd|dt|pre)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Text that goes to a provider: collapse whitespace but keep paragraph breaks,
// and drop characters some services reject (vertical tab and friends).
export function normalizeSpeakText(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function lastToken(text) {
  const match = /([A-Za-z]+)\.?$/.exec(text)
  return match === null ? '' : match[1].toLowerCase()
}

function isAbbreviation(text) {
  const tail = text.trimEnd()
  if (!tail.endsWith('.')) return false
  const token = lastToken(tail)
  if (token === '') return false
  // A single initial ("J.") is not a sentence end either.
  return token.length === 1 || ABBREVIATIONS.has(token)
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function pushSentence(target, value, { merge = true } = {}) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text === '') return
  // Punctuation debris and stray numerals ("1.", "……") are not worth their own
  // request; attach them to the previous sentence. A short CJK fragment is real
  // text (a line of a poem, a heading), so it stays separate.
  const debris = !CJK.test(text) && text.length < 4
  if (merge && debris && target.length > 0) {
    target[target.length - 1] = `${target[target.length - 1]} ${text}`.replace(/\s+/g, ' ').trim()
    return
  }
  target.push(text)
}

function cutLong(text, limit) {
  const pieces = []
  let rest = text
  while (rest.length > limit) {
    let cut = -1
    for (let index = Math.min(rest.length - 1, limit); index >= Math.floor(limit * 0.4); index -= 1) {
      if (SOFT_BREAKS.has(rest[index])) { cut = index + 1; break }
    }
    if (cut === -1) cut = limit
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest !== '') pieces.push(rest)
  return pieces.filter((piece) => piece !== '')
}

/**
 * Split text into speakable sentences.
 * @param {string} input plain text or HTML
 * @param {{html?: boolean, maxChars?: number}} [options]
 * @returns {string[]}
 */
export function splitSentences(input, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars > 0 ? options.maxChars : MAX_SENTENCE_CHARS
  const source = normalizeSpeakText(options.html === true ? htmlToSpeakText(input) : input)
  if (source === '') return []

  const sentences = []
  let current = ''

  const flush = (options) => {
    if (current === '') return
    for (const piece of cutLong(current, maxChars)) pushSentence(sentences, piece, options)
    current = ''
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\n') {
      flush({ merge: false })
      continue
    }
    current += char
    // Consume the closing quote/bracket that belongs to this sentence.
    if (TERMINATORS.has(char)) {
      if (char === '.' && isAbbreviation(current)) continue
      let lookahead = index + 1
      while (lookahead < source.length && CLOSERS.has(source[lookahead])) {
        current += source[lookahead]
        lookahead += 1
      }
      index = lookahead - 1
      // A terminator followed by more letters without whitespace is not a
      // boundary ("3.14", "U.S.") — keep accumulating in that case.
      const next = source[index + 1]
      if (next !== undefined && /[0-9A-Za-z]/.test(next) && !/\s/.test(next)) continue
      flush()
      continue
    }
    if (current.length >= maxChars) {
      for (let cursor = current.length - 1; cursor >= Math.floor(maxChars * 0.5); cursor -= 1) {
        if (SOFT_BREAKS.has(current[cursor])) {
          const head = current.slice(0, cursor + 1)
          current = current.slice(cursor + 1)
          for (const piece of cutLong(head, maxChars)) pushSentence(sentences, piece)
          break
        }
      }
    }
  }
  flush()
  return sentences.filter((sentence) => sentence !== '')
}
