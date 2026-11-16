// Sentence segmentation is the contract between the reader and every TTS
// provider: utterances must stay small, punctuation must survive, and Chinese
// text must not be glued back together by the English debris rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import { htmlToSpeakText, MAX_SENTENCE_CHARS, normalizeSpeakText, splitSentences } from '../assets/tts-sentences.mjs'

test('splits Chinese sentences and keeps closing quotes', () => {
  assert.deepEqual(splitSentences('第一句话。第二句话！第三句？'), ['第一句话。', '第二句话！', '第三句？'])
  assert.deepEqual(splitSentences('他说：“你好。”然后走了。'), ['他说：“你好。”', '然后走了。'])
  assert.deepEqual(splitSentences('省略号……然后呢……'), ['省略号……', '然后呢……'])
  assert.deepEqual(splitSentences('分号；顿号、逗号，都不断句。'), ['分号；', '顿号、逗号，都不断句。'])
})

test('does not split English abbreviations or decimals', () => {
  assert.deepEqual(splitSentences('Mr. Smith went to Washington. He arrived at 3.14 p.m.'),
    ['Mr. Smith went to Washington.', 'He arrived at 3.14 p.m.'])
  assert.deepEqual(splitSentences('e.g. this stays together. Next sentence.'),
    ['e.g. this stays together.', 'Next sentence.'])
  assert.deepEqual(splitSentences('Version 2.5 is out. Try it.'), ['Version 2.5 is out.', 'Try it.'])
})

test('paragraph breaks are hard sentence boundaries', () => {
  assert.deepEqual(splitSentences('多行\n第二行\n\n新段落。'), ['多行', '第二行', '新段落。'])
  assert.deepEqual(splitSentences('Short line\nAnother line'), ['Short line', 'Another line'])
})

test('long runs are cut at punctuation under the limit', () => {
  const long = '这是一句很长的文字，'.repeat(30) + '结束。'
  const sentences = splitSentences(long)
  assert.ok(sentences.length > 1)
  for (const sentence of sentences) {
    assert.ok(sentence.length <= MAX_SENTENCE_CHARS, `sentence too long: ${sentence.length}`)
  }
  assert.ok(sentences.at(-1).endsWith('结束。'))
  const custom = splitSentences('一二三四五六七八九十，'.repeat(30), { maxChars: 20 })
  assert.ok(custom.every((sentence) => sentence.length <= 20))
})

test('html input keeps paragraph structure and drops markup', () => {
  assert.deepEqual(splitSentences('<p>第一段。</p><p>第二段！</p>', { html: true }), ['第一段。', '第二段！'])
  assert.equal(htmlToSpeakText('<p>a<br>b</p>'), 'a\nb')
  assert.equal(htmlToSpeakText('<script>bad()</script>ok'), 'ok')
  assert.equal(htmlToSpeakText('a &amp; b &lt; c'), 'a & b < c')
  assert.equal(normalizeSpeakText('a\u000bb'), 'ab')
})

test('empty and whitespace input produce no utterances', () => {
  assert.deepEqual(splitSentences(''), [])
  assert.deepEqual(splitSentences('   \n\n  '), [])
  assert.deepEqual(splitSentences(undefined), [])
  assert.deepEqual(splitSentences('<p></p>', { html: true }), [])
})
