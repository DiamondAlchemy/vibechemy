import { describe, it, expect } from 'vitest'
import {
  stepZoom,
  accumulateZoomWheel,
  fitScale,
  hitTestPane,
  pickFocusPane,
  focusRect,
  FOCUS_SCALE,
  FOCUS_MAX_VIEWPORT_FRAC,
  FOCUS_MIN_WIDTH_FRAC,
  ZOOM_STEP_THRESHOLD,
  ZOOM_STEP_COOLDOWN_MS,
  ZOOM_ACCUM_IDLE_RESET_MS,
  ZOOM_WHEEL_IDLE,
  type ZoomWheelState
} from './zoom'

describe('stepZoom', () => {
  it('steps inward overview -> default -> focus', () => {
    expect(stepZoom('overview', 1)).toBe('default')
    expect(stepZoom('default', 1)).toBe('focus')
  })
  it('steps outward focus -> default -> overview', () => {
    expect(stepZoom('focus', -1)).toBe('default')
    expect(stepZoom('default', -1)).toBe('overview')
  })
  it('clamps at both ends', () => {
    expect(stepZoom('focus', 1)).toBe('focus')
    expect(stepZoom('overview', -1)).toBe('overview')
  })
})

describe('accumulateZoomWheel', () => {
  it('accumulates small deltas below the threshold without stepping', () => {
    const r = accumulateZoomWheel(ZOOM_WHEEL_IDLE, -10, 1000)
    expect(r.step).toBe(0)
    expect(r.next.accum).toBe(-10)
  })

  it('steps IN (+1) once accumulated pinch-in deltas cross the threshold, then resets', () => {
    let state: ZoomWheelState = ZOOM_WHEEL_IDLE
    let now = 1000
    let stepped = 0
    // pinch-in arrives as a burst of small NEGATIVE deltas
    for (let i = 0; i < 20; i++) {
      const r = accumulateZoomWheel(state, -(ZOOM_STEP_THRESHOLD / 4), now)
      state = r.next
      stepped += r.step
      now += 16
    }
    expect(stepped).toBe(1) // one pinch = exactly one step (cooldown eats the tail)
    expect(state.accum).toBe(0)
  })

  it('steps OUT (-1) for positive (pinch-out / scroll-down) deltas', () => {
    const r = accumulateZoomWheel(ZOOM_WHEEL_IDLE, ZOOM_STEP_THRESHOLD, 1000)
    expect(r.step).toBe(-1)
    expect(r.next.accum).toBe(0)
  })

  it('a single mouse-wheel notch (|deltaY| 120) steps immediately', () => {
    expect(accumulateZoomWheel(ZOOM_WHEEL_IDLE, -120, 1000).step).toBe(1)
    expect(accumulateZoomWheel(ZOOM_WHEEL_IDLE, 120, 1000).step).toBe(-1)
  })

  it('swallows deltas inside the cooldown after a step, even huge ones', () => {
    const first = accumulateZoomWheel(ZOOM_WHEEL_IDLE, -120, 1000)
    expect(first.step).toBe(1)
    const during = accumulateZoomWheel(first.next, -500, 1000 + ZOOM_STEP_COOLDOWN_MS - 1)
    expect(during.step).toBe(0)
    expect(during.next.accum).toBe(0) // swallowed, not banked for later
  })

  it('steps again once the cooldown has passed', () => {
    const first = accumulateZoomWheel(ZOOM_WHEEL_IDLE, -120, 1000)
    const after = accumulateZoomWheel(first.next, -120, 1000 + ZOOM_STEP_COOLDOWN_MS + 1)
    expect(after.step).toBe(1)
  })

  it('resets a stale partial accumulation after an idle gap', () => {
    const partial = accumulateZoomWheel(ZOOM_WHEEL_IDLE, -(ZOOM_STEP_THRESHOLD - 1), 1000)
    expect(partial.step).toBe(0)
    // long pause — the abandoned pinch must not leave a hair-trigger behind
    const later = accumulateZoomWheel(partial.next, -1, 1000 + ZOOM_ACCUM_IDLE_RESET_MS + 1)
    expect(later.step).toBe(0)
    expect(later.next.accum).toBe(-1)
  })

  it('mixed-sign deltas sum (a wobbly pinch nets out)', () => {
    const a = accumulateZoomWheel(ZOOM_WHEEL_IDLE, 40, 1000)
    const b = accumulateZoomWheel(a.next, -20, 1016)
    expect(b.step).toBe(0)
    expect(b.next.accum).toBe(20)
  })
})

describe('fitScale', () => {
  it('fits by the limiting axis (width)', () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 1000, height: 1000 })).toBe(0.5)
  })
  it('fits by the limiting axis (height)', () => {
    expect(fitScale({ width: 1000, height: 2000 }, { width: 1000, height: 1000 })).toBe(0.5)
  })
  it('never upscales past 1', () => {
    expect(fitScale({ width: 500, height: 500 }, { width: 1000, height: 1000 })).toBe(1)
  })
  it('board 4/3 of viewport fits at exactly 0.75', () => {
    expect(fitScale({ width: 1600, height: 1200 }, { width: 1200, height: 900 })).toBe(0.75)
  })
  it('degenerate content falls back to 1', () => {
    expect(fitScale({ width: 0, height: 100 }, { width: 1000, height: 1000 })).toBe(1)
    expect(fitScale({ width: -5, height: 100 }, { width: 1000, height: 1000 })).toBe(1)
    expect(fitScale({ width: NaN, height: 100 }, { width: 1000, height: 1000 })).toBe(1)
  })
  it('degenerate viewport falls back to 1', () => {
    expect(fitScale({ width: 1000, height: 1000 }, { width: 0, height: 0 })).toBe(1)
  })
})

