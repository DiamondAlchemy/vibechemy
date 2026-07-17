import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeWavPcm16 } from '@shared/voice/wav'
import { PARAKEET_MODEL_DIR, ParakeetAsr } from './ParakeetAsr'

const modelPresent = existsSync(join(PARAKEET_MODEL_DIR, 'encoder.int8.onnx'))

describe.skipIf(!modelPresent)('ParakeetAsr integration', () => {
  it('loads the real local model and transcribes its fixture', { timeout: 30_000 }, async () => {
    const asr = new ParakeetAsr()
    expect(asr.available()).toBe(true)
    expect(asr.status()).toMatchObject({ available: true, engine: 'parakeet' })
    const wavPath = join(PARAKEET_MODEL_DIR, 'test_wavs', 'en.wav')
    if (!existsSync(wavPath)) return
    expect((await asr.transcribe(readFileSync(wavPath))).length).toBeGreaterThan(5)
    asr.dispose()
  })
})

describe('ParakeetAsr unavailable state', () => {
  it('reports the missing model path and download action', () => {
    const asr = new ParakeetAsr('/nonexistent-vibechemy-model')
    expect(asr.available()).toBe(false)
    expect(asr.status()).toMatchObject({
      available: false,
      engine: 'parakeet',
      model: 'Parakeet TDT 0.6B v3',
      modelPath: '/nonexistent-vibechemy-model'
    })
    expect(asr.status().reason).toContain('Settings → Voice')
  })

  it('rejects before touching the native layer when the model is absent', async () => {
    const asr = new ParakeetAsr('/nonexistent-vibechemy-model')
    const wav = Buffer.from(encodeWavPcm16(new Float32Array(1600)))
    await expect(asr.transcribe(wav)).rejects.toThrow('Parakeet model not found')
  })
})
