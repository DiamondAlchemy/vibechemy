import { describe, expect, it } from 'vitest'
import { beginPrecheck, completePrecheck, formatPrecheck, type PrecheckCache } from './reviewPrecheck'

describe('review precheck cache', () => {
  it('starts each session once and retains completed results across reselection', () => {
    const empty: PrecheckCache = {}
    const running = beginPrecheck(empty, 'worker-1')
    expect(running['worker-1']).toEqual({ phase: 'running' })
    expect(beginPrecheck(running, 'worker-1')).toBe(running)

    const complete = completePrecheck(running, 'worker-1', {
      configured: true,
      command: 'npm run check',
      exitCode: 0,
      output: 'Tests  14 passed (14)'
    })
    expect(beginPrecheck(complete, 'worker-1')).toBe(complete)
    expect(complete['worker-1']).toMatchObject({ phase: 'complete' })
  })
})

describe('review precheck formatting', () => {
  it('formats running, passing, failing, and unconfigured results', () => {
    expect(formatPrecheck({ phase: 'running' })).toBe('checks …')
    expect(
      formatPrecheck({
        phase: 'complete',
        result: { configured: true, exitCode: 0, output: '\u001b[32mTests  14 passed (14)\u001b[39m' }
      })
    ).toBe('checks ✓ 14/14')
    expect(formatPrecheck({ phase: 'complete', result: { configured: true, exitCode: 1, output: '1 failed' } })).toBe(
      'checks ✗'
    )
    expect(formatPrecheck({ phase: 'complete', result: { configured: false, exitCode: null, output: '' } })).toBe(
      'no check configured'
    )
  })

  it('shows a successful check without counts when the runner has no test summary', () => {
    expect(
      formatPrecheck({ phase: 'complete', result: { configured: true, exitCode: 0, output: 'build complete' } })
    ).toBe('checks ✓')
  })
})
