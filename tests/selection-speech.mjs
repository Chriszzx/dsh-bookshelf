// Selection read-aloud contract: the selected text becomes a temporary sentence
// queue, and once it finishes continuous reading restarts from the sentence that
// contains the selection's final sentence — that sentence is read again. The
// anchor match has to survive the whitespace differences between a DOM selection
// and the chapter's innerText.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  lastSelectionSentence,
  normalizeForMatch,
  resumeIndexFor,
  SELECTION_AUDIO_POLICY,
  splitSelectionSentences,
} from '../assets/lib/selection-speech.mjs'
import { splitSentences } from '../assets/tts-sentences.mjs'

// Chapter batches built by the reader's speech driver: one entry per sentence,
// with the DOM range hidden behind the enter/preview closures.
function chapterBatch(texts) {
  return texts.map((text) => ({ text, enter: () => undefined, preview: () => undefined }))
}

test('empty and whitespace selections produce no sentences', () => {
  assert.deepEqual(splitSelectionSentences('', splitSentences), [])
  assert.deepEqual(splitSelectionSentences('   \n\t  ', splitSentences), [])
  assert.deepEqual(splitSelectionSentences(undefined, splitSentences), [])
  assert.deepEqual(splitSelectionSentences(null, splitSentences), [])
  assert.equal(lastSelectionSentence([]), '')
  assert.equal(resumeIndexFor(chapterBatch(['第一句。']), ''), -1)
})

test('a single-sentence selection keeps no terminator requirement', () => {
  assert.deepEqual(splitSelectionSentences('只有一个句子', splitSentences), ['只有一个句子'])
  assert.deepEqual(splitSelectionSentences('  只有一个句子  ', splitSentences), ['只有一个句子'])
  const sentences = splitSelectionSentences('只有一个句子', splitSentences)
  assert.equal(lastSelectionSentence(sentences), '只有一个句子')
})

test('multi-sentence selections keep terminal punctuation and closing quotes', () => {
  const sentences = splitSelectionSentences('第一句话。第二句话！他说：“你好。”', splitSentences)
  assert.deepEqual(sentences, ['第一句话。', '第二句话！', '他说：“你好。”'])
  assert.equal(lastSelectionSentence(sentences), '他说：“你好。”')
  assert.deepEqual(splitSelectionSentences('“就这样？”', splitSentences), ['“就这样？”'])
  assert.deepEqual(splitSelectionSentences('句号引号。”', splitSentences), ['句号引号。”'])
})

test('paragraph whitespace differences do not break the anchor match', () => {
  const selection = '第一段的内容。\n\n第二段开头。第二段结尾！'
  const sentences = splitSelectionSentences(selection, splitSentences)
  assert.deepEqual(sentences, ['第一段的内容。', '第二段开头。', '第二段结尾！'])
  const last = lastSelectionSentence(sentences)
  assert.equal(last, '第二段结尾！')
  assert.equal(normalizeForMatch('第一段。\n\n第二段。'), normalizeForMatch('第一段。   第二段。'))
  // The chapter's innerText may break the same sentence differently.
  assert.equal(resumeIndexFor(chapterBatch(['第一段的内容。', '第二段开头。\n第二段结尾！', '第三段。']), last), 1)
  const batch = chapterBatch(['第一段的内容。', '第二段开头。', '第二段结尾！', '第三段。'])
  assert.equal(resumeIndexFor(batch, last), 2)
})

test('a selection that ends mid-sentence finds the containing chapter sentence', () => {
  const sentences = splitSelectionSentences('这是一段开头的话，第二段', splitSentences)
  assert.deepEqual(sentences, ['这是一段开头的话，第二段'])
  const last = lastSelectionSentence(sentences)
  const batch = chapterBatch(['其他地方。', '这是一段开头的话，第二段继续。', '结尾。'])
  assert.equal(resumeIndexFor(batch, last), 1)
})

test('resuming reads the anchored sentence again', () => {
  const sentences = splitSelectionSentences('先读这一句。再读这一句！', splitSentences)
  const last = lastSelectionSentence(sentences)
  assert.equal(last, '再读这一句！')
  const batch = chapterBatch(['先读这一句。', '再读这一句！', '后面的句子。'])
  const start = resumeIndexFor(batch, last)
  // Playback starts at the matched index, so its sentence is spoken twice: once
  // inside the selection, once as the first sentence of the resumed reading.
  assert.equal(start, 1)
  assert.equal(batch[start].text, last)
})

