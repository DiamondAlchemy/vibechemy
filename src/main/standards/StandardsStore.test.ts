import { describe, it, expect } from 'vitest'
import { renderStandards, MAX_INJECTED } from './StandardsStore'
import type { StandardEntry } from '@shared/types'

// renderStandards is pure (no DB), so it runs under vitest regardless of the better-sqlite3 ABI
// state. It's the highest-risk piece — its output is injected into every worker's brief.
const mk = (over: Partial<StandardEntry>): StandardEntry => ({
  id: 'x',
  projectId: null,
  category: 'general',
  rule: 'Use named exports.',
  detail: null,
  status: 'active',
  sort: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over
})

describe('renderStandards', () => {
  it('returns empty string when there are no standards (so the brief omits the section)', () => {
    expect(renderStandards([])).toBe('')
  })

  it('leads with the rule as a bullet and indents detail under it', () => {
    const out = renderStandards([
      mk({ rule: 'Use named exports; no default exports.' }),
      mk({ rule: 'Prefer early returns.', detail: 'Avoid deep nesting.\nKeep the happy path last.' })
    ])
    expect(out).toBe(
      [
        '- Use named exports; no default exports.',
        '- Prefer early returns.',
        '  Avoid deep nesting.',
        '  Keep the happy path last.'
      ].join('\n')
    )
  })

  it('caps the number of injected standards', () => {
    const many = Array.from({ length: 50 }, (_, i) => mk({ rule: `Rule ${i}` }))
    const out = renderStandards(many, 3)
    expect(out.split('\n')).toHaveLength(3)
    expect(out).toContain('Rule 0')
    expect(out).not.toContain('Rule 3')
  })

  it('defaults the cap to MAX_INJECTED', () => {
    const many = Array.from({ length: MAX_INJECTED + 10 }, (_, i) => mk({ rule: `R${i}` }))
    expect(renderStandards(many).split('\n')).toHaveLength(MAX_INJECTED)
  })

  it('trims whitespace in rule and detail', () => {
    expect(renderStandards([mk({ rule: '  Trim me.  ', detail: '  why.  ' })])).toBe('- Trim me.\n  why.')
  })
})
