import { describe, expect, it } from 'vitest'
import type { AsrProvider } from './AsrProvider'
import { downloadCommandFor, VoiceService } from './VoiceService'

function provider(): AsrProvider & { disposed: number } {
  const fake = {
    disposed: 0,
    status: () => ({ available: true, engine: 'parakeet', model: 'Local model' }),
    transcribe: async () => 'local transcript',
    dispose: () => {
      fake.disposed++
    }
  }
  return fake
}

describe('VoiceService', () => {
  it('exposes provider status plus a shell-safe visible download command', () => {
    const service = new VoiceService(provider(), "/Applications/Vibechemy's Tools/fetch.sh")
    expect(service.status()).toEqual({
      available: true,
      engine: 'parakeet',
      model: 'Local model',
      downloadCommand: "bash '/Applications/Vibechemy'\\''s Tools/fetch.sh'"
    })
    expect(downloadCommandFor('/tmp/fetch voice.sh')).toBe("bash '/tmp/fetch voice.sh'")
  })

  it('delegates transcription and disposes once', async () => {
    const fake = provider()
    const service = new VoiceService(fake)
    expect(await service.transcribe(Buffer.alloc(0))).toBe('local transcript')
    service.dispose()
    service.dispose()
    expect(fake.disposed).toBe(1)
    expect(service.status()).toEqual({ available: false, reason: 'voice service disposed' })
    await expect(service.transcribe(Buffer.alloc(0))).rejects.toThrow('voice service disposed')
  })
})