test('resume lookup walks the chapter batch in order', () => {
  const sentences = splitSelectionSentences('三。四！', splitSentences)
  const last = lastSelectionSentence(sentences)
  assert.equal(resumeIndexFor(chapterBatch(['一。', '二。', '三。', '四！', '五。']), last), 3)
  // Repeated sentences resolve to the first occurrence in batch order.
  assert.equal(resumeIndexFor(['重复句。', '中间。', '重复句。'], '重复句。'), 0)
})

test('a missing anchor returns -1 so the caller falls back to the batch start', () => {
  assert.equal(resumeIndexFor(chapterBatch(['甲。', '乙。']), '完全不同的句子。'), -1)
  assert.equal(resumeIndexFor([], '甲。'), -1)
  assert.equal(resumeIndexFor(null, '甲。'), -1)
  const index = resumeIndexFor(chapterBatch(['甲。']), '乙。')
  assert.equal(index < 0 ? 0 : index, 0)
})

test('batches may be plain sentence strings and blank entries are skipped', () => {
  assert.equal(resumeIndexFor(['甲。', '乙。'], '乙。'), 1)
  assert.equal(resumeIndexFor(['', null, { text: '丙。' }, '乙。'], '乙。'), 3)
  assert.equal(resumeIndexFor([{ text: '' }, { text: '  ' }, {}], '甲。'), -1)
})

test('the injected splitter receives the trimmed source and its output is cleaned', () => {
  const calls = []
  const stub = (value) => {
    calls.push(value)
    return ['  第一句。 ', '', '第二句！\n']
  }
  assert.deepEqual(splitSelectionSentences('  第一句。第二句！  ', stub), ['第一句。', '第二句！'])
  assert.deepEqual(calls, ['第一句。第二句！'])
})

test('splitter failures and junk results are tolerated', () => {
  assert.deepEqual(splitSelectionSentences('第一句。', () => { throw new Error('boom') }), [])
  assert.deepEqual(splitSelectionSentences('第一句。', () => null), [])
  assert.deepEqual(splitSelectionSentences('第一句。', () => [1, true, '  ', '有效。']), ['有效。'])
})

test('without an injected splitter a conservative fallback still segments', () => {
  assert.deepEqual(splitSelectionSentences('第一句。第二句！'), ['第一句。', '第二句！'])
  assert.deepEqual(splitSelectionSentences('他说：“你好。”然后走了。'), ['他说：“你好。”', '然后走了。'])
  assert.deepEqual(splitSelectionSentences('第一段\n第二段'), ['第一段', '第二段'])
  assert.deepEqual(splitSelectionSentences('甲。乙。', null), ['甲。', '乙。'])
})

test('normalizeForMatch collapses layout whitespace to single spaces', () => {
  assert.equal(normalizeForMatch('  第一段。\n\n第二段。  '), '第一段。 第二段。')
  assert.equal(normalizeForMatch('第一段。\u3000\u3000第二段。'), '第一段。 第二段。')
  assert.equal(normalizeForMatch('一\t二\r\n三'), '一 二 三')
  assert.equal(normalizeForMatch('\t\r\n '), '')
  assert.equal(normalizeForMatch(undefined), '')
  assert.equal(normalizeForMatch(42), '')
})

test('lastSelectionSentence skips blank trailing entries', () => {
  assert.equal(lastSelectionSentence(['第一句。', '  ', '']), '第一句。')
  assert.equal(lastSelectionSentence(['  第三句！  ']), '第三句！')
  assert.equal(lastSelectionSentence([]), '')
  assert.equal(lastSelectionSentence(null), '')
  assert.equal(lastSelectionSentence([1, null]), '')
})

test('selection audio is never cached', () => {
  assert.deepEqual({ ...SELECTION_AUDIO_POLICY }, { cache: false })
  assert.equal(SELECTION_AUDIO_POLICY.cache, false)
  // Consumers must not flip the flag for the current selection path.
  assert.equal(Object.isFrozen(SELECTION_AUDIO_POLICY), true)
})
