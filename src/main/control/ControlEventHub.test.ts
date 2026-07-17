import { describe, it, expect, afterEach, vi } from 'vitest'
import { ControlEventHub, clampAwaitTimeoutMs, type ControlEventKind } from './ControlEventHub'

afterEach(() => {
  vi.useRealTimers()
})

// A fixed clock so `at` is deterministic.
const fixedClock =
  (t = 1000): (() => number) =>
  () =>
    t

describe('ControlEventHub.record', () => {
  it('assigns a monotonic seq starting at 1 and stamps `at` from the injected clock', () => {
    const hub = new ControlEventHub({ clock: fixedClock(1234) })
    hub.record({ kind: 'worker_removed', workerId: 'w0', preset: 'codex' })
    hub.record({ kind: 'worker_added', workerId: 'w1', preset: 'codex' })
    return hub.waitFor({ timeoutMs: 0 }).then((r) => {
      expect(r.events.map((e) => e.seq)).toEqual([1, 2])
      expect(r.events[0].at).toBe(1234)
      expect(r.seq).toBe(2)
      expect(r.gap).toBe(false)
    })
  })
})

describe('ControlEventHub.waitFor', () => {
  it('returns immediately when matching events exist after sinceSeq', async () => {
    const hub = new ControlEventHub({ clock: fixedClock() })
    hub.record({ kind: 'worker_added', workerId: 'w1', preset: 'codex' }) // seq 1
    hub.record({ kind: 'worker_removed', workerId: 'w1', preset: 'codex' }) // seq 2
    const r = await hub.waitFor({ sinceSeq: 1, timeoutMs: 5000 })
    expect(r.events.map((e) => e.seq)).toEqual([2])
    expect(r.seq).toBe(2)
  })

  it('blocks, then resolves when a matching record() arrives', async () => {
    const hub = new ControlEventHub({ clock: fixedClock() })
    const p = hub.waitFor({ timeoutMs: 60_000 })
    expect(hub.waiterCount).toBe(1)
    hub.record({ kind: 'worker_state', workerId: 'w1', state: 'done', branch: null, owner: null })
    const r = await p
    expect(r.events).toHaveLength(1)
    expect(r.events[0].kind).toBe('worker_state')
    expect(hub.waiterCount).toBe(0) // waiter cleaned up
  })

  it('does NOT resolve a waiter whose kinds filter excludes the event', async () => {
    vi.useFakeTimers()
    const hub = new ControlEventHub({ clock: fixedClock() })
    const kinds: ControlEventKind[] = ['worker_state']
    const p = hub.waitFor({ kinds, timeoutMs: 5000 })
    hub.record({ kind: 'worker_added', workerId: 'w1', preset: 'codex' }) // not in filter -> waiter stays
    expect(hub.waiterCount).toBe(1)
    await vi.advanceTimersByTimeAsync(5000)
    const r = await p
    expect(r.events).toEqual([])
  })

  it('resolves empty on timeout, returning the current seq cursor', async () => {
    vi.useFakeTimers()
    const hub = new ControlEventHub({ clock: fixedClock() })
    hub.record({ kind: 'worker_added', workerId: 'w1', preset: 'codex' }) // seq 1
    const p = hub.waitFor({ sinceSeq: 1, timeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(5000)
    const r = await p
    expect(r.events).toEqual([])
    expect(r.seq).toBe(1) // cursor still advances/returns even on empty
    expect(hub.waiterCount).toBe(0)
  })

  it('with timeoutMs <= 0 returns synchronously empty when nothing matches', async () => {
    const hub = new ControlEventHub({ clock: fixedClock() })
    const r = await hub.waitFor({ timeoutMs: 0 })
    expect(r.events).toEqual([])
    expect(r.seq).toBe(0)
    expect(hub.waiterCount).toBe(0)
  })
})

describe('ControlEventHub ring buffer', () => {
  it('caps memory at the configured size, evicting oldest', async () => {
    const hub = new ControlEventHub({ cap: 3, clock: fixedClock() })
    for (let i = 0; i < 5; i++) hub.record({ kind: 'worker_added', workerId: `w${i}`, preset: 'codex' })
    const r = await hub.waitFor({ timeoutMs: 0 })
    expect(r.events.map((e) => e.seq)).toEqual([3, 4, 5]) // 1 and 2 evicted
  })

  it('flags gap:true when sinceSeq predates the retained buffer', async () => {
    const hub = new ControlEventHub({ cap: 3, clock: fixedClock() })
    for (let i = 0; i < 5; i++) hub.record({ kind: 'worker_added', workerId: `w${i}`, preset: 'codex' }) // retained seqs 3,4,5
    const stale = await hub.waitFor({ sinceSeq: 1, timeoutMs: 0 })
    expect(stale.gap).toBe(true)
    const fresh = await hub.waitFor({ sinceSeq: 4, timeoutMs: 0 })
    expect(fresh.gap).toBe(false)
  })

  it('flags gap:true when sinceSeq exceeds lastSeq (seq regression after server restart)', async () => {
    // A fresh hub (simulates server restart): lastSeq=0, oldestSeq=0.
    // A long-lived client had sinceSeq=100; after restart new events start at seq 1.
    const hub = new ControlEventHub({ clock: fixedClock() })
    hub.record({ kind: 'worker_added', workerId: 'w1', preset: 'codex' }) // seq 1
    hub.record({ kind: 'worker_added', workerId: 'w2', preset: 'codex' }) // seq 2
    // sinceSeq=100 > lastSeq=2 => regression => must be gap:true so client re-syncs.
    const r = await hub.waitFor({ sinceSeq: 100, timeoutMs: 0 })
    expect(r.gap).toBe(true)
    expect(r.events).toEqual([]) // nothing with seq > 100
    expect(r.seq).toBe(2)
  })
})

describe('ControlEventHub kinds filter', () => {
  it('undefined kinds matches all events', async () => {
    const hub = new ControlEventHub({ clock: fixedClock() })
    hub.record({ kind: 'worker_state', workerId: 'w', state: 'needs_review', branch: null, owner: null })
    hub.record({ kind: 'worker_added', workerId: 'w', preset: 'codex' })
    const r = await hub.waitFor({ timeoutMs: 5000 }) // kinds undefined
    expect(r.events).toHaveLength(2)
  })

  it('an empty kinds list matches NOTHING (a typo subscription gets silence, not the firehose)', async () => {
    vi.useFakeTimers()
    const hub = new ControlEventHub({ clock: fixedClock() })
    const p = hub.waitFor({ kinds: [], timeoutMs: 5000 })
    hub.record({ kind: 'worker_added', workerId: 'w', preset: 'codex' }) // [] excludes it -> waiter stays
    expect(hub.waiterCount).toBe(1)
    await vi.advanceTimersByTimeAsync(5000)
    const r = await p
    expect(r.events).toEqual([])
    expect(r.seq).toBe(1) // still reports the hub tip so the next call advances
  })
})

describe('clampAwaitTimeoutMs', () => {
  it('defaults to 60s and clamps to the [1s, 240s] long-poll window', () => {
    expect(clampAwaitTimeoutMs(undefined)).toBe(60_000)
    expect(clampAwaitTimeoutMs(0)).toBe(1_000)
    expect(clampAwaitTimeoutMs(500)).toBe(1_000)
    expect(clampAwaitTimeoutMs(120_000)).toBe(120_000)
    expect(clampAwaitTimeoutMs(999_999)).toBe(240_000)
  })
})
