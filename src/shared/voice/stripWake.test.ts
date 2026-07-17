import { describe, expect, it } from 'vitest'
import { stripWake } from './stripWake'

describe('stripWake', () => {
  it('strips an optional leading product name and punctuation', () => {
    expect(stripWake('Vibechemy, open the workspace')).toBe('open the workspace')
    expect(stripWake('  vibechemy:   run the tests  ')).toBe('run the tests')
  })

  it('returns empty for the wake word alone', () => {
    expect(stripWake('Vibechemy')).toBe('')
  })

  it('leaves ordinary or interior text intact', () => {
    expect(stripWake('open the workspace')).toBe('open the workspace')
    expect(stripWake('tell Vibechemy to run tests')).toBe('tell Vibechemy to run tests')
  })
})
