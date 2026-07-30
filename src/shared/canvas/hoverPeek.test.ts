import { describe, it, expect } from 'vitest'
import {
  isPeekablePaneSize,
  HOVER_PEEK_MARGIN,
  HOVER_PEEK_MAX_FACTOR,
  HOVER_PEEK_VIEWPORT_FRAC,
  peekRect
} from './hoverPeek'

const vp = { x: 0, y: 0, w: 2000, h: 1000 }

describe('peekRect', () => {
  it('grows a tiny pane toward the viewport fraction, capped at the max factor', () => {
    const pane = { x: 900, y: 400, w: 100, h: 80 }
    const r = peekRect(pane, vp)!
    expect(r.w / pane.w).toBe(HOVER_PEEK_MAX_FACTOR)
    expect(r.h / pane.h).toBe(HOVER_PEEK_MAX_FACTOR)
    expect(r.x + r.w / 2).toBeCloseTo(950)
    expect(r.y + r.h / 2).toBeCloseTo(440)
  })

  it('targets the viewport fraction for a mid-size pane with its aspect preserved', () => {
    const pane = { x: 800, y: 350, w: 500, h: 300 }
    const r = peekRect(pane, vp)!
    const k = r.w / pane.w
    expect(k).toBeCloseTo((vp.h * HOVER_PEEK_VIEWPORT_FRAC) / pane.h)
    expect(r.h / pane.h).toBeCloseTo(k)
  })

  it('clamps an edge pane fully inside the viewport with margin', () => {
    const pane = { x: 0, y: 0, w: 300, h: 200 }
    const r = peekRect(pane, vp)!
    expect(r.x).toBeGreaterThanOrEqual(HOVER_PEEK_MARGIN)
    expect(r.y).toBeGreaterThanOrEqual(HOVER_PEEK_MARGIN)
    expect(r.x + r.w).toBeLessThanOrEqual(vp.w - HOVER_PEEK_MARGIN)
    expect(r.y + r.h).toBeLessThanOrEqual(vp.h - HOVER_PEEK_MARGIN)
  })

  it('returns null when there is no meaningful growth', () => {
    expect(peekRect({ x: 0, y: 0, w: 1950, h: 960 }, vp)).toBeNull()
    expect(peekRect({ x: 0, y: 0, w: 0, h: 100 }, vp)).toBeNull()
  })

  it('respects a scrolled viewport origin', () => {
    const scrolled = { x: 500, y: 300, w: 1000, h: 600 }
    const pane = { x: 510, y: 310, w: 150, h: 100 }
    const r = peekRect(pane, scrolled)!
    expect(r.x).toBeGreaterThanOrEqual(500 + HOVER_PEEK_MARGIN)
    expect(r.y).toBeGreaterThanOrEqual(300 + HOVER_PEEK_MARGIN)
    expect(r.x + r.w).toBeLessThanOrEqual(1500 - HOVER_PEEK_MARGIN)
    expect(r.y + r.h).toBeLessThanOrEqual(900 - HOVER_PEEK_MARGIN)
  })
})

describe('isPeekablePaneSize', () => {
  it('accepts tidy-size and hand-shrunk panes', () => {
    expect(isPeekablePaneSize({ x: 0, y: 0, w: 260, h: 170 })).toBe(true)
    expect(isPeekablePaneSize({ x: 0, y: 0, w: 320, h: 200 })).toBe(true)
    expect(isPeekablePaneSize({ x: 0, y: 0, w: 180, h: 120 })).toBe(true)
  })

  it('rejects deliberately larger panes', () => {
    expect(isPeekablePaneSize({ x: 0, y: 0, w: 700, h: 400 })).toBe(false)
    expect(isPeekablePaneSize({ x: 0, y: 0, w: 260, h: 400 })).toBe(false)
    expect(isPeekablePaneSize({ x: 0, y: 0, w: 500, h: 170 })).toBe(false)
  })
})
