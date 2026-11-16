/**
 * Selection read-aloud logic: cut the selected text into the temporary sentence
 * queue that is spoken, find where continuous read-aloud resumes afterwards,
 * and mark that the selection audio must not be cached.
 * See docs/PLAN-split-and-annotations.md §6.2/§6.3.
 *
 * Flow. "Read selected text" speaks the selection as a plain sentence queue and
 * never caches it (SELECTION_AUDIO_POLICY). When that queue ends, the reader
 * takes the current chapter batch and calls
 * resumeIndexFor(batch, lastSelectionSentence(sentences)): playback restarts at
 * the sentence that contains the selection's final sentence, so that sentence is
 * read again instead of being skipped. A miss returns -1 and the caller falls
 * back to the batch start.
 *
 * Pure functions only: no DOM, no React, no network, no global state. client.js
 * loads this module dynamically from the selection menu.
 */

// One-off selection audio: the temporary sentence queue is never stored, so the
// client skips its in-memory audio map and POST /tts/synthesize passes
// cache: false (Host writes the file to tts-scratch/ and leaves the LRU alone).
export const SELECTION_AUDIO_POLICY = Object.freeze({ cache: false })

// Whitespace is layout, not content: a DOM selection and the chapter's innerText
// disagree on newlines, indentation and ideographic spaces around paragraph
// boundaries, so matching compares one whitespace-normalised form.
export function normalizeForMatch(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/\s+/gu, ' ').trim()
}

// Fallback used only when the caller does not inject the shared sentence
// splitter: a paragraph break is a hard boundary, and each paragraph is cut
// after a terminator run plus its closing quotes/brackets. Best effort; the
// reader injects assets/tts-sentences.mjs so selection and chapter batches
// segment text identically.
const FALLBACK_BOUNDARY = /[。！？；…!?;.．]["'”’」』】）)》〉\]\}…]*/gu

function fallbackSplitSentences(text) {
  const sentences = []
  for (const paragraph of text.split(/\n+/u)) {
    const value = paragraph.replace(/\s+/gu, ' ').trim()
    if (value === '') continue
    let start = 0
    for (const match of value.matchAll(FALLBACK_BOUNDARY)) {
      const end = match.index + match[0].length
      const piece = value.slice(start, end).trim()
      if (piece !== '') sentences.push(piece)
      start = end
    }
    const rest = value.slice(start).trim()
    if (rest !== '') sentences.push(rest)
  }
  return sentences
}

/**
 * Split selected text into the sentences spoken by the temporary selection
 * queue. Blank results are dropped and every sentence is whitespace-normalised,
 * so the anchors produced here compare cleanly with chapter batches.
 * @param {string} text raw selection text (plain text; may contain newlines)
 * @param {(text: string) => string[]} [splitSentences] sentence splitter; the
 *   reader injects the shared assets/tts-sentences.mjs splitSentences. The
 *   fallback only knows paragraph breaks and sentence terminators.
 * @returns {string[]} speakable sentences, in reading order
 */
export function splitSelectionSentences(text, splitSentences) {
  if (typeof text !== 'string') return []
  // Treat every line ending as a newline before any splitter sees the text.
  const source = text.replace(/\r\n?/gu, '\n').trim()
  if (source === '') return []
  const splitter = typeof splitSentences === 'function' ? splitSentences : fallbackSplitSentences
  let sentences
  try {
    sentences = splitter(source)
  } catch {
    // A splitter that cannot handle the text leaves nothing to speak.
    return []
  }
  if (!Array.isArray(sentences)) return []
  const result = []
  for (const sentence of sentences) {
    if (typeof sentence !== 'string') continue
    const cleaned = normalizeForMatch(sentence)
    if (cleaned !== '') result.push(cleaned)
  }
  return result
}

/**
 * The selection's final sentence: the new read-aloud anchor and the sentence
 * that is read again when continuous reading resumes. Blank trailing entries are
 * skipped.
 * @param {string[]} sentences selection sentences, e.g. from
 *   splitSelectionSentences
 * @returns {string} whitespace-normalised sentence, or '' when there is none
 */
export function lastSelectionSentence(sentences) {
  if (!Array.isArray(sentences)) return ''
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index]
    if (typeof sentence !== 'string') continue
    const cleaned = normalizeForMatch(sentence)
    if (cleaned !== '') return cleaned
  }
  return ''
}

function batchSentence(item) {
  if (typeof item === 'string') return item
  if (item !== null && typeof item === 'object' && typeof item.text === 'string') return item.text
  return ''
}

/**
 * Index of the current chapter batch entry that contains the selection's final
 * sentence — i.e. where continuous read-aloud restarts. The entry's text is used
 * for matching (a batch item is { text, enter, preview }); plain sentence strings
 * are accepted too. A match is whitespace-normalised equality or containment, so
 * a selection that ends mid-sentence still finds its chapter sentence.
 * @param {Array<{ text?: string } | string>} batch current chapter batch
 * @param {string} sentence the selection's final sentence
 * @returns {number} first matching index, or -1 when the batch does not contain
 *   the sentence (the caller falls back to index 0)
 */
export function resumeIndexFor(batch, sentence) {
  const target = normalizeForMatch(sentence)
  if (target === '' || !Array.isArray(batch)) return -1
  for (let index = 0; index < batch.length; index += 1) {
    const text = normalizeForMatch(batchSentence(batch[index]))
    if (text === '') continue
    if (text === target || text.includes(target)) return index
  }
  return -1
}
