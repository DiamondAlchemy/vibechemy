import { describe, it, expect } from 'vitest'
import { responsiveCols } from './layouts'

describe('responsiveCols', () => {
  it('falls back to 1 column before the container has been measured', () => {
    expect(responsiveCols(0, 4)).toBe(1)
  })

  it('fits as many columns as the width allows, at the target min pane width', () => {
    expect(responsiveCols(380, 4)).toBe(1) // one pane fits
    expect(responsiveCols(760, 4)).toBe(2) // two fit
    expect(responsiveCols(1600, 4)).toBe(4) // four fit (floor 4.2 → 4)
  })

  it('never exceeds the pane count (no empty columns)', () => {
    expect(responsiveCols(5000, 2)).toBe(2)
    expect(responsiveCols(1000, 1)).toBe(1)
  })

  it('always shows at least one column even on a sliver of width', () => {
    expect(responsiveCols(50, 6)).toBe(1)
  })

  it('honors a custom min pane width', () => {
    expect(responsiveCols(900, 4, 300)).toBe(3)
  })
})
