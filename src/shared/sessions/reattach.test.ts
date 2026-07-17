import { describe, it, expect } from 'vitest'
import { shouldReattach, HEAL_MAX_ATTEMPTS } from './reattach'

const base = { deliberate: false, sessionAlive: true, attempts: 0, max: HEAL_MAX_ATTEMPTS }

describe('shouldReattach', () => {
  it('re-attaches an involuntary death of a still-alive session with budget left', () => {
    expect(shouldReattach(base)).toBe(true)
    expect(shouldReattach({ ...base, attempts: HEAL_MAX_ATTEMPTS - 1 })).toBe(true)
  })

  it('never re-attaches a DELIBERATE teardown (detach / disposeAll), even with a live session', () => {
    // The load-bearing invariant: closing a pane / quitting must not resurrect or double-attach it.
    expect(shouldReattach({ ...base, deliberate: true })).toBe(false)
    expect(shouldReattach({ ...base, deliberate: true, attempts: 0, sessionAlive: true })).toBe(false)
  })

  it('never re-attaches when the tmux SESSION is genuinely gone (that path tombstones)', () => {
    expect(shouldReattach({ ...base, sessionAlive: false })).toBe(false)
    // deliberate takes precedence but a gone session is refused regardless
    expect(shouldReattach({ ...base, sessionAlive: false, attempts: 0 })).toBe(false)
  })

  it('caps retries so a session that reports alive but never attaches cannot loop forever', () => {
    expect(shouldReattach({ ...base, attempts: HEAL_MAX_ATTEMPTS })).toBe(false)
    expect(shouldReattach({ ...base, attempts: HEAL_MAX_ATTEMPTS + 5 })).toBe(false)
  })

  it('deliberate + gone + exhausted all independently force a refusal', () => {
    expect(shouldReattach({ deliberate: true, sessionAlive: false, attempts: 9, max: 2 })).toBe(false)
  })
})
