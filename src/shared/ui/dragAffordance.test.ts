import { describe, it, expect } from 'vitest'
import { clearsDragAffordance } from './dragAffordance'

describe('clearsDragAffordance', () => {
  it('clears on any drag ending we can observe', () => {
    expect(clearsDragAffordance({ type: 'dragend' })).toBe(true)
    expect(clearsDragAffordance({ type: 'drop' })).toBe(true)
  })
  it('buttons-glue-guard: a mousemove with no button held means the drag already ended', () => {
    expect(clearsDragAffordance({ type: 'mousemove', buttons: 0 })).toBe(true)
  })
  it('a mousemove with a button still held is NOT an ending (mid-gesture)', () => {
    expect(clearsDragAffordance({ type: 'mousemove', buttons: 1 })).toBe(false)
    expect(clearsDragAffordance({ type: 'mousemove', buttons: 2 })).toBe(false)
  })
})
