import { describe, expect, it } from 'vitest'
import type { AsrProvider, AsrStatus } from './AsrProvider'
import { AsrRouter } from './AsrRouter'

function fakeProvider(
  engine: string,
  options: { available?: boolean; text?: string; fail?: boolean } = {}
): AsrProvider & { calls: number; disposals: number } {
  const provider = {
    calls: 0,
    disposals: 0,
    status: (): AsrStatus => ({ available: options.available !== false, engine }),
    transcribe: async (): Promise<string> => {
      provider.calls++
      if (options.fail) throw new Error(`${engine} failed`)
      return options.text ?? `${engine} transcript`
    },
    dispose: (): void => {
      provider.disposals++
    }
  }
  return provider
}

describe('AsrRouter', () => {
  it('uses the first available provider', async () => {
    const unavailable = fakeProvider('first', { available: false })
    const ready = fakeProvider('second')
    const router = new AsrRouter([
      { engine: 'first', provider: unavailable },
      { engine: 'second', provider: ready }
    ])
    expect(router.status()).toMatchObject({ available: true, engine: 'second' })
    expect(await router.transcribe(Buffer.alloc(0))).toBe('second transcript')
    expect(unavailable.calls).toBe(0)
    expect(ready.calls).toBe(1)
  })

  it('fails over once when an available provider throws', async () => {
    const first = fakeProvider('first', { fail: true })
    const second = fakeProvider('second')
    const router = new AsrRouter([
      { engine: 'first', provider: first },
      { engine: 'second', provider: second }
    ])
    expect(await router.transcribe(Buffer.alloc(0))).toBe('second transcript')
    expect(first.calls).toBe(1)
    expect(second.calls).toBe(1)
  })

  it('reports an honest unavailable reason and does not call a missing engine', async () => {
    const provider = fakeProvider('parakeet', { available: false })
    provider.status = () => ({ available: false, engine: 'parakeet', reason: 'model missing' })
    const router = new AsrRouter([{ engine: 'parakeet', provider }])
    expect(router.status()).toEqual({ available: false, engine: 'parakeet', reason: 'model missing' })
    await expect(router.transcribe(Buffer.alloc(0))).rejects.toThrow('model missing')
    expect(provider.calls).toBe(0)
  })

  it('preserves the first engine error when every available provider fails', async () => {
    const router = new AsrRouter([
      { engine: 'first', provider: fakeProvider('first', { fail: true }) },
      { engine: 'second', provider: fakeProvider('second', { fail: true }) }
    ])
    await expect(router.transcribe(Buffer.alloc(0))).rejects.toThrow('first failed')
  })

  it('supports an empty future provider roster and disposes every route', () => {
    expect(new AsrRouter([]).status()).toEqual({
      available: false,
      reason: 'no local speech recognition engine configured'
    })
    const first = fakeProvider('first')
    const second = fakeProvider('second')
    new AsrRouter([
      { engine: 'first', provider: first },
      { engine: 'second', provider: second }
    ]).dispose()
    expect(first.disposals).toBe(1)
    expect(second.disposals).toBe(1)
  })
})
