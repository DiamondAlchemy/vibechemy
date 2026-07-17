import { describe, it, expect } from 'vitest'
import { waitForPaneStable } from './paneReady'

/** Deterministic harness: scripted capture snapshots + a fake clock driven by delay(). */
const harness = (
  snaps: string[]
): {
  capture: (name: string) => Promise<string>
  delay: (ms: number) => Promise<void>
  now: () => number
  delays: number[]
  captures: number
} => {
  let t = 0
  let i = 0
  const delays: number[] = []
  const h = {
    capture: async (): Promise<string> => snaps[Math.min(i++, snaps.length - 1)],
    delay: async (ms: number): Promise<void> => {
      delays.push(ms)
      t += ms
    },
    now: (): number => t,
    delays,
    get captures(): number {
      return i
    }
  }
  return h
}

describe('waitForPaneStable', () => {
  it('resolves once two consecutive captures match (output stabilized)', async () => {
    const h = harness(['boot...', 'boot... done', 'ready >', 'ready >'])
    await waitForPaneStable('s', { capture: h.capture, delay: h.delay, now: h.now })
    expect(h.captures).toBe(4)
  })

  it('treats a poll-to-poll spinner/cursor flicker as settled (small char-diff)', async () => {
    // banner has settled; only a 1-char spinner glyph toggles on the active line. Exact-equality
    // would spin to the 30s deadline; the char-diff tolerance latches on the tiny change.
    const h = harness(['booting the cli...', 'ready > ⠋', 'ready > ⠙', 'ready > ⠹', 'ready > ⠸'])
    await waitForPaneStable('s', { capture: h.capture, delay: h.delay, now: h.now, maxWaitMs: 30000, pollMs: 100 })
    expect(h.captures).toBeLessThanOrEqual(4) // settled on the flicker, not the deadline
  })

  it('waits the floor before the first capture', async () => {
    const h = harness(['ready >', 'ready >'])
    await waitForPaneStable('s', { capture: h.capture, delay: h.delay, now: h.now, floorMs: 2500 })
    expect(h.delays[0]).toBe(2500)
  })

  it('never treats empty output as stable', async () => {
    const h = harness([''])
    await waitForPaneStable('s', {
      capture: h.capture,
      delay: h.delay,
      now: h.now,
      floorMs: 100,
      pollMs: 100,
      maxWaitMs: 1000
    })
    // ran to the deadline instead of latching onto '' === ''
    expect(h.captures).toBeGreaterThan(3)
  })

  it('gives up at maxWaitMs when output never stabilizes (best-effort, no throw)', async () => {
    let n = 0
    // Change MANY chars each poll (a full rewrite, not a 1-char counter) so it stays above the
    // char-diff tolerance and genuinely never settles — exercises the maxWaitMs give-up path.
    const capture = async (): Promise<string> => String(n++ % 10).repeat(20)
    const h = harness([])
    await expect(
      waitForPaneStable('s', {
        capture,
        delay: h.delay,
        now: h.now,
        floorMs: 100,
        pollMs: 200,
        maxWaitMs: 1000
      })
    ).resolves.toBeUndefined()
  })

  it('swallows capture errors and keeps polling', async () => {
    let n = 0
    const capture = async (): Promise<string> => {
      n++
      if (n < 2) throw new Error('pane not there yet')
      return 'ready >'
    }
    const h = harness([])
    await waitForPaneStable('s', { capture, delay: h.delay, now: h.now, floorMs: 100, pollMs: 100 })
    expect(n).toBeGreaterThanOrEqual(3)
  })

  it('bails early after 3 consecutive capture failures (pane is gone)', async () => {
    let n = 0
    const capture = async (): Promise<string> => {
      n++
      throw new Error('no such session')
    }
    const h = harness([])
    await waitForPaneStable('s', {
      capture,
      delay: h.delay,
      now: h.now,
      floorMs: 100,
      pollMs: 100,
      maxWaitMs: 60000
    })
    expect(n).toBe(3) // did NOT run to the 60s deadline
  })
})
