// WAV/MP3 helpers for whole-book rendering: parse provider chunks, merge them
// into one canonical PCM WAV and drop repeated ID3 tags from MP3 chunks.

import { AudiobookError } from './audiobook-pricing.mjs'

// --------------------------------------------------------------------- WAV I/O

function readWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) throw new AudiobookError(502, '语音服务返回的 WAV 不完整')
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new AudiobookError(502, '语音服务没有返回 WAV 数据')
  }
  let offset = 12
  let format = null
  let pcm = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = Math.min(buffer.length, start + size)
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      }
    } else if (id === 'data') {
      pcm = buffer.subarray(start, end)
    }
    offset = start + size + (size % 2)
  }
  if (format === null || pcm === null) throw new AudiobookError(502, '语音服务返回的 WAV 缺少格式或数据段')
  if (format.audioFormat !== 1) throw new AudiobookError(502, '整书语音只支持 PCM WAV')
  return { format, pcm }
}

function wavHeader(format, dataBytes) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(format.channels, 22)
  header.writeUInt32LE(format.sampleRate, 24)
  header.writeUInt32LE(format.sampleRate * format.channels * (format.bitsPerSample / 8), 28)
  header.writeUInt16LE(format.channels * (format.bitsPerSample / 8), 32)
  header.writeUInt16LE(format.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

export function mergeWavBuffers(buffers) {
  const parts = []
  let format = null
  let dataBytes = 0
  for (const buffer of buffers) {
    const parsed = readWav(buffer)
    if (format === null) format = parsed.format
    else if (parsed.format.channels !== format.channels || parsed.format.sampleRate !== format.sampleRate || parsed.format.bitsPerSample !== format.bitsPerSample) {
      throw new AudiobookError(502, '语音片段格式不一致，无法合并')
    }
    parts.push(parsed.pcm)
    dataBytes += parsed.pcm.length
  }
  if (format === null) throw new AudiobookError(502, '没有可合并的语音')
  return Buffer.concat([wavHeader(format, dataBytes), ...parts])
}

// MP3 chunks from a provider can each carry an ID3v2 tag; keep the frames and
// drop the tag so concatenated chunks stay one continuous stream.
export function stripMp3Tags(buffer) {
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f)
    return buffer.subarray(Math.min(buffer.length, 10 + size))
  }
  return buffer
}

export { readWav, wavHeader }
