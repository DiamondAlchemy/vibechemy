import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBus } from './EventBus'
import type { McEvent } from '@shared/events'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('EventBus', () => {
  it('emit fires exactly one send after the debounce window', () => {
    const send = vi.fn<(e: McEvent) => void>()
    const bus = new EventBus(send)
    bus.emit('sessions')
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ kind: 'sessions' })
  })

  it('coalesces a burst of same-kind emits into one send', () => {
    const send = vi.fn<(e: McEvent) => void>()
    const bus = new EventBus(send)
    bus.emit('sessions')
    bus.emit('sessions')
    bus.emit('sessions')
    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ kind: 'sessions' })
  })

  it('debounces per kind — interleaved kinds each send once', () => {
    const send = vi.fn<(e: McEvent) => void>()
    const bus = new EventBus(send)
    bus.emit('sessions')
    bus.emit('activity')
    bus.emit('sessions')
    bus.emit('activity')
    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith({ kind: 'sessions' })
    expect(send).toHaveBeenCalledWith({ kind: 'activity' })
  })

  it('dispose cancels pending timers — no send after', () => {
    const send = vi.fn<(e: McEvent) => void>()
    const bus = new EventBus(send)
    bus.emit('sessions')
    bus.dispose()
    vi.advanceTimersByTime(200)
    expect(send).not.toHaveBeenCalled()
  })
})
