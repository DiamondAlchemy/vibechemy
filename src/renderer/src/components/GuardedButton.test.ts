import { describe, expect, it } from 'vitest'
import type { GuardedButtonTimer } from './guardedButtonController'
import { createGuardedButtonController } from './guardedButtonController'

function fakeTimer(): {
  timer: GuardedButtonTimer
  count: () => number
  nextMs: () => number | null
  fire: () => void
} {
  let sequence = 0
  const scheduled = new Map<number, { callback: () => void; timeoutMs: number }>()
  return {
    timer: {
      setTimeout: (callback, timeoutMs) => {
        const handle = ++sequence
        scheduled.set(handle, { callback, timeoutMs })
        return handle as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout: (handle) => {
        scheduled.delete(handle as unknown as number)
      }
    },
    count: () => scheduled.size,
    nextMs: () => [...scheduled.values()][0]?.timeoutMs ?? null,
    fire: () => {
      const next = [...scheduled.entries()][0]
      if (!next) return
      scheduled.delete(next[0])
      next[1].callback()
    }
  }
}

function setup(): {
  controller: ReturnType<typeof createGuardedButtonController>
  clock: ReturnType<typeof fakeTimer>
  confirmations: string[]
  armedChanges: boolean[]
} {
  const clock = fakeTimer()
  const confirmations: string[] = []
  const armedChanges: boolean[] = []
  const controller = createGuardedButtonController({
    onArmedChange: (armed) => armedChanges.push(armed),
    timer: clock.timer
  })
  return { controller, clock, confirmations, armedChanges }
}

describe('GuardedButton', () => {
  it('arms on one click without firing', () => {
    const { controller, clock, confirmations, armedChanges } = setup()

    controller.click(() => confirmations.push('confirmed'))

    expect(controller.armed).toBe(true)
    expect(confirmations).toEqual([])
    expect(armedChanges).toEqual([true])
    expect(clock.count()).toBe(1)
    expect(clock.nextMs()).toBe(3000)
  })

  it('fires once on a second click while armed', () => {
    const { controller, clock, confirmations, armedChanges } = setup()
    const confirm = (): number => confirmations.push('confirmed')

    controller.click(confirm)
    controller.click(confirm)

    expect(controller.armed).toBe(false)
    expect(confirmations).toEqual(['confirmed'])
    expect(armedChanges).toEqual([true, false])
    expect(clock.count()).toBe(0)

    controller.click(confirm)
    expect(confirmations).toEqual(['confirmed'])
  })

  it('disarms when the confirmation timeout expires', () => {
    const { controller, clock, confirmations, armedChanges } = setup()
    const confirm = (): number => confirmations.push('confirmed')

    controller.click(confirm)
    clock.fire()

    expect(controller.armed).toBe(false)
    expect(confirmations).toEqual([])
    expect(armedChanges).toEqual([true, false])

    controller.click(confirm)
    expect(confirmations).toEqual([])
  })

  it('disarms on blur', () => {
    const { controller, clock, confirmations, armedChanges } = setup()
    const confirm = (): number => confirmations.push('confirmed')

    controller.click(confirm)
    controller.blur()

    expect(controller.armed).toBe(false)
    expect(confirmations).toEqual([])
    expect(armedChanges).toEqual([true, false])
    expect(clock.count()).toBe(0)

    controller.click(confirm)
    expect(confirmations).toEqual([])
  })
})
