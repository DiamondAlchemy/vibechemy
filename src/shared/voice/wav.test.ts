import { describe, expect, it } from 'vitest'
import { decodeWavPcm16, downsampleTo16k, encodeWavPcm16 } from './wav'

describe('downsampleTo16k', () => {
  it('downsamples 48 kHz input to 16 kHz', () => {
    expect(downsampleTo16k(new Float32Array(480).fill(0.5), 48000)).toHaveLength(160)
  })

  it('preserves a constant signal at non-integer sample-rate ratios', () => {
    const result = downsampleTo16k(new Float32Array(441).fill(0.3), 44100)
    expect(result.length).toBeGreaterThan(0)
    for (const value of result) expect(value).toBeCloseTo(0.3, 3)
  })

  it('returns 16 kHz input unchanged', () => {
    const input = new Float32Array([0.1, 0.2, 0.3])
    expect(downsampleTo16k(input, 16000)).toBe(input)
  })
})

describe('WAV PCM16 codec', () => {
  it('writes the expected mono 16 kHz PCM header', () => {
    const wav = encodeWavPcm16(new Float32Array(100))
    const bytes = new Uint8Array(wav)
    const view = new DataView(wav)
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(200)
  })

  it('clamps and scales full-range samples', () => {
    const view = new DataView(encodeWavPcm16(new Float32Array([2, -2])))
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
  })

  it('round-trips encoded samples', () => {
    const source = new Float32Array([0, 0.5, -0.5, 0.999, -0.999])
    const result = decodeWavPcm16(new Uint8Array(encodeWavPcm16(source)))
    expect(result.sampleRate).toBe(16000)
    expect(result.samples).toHaveLength(source.length)
    for (let i = 0; i < source.length; i++) {
      expect(Math.abs(result.samples[i] - source[i])).toBeLessThan(2 / 32768)
    }
  })

  it('rejects invalid, stereo, and truncated WAV data', () => {
    expect(() => decodeWavPcm16(new Uint8Array(44))).toThrow('not a RIFF/WAVE file')
    const stereo = new Uint8Array(encodeWavPcm16(new Float32Array([0.1, 0.2])))
    new DataView(stereo.buffer).setUint16(22, 2, true)
    expect(() => decodeWavPcm16(stereo)).toThrow('expected 16-bit mono PCM')
    const truncated = new Uint8Array(encodeWavPcm16(new Float32Array([0.1, 0.2]))).subarray(0, 44)
    expect(() => decodeWavPcm16(truncated)).toThrow('invalid data chunk length')
  })
})
