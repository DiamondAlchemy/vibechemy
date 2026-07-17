import { describe, expect, it, vi } from 'vitest'
import { SettledResizeCoordinator, type TerminalGridSize } from './settledResize'

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('SettledResizeCoordinator', () => {
  it('never overlaps transactions and retains only the final trailing size', async () => {
    const first = deferred()
    const second = deferred()
    const calls: TerminalGridSize[] = []
    let active = 0
    let maxActive = 0
    const coordinator = new SettledResizeCoordinator(async (size) => {
      calls.push(size)
      active += 1
      maxActive = Math.max(maxActive, active)
      await (calls.length === 1 ? first.promise : second.promise)
      active -= 1
    })

    coordinator.request({ cols: 40, rows: 10 })
    coordinator.request({ cols: 80, rows: 20 })
    coordinator.request({ cols: 120, rows: 40 })
    expect(calls).toEqual([{ cols: 40, rows: 10 }])

    first.resolve()
    await tick()
    expect(calls).toEqual([
      { cols: 40, rows: 10 },
      { cols: 120, rows: 40 }
    ])
    expect(maxActive).toBe(1)

    second.resolve()
    await tick()
    expect(maxActive).toBe(1)
  })

  it('deduplicates the active size and ignores trailing work after stop', async () => {
    const inFlight = deferred()
    const transact = vi.fn(() => inFlight.promise)
    const coordinator = new SettledResizeCoordinator(transact)

    coordinator.request({ cols: 100, rows: 30 })
    coordinator.request({ cols: 100, rows: 30 })
    coordinator.stop()
    coordinator.request({ cols: 140, rows: 45 })
    inFlight.resolve()
    await tick()

    expect(transact).toHaveBeenCalledTimes(1)
  })

  it('reports a failure and allows the same final size to be retried', async () => {
    const onError = vi.fn()
    const transact = vi.fn().mockRejectedValueOnce(new Error('attach failed')).mockResolvedValue(undefined)
    const coordinator = new SettledResizeCoordinator(transact, onError)

    coordinator.request({ cols: 90, rows: 25 })
    await tick()
    coordinator.request({ cols: 90, rows: 25 })
    await tick()

    expect(onError).toHaveBeenCalledOnce()
    expect(transact).toHaveBeenCalledTimes(2)
  })
})
