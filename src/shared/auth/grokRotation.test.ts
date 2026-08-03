import { describe, it, expect } from 'vitest'
import { planGrokToken, GROK_SKEW_S } from './grokRotation'

const NOW = 1_800_000_000_000 // fixed clock, seconds = 1_800_000_000
const nowSec = NOW / 1000

describe('planGrokToken', () => {
  it('uses a healthy token without rotating, even when rotation is allowed', () => {
    const plan = planGrokToken({ accessExpSec: nowSec + 3600, nowMs: NOW, allowRotation: true })
    expect(plan).toBe('use-current')
  })

  it('rotates an expiring token only when the operator opted in', () => {
    const expiring = { accessExpSec: nowSec + GROK_SKEW_S - 1, nowMs: NOW }
    expect(planGrokToken({ ...expiring, allowRotation: true })).toBe('rotate')
    expect(planGrokToken({ ...expiring, allowRotation: false })).toBe('use-current') // still alive
  })

  it('NEVER rotates a fully expired token while the gate is off', () => {
    // The whole point: rotation POSTs the refresh token and rewrites ~/.grok/auth.json, a file
    // this app does not own. Without consent the answer is fallback, never a write.
    const plan = planGrokToken({ accessExpSec: nowSec - 10, nowMs: NOW, allowRotation: false })
    expect(plan).toBe('fallback')
  })

  it('rotates a fully expired token once opted in', () => {
    expect(planGrokToken({ accessExpSec: nowSec - 10, nowMs: NOW, allowRotation: true })).toBe('rotate')
  })

  it('treats an unparseable exp (0) as expired, and still refuses to write while gated', () => {
    expect(planGrokToken({ accessExpSec: 0, nowMs: NOW, allowRotation: false })).toBe('fallback')
    expect(planGrokToken({ accessExpSec: 0, nowMs: NOW, allowRotation: true })).toBe('rotate')
  })

  it('never returns rotate for any expiry when rotation is off', () => {
    // Exhaustive across the interesting range: a gated app must have NO path that writes.
    for (const offset of [-10_000, -1, 0, 1, GROK_SKEW_S, 10_000]) {
      expect(planGrokToken({ accessExpSec: nowSec + offset, nowMs: NOW, allowRotation: false })).not.toBe('rotate')
    }
  })
})
