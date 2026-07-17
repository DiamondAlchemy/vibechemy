import { describe, it, expect } from 'vitest'
import { STARTER_STANDARDS } from './seed'

// Pure (no DB), so it runs under vitest regardless of the better-sqlite3 ABI.
const CATEGORIES = ['style', 'naming', 'testing', 'git', 'arch', 'deps', 'general']

describe('STARTER_STANDARDS', () => {
  it('is a non-empty set of well-formed, rule-first entries', () => {
    expect(STARTER_STANDARDS.length).toBeGreaterThan(0)
    for (const s of STARTER_STANDARDS) {
      expect(s.rule.trim().length).toBeGreaterThan(0)
      expect(CATEGORIES).toContain(s.category)
    }
  })

  it('keeps each rule a single tight line — it rides into every pane on every spawn', () => {
    for (const s of STARTER_STANDARDS) {
      expect(s.rule).not.toContain('\n')
      expect(s.rule.length).toBeLessThan(160)
    }
  })
})
