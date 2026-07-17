/**
 * Pure WAV helpers shared by microphone capture and local speech recognition.
 * No DOM or Node APIs, so the same code is safe in the main and renderer processes.
 */

/** Downsample mono Float32 PCM to 16 kHz with linear interpolation. */
export function downsampleTo16k(samples: Float32Array, inputRate: number): Float32Array {
  const targetRate = 16000
  if (inputRate === targetRate) return samples

  const ratio = inputRate / targetRate
  const out = new Float32Array(Math.floor(samples.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const position = i * ratio
    const lower = Math.floor(position)
    const upper = Math.min(lower + 1, samples.length - 1)
    const fraction = position - lower
    out[i] = samples[lower] * (1 - fraction) + samples[upper] * fraction
  }
  return out
}

/** Encode 16 kHz mono Float32 PCM as a standard 16-bit PCM WAV. */
export function encodeWavPcm16(samples16k: Float32Array): ArrayBuffer {
  const sampleRate = 16000
  const headerBytes = 44
  const dataBytes = samples16k.length * 2
  const buffer = new ArrayBuffer(headerBytes + dataBytes)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < samples16k.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples16k[i]))
    const pcm = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
    view.setInt16(headerBytes + i * 2, pcm, true)
  }
  return buffer
}

/** Decode a mono 16-bit PCM WAV with any standard chunk ordering. */
export function decodeWavPcm16(buf: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const readString = (offset: number, length: number): string =>
    String.fromCharCode(...buf.subarray(offset, offset + length))
  if (buf.length < 44 || readString(0, 4) !== 'RIFF' || readString(8, 4) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }

  let offset = 12
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null
  let data: Uint8Array | null = null
  while (offset + 8 <= buf.length) {
    const id = readString(offset, 4)
    const size = view.getUint32(offset + 4, true)
    if (offset + 8 + size > buf.length) throw new Error(`invalid ${id} chunk length`)
    if (id === 'fmt ') {
      if (size < 16) throw new Error('invalid fmt chunk')
      format = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bits: view.getUint16(offset + 22, true)
      }
    }
    if (id === 'data') data = buf.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }

  if (!format || !data) throw new Error('missing fmt/data chunk')
  if (format.audioFormat !== 1 || format.bits !== 16 || format.channels !== 1) {
    throw new Error(`expected 16-bit mono PCM, got fmt=${format.audioFormat} bits=${format.bits} ch=${format.channels}`)
  }

  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const samples = new Float32Array(Math.floor(data.length / 2))
  for (let i = 0; i < samples.length; i++) samples[i] = dataView.getInt16(i * 2, true) / 32768
  return { samples, sampleRate: format.sampleRate }
}