describe('hitTestPane', () => {
  const panes = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'b', rect: { x: 50, y: 50, w: 100, h: 100 } },
    { id: 'c', rect: { x: 300, y: 300, w: 100, h: 100 } }
  ]

  it('returns the pane containing the point', () => {
    expect(hitTestPane({ x: 320, y: 320 }, panes)).toBe('c')
  })
  it('overlap: the later pane in paint order (on top) wins', () => {
    expect(hitTestPane({ x: 75, y: 75 }, panes)).toBe('b')
  })
  it('overlap: the front pane wins even when earlier in paint order', () => {
    expect(hitTestPane({ x: 75, y: 75 }, panes, 'a')).toBe('a')
  })
  it('a frontId that is not under the point is ignored', () => {
    expect(hitTestPane({ x: 320, y: 320 }, panes, 'a')).toBe('c')
  })
  it('returns null when nothing is under the point', () => {
    expect(hitTestPane({ x: 250, y: 20 }, panes)).toBeNull()
  })
  it('containment is inclusive of the left/top edge, exclusive of right/bottom', () => {
    expect(hitTestPane({ x: 0, y: 0 }, panes)).toBe('a')
    expect(hitTestPane({ x: 400, y: 400 }, panes)).toBeNull()
  })
})

describe('pickFocusPane (fallback ordering: hover > front > first)', () => {
  const panes = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'b', rect: { x: 200, y: 0, w: 100, h: 100 } }
  ]

  it('the pane under the point wins even when another pane is front/selected', () => {
    expect(pickFocusPane({ x: 250, y: 50 }, panes, 'a')).toBe('b')
  })
  it('a point over empty canvas falls back to the front pane', () => {
    expect(pickFocusPane({ x: 150, y: 50 }, panes, 'b')).toBe('b')
  })
  it('no point (pointer not over the canvas) falls back to the front pane', () => {
    expect(pickFocusPane(null, panes, 'b')).toBe('b')
  })
  it('no point and no live front falls back to the first pane', () => {
    expect(pickFocusPane(null, panes, null)).toBe('a')
    expect(pickFocusPane(null, panes, 'gone')).toBe('a')
  })
  it('a missed hit with no live front falls back to the first pane', () => {
    expect(pickFocusPane({ x: 150, y: 50 }, panes, 'gone')).toBe('a')
  })
  it('returns null when there are no panes to focus', () => {
    expect(pickFocusPane({ x: 10, y: 10 }, [], 'a')).toBeNull()
    expect(pickFocusPane(null, [], null)).toBeNull()
  })
})

describe('focusRect (Focus spotlight: ~2x, centered, never the whole screen)', () => {
  const vp = { width: 2000, height: 1200 }

  it('grows a mid-size pane to exactly 2x, centered', () => {
    const r = focusRect({ x: 40, y: 60, w: 700, h: 450 }, vp)
    expect(r).toEqual({ x: 300, y: 150, w: 1400, h: 900 })
  })

  it('a small pane still comes meaningfully forward (min 55% viewport width, aspect kept)', () => {
    const r = focusRect({ x: 0, y: 0, w: 300, h: 200 }, vp)
    expect(r.w).toBeCloseTo(FOCUS_MIN_WIDTH_FRAC * vp.width) // 1100
    expect(r.h).toBeCloseTo((200 / 300) * r.w) // uniform scale — aspect preserved
    expect(r.x).toBeCloseTo((vp.width - r.w) / 2)
    expect(r.y).toBeCloseTo((vp.height - r.h) / 2)
  })

  it('a large pane is capped at 85% of the viewport in both axes', () => {
    const r = focusRect({ x: 0, y: 0, w: 1000, h: 640 }, vp)
    expect(r.h).toBeCloseTo(FOCUS_MAX_VIEWPORT_FRAC * vp.height) // 1020 — height cap binds first
    expect(r.w).toBeCloseTo(1000 * (r.h / 640)) // uniform scale
    expect(r.w).toBeLessThanOrEqual(FOCUS_MAX_VIEWPORT_FRAC * vp.width + 0.01)
  })

  it('a huge pane SHRINKS to the 85% cap — Focus never absorbs the whole screen', () => {
    const r = focusRect({ x: 0, y: 0, w: 1900, h: 1150 }, vp)
    expect(r.w).toBeLessThan(1900)
    expect(r.w).toBeLessThanOrEqual(FOCUS_MAX_VIEWPORT_FRAC * vp.width + 0.01)
    expect(r.h).toBeLessThanOrEqual(FOCUS_MAX_VIEWPORT_FRAC * vp.height + 0.01)
    expect(r.x).toBeCloseTo((vp.width - r.w) / 2)
    expect(r.y).toBeCloseTo((vp.height - r.h) / 2)
  })

  it('the default scale is 2x (documented contract)', () => {
    expect(FOCUS_SCALE).toBe(2)
  })

  it('a degenerate viewport returns the pane unchanged (bad measurement renders unscaled)', () => {
    const pane = { x: 10, y: 20, w: 300, h: 200 }
    expect(focusRect(pane, { width: 0, height: 0 })).toEqual(pane)
    expect(focusRect(pane, { width: Number.NaN, height: 800 })).toEqual(pane)
  })
})
