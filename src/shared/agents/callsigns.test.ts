import { describe, it, expect } from 'vitest'
import { pickCallsign } from './callsigns'

describe('auto-callsigns', () => {
  it('never reuses a live name (case-insensitive) and varies by seed', () => {
    const a = pickCallsign([], 1)
    const b = pickCallsign([a!], 1)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b!.toLowerCase()).not.toBe(a!.toLowerCase())
    expect(pickCallsign(['beacon'], 0)).not.toBe('Beacon')
  })
  it('returns null when the pool is exhausted', () => {
    const all: string[] = []
    for (let i = 0; i < 100; i++) {
      const n = pickCallsign(all, i)
      if (!n) break
      all.push(n)
    }
    expect(all.length).toBeGreaterThan(50)
    expect(pickCallsign(all, 5)).toBeNull()
  })
})
