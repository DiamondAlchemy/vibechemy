import { describe, expect, it } from 'vitest'
import { ARM_DELAY_MS, AUTO_SUBMIT_DELAY_MS, isDictationBlocked, MIN_HOLD_MS } from './useDictation'

describe('isDictationBlocked', () => {
  it('allows non-editable targets and xterm helper textareas', () => {
    expect(isDictationBlocked(null)).toBe(false)
    expect(isDictationBlocked({ tagName: 'BODY' })).toBe(false)
    expect(isDictationBlocked({ tagName: 'BUTTON' })).toBe(false)
    expect(isDictationBlocked({ tagName: 'TEXTAREA', className: 'xterm-helper-textarea' })).toBe(false)
  })

  it('blocks real inputs, textareas, and content-editable elements', () => {
    expect(isDictationBlocked({ tagName: 'INPUT' })).toBe(true)
    expect(isDictationBlocked({ tagName: 'TEXTAREA', className: 'command-input' })).toBe(true)
    expect(isDictationBlocked({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })
})

describe('dictation timing safety', () => {
  it('arms after shortcut gestures settle but before a valid hold can complete', () => {
    expect(ARM_DELAY_MS).toBeGreaterThanOrEqual(100)
    expect(ARM_DELAY_MS).toBeLessThan(MIN_HOLD_MS)
    expect(MIN_HOLD_MS).toBeGreaterThanOrEqual(200)
  })

  it('keeps auto-submit as a discrete delayed Enter', () => {
    expect(AUTO_SUBMIT_DELAY_MS).toBe(300)
  })
})
