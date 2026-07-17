import { describe, it, expect } from 'vitest'
import {
  clampZoom,
  clampNodeSize,
  screenToCanvas,
  canvasToScreen,
  autoPlace,
  fitView,
  tidyRect,
  freeToPixels,
  pixelsToFree,
  clampFree,
  clampFreeHorizon,
  clientToHomeFractions,
  nudgeOutOfRect,
  fitInsideHome,
  isFreeCanvasEmpty,
  NUDGE_GAP,
  EXTRA_RIGHT_FRAC,
  EXTRA_DOWN_FRAC,
  ZOOM_MIN,
  ZOOM_MAX,
  NODE_MIN_W,
  NODE_MIN_H,
  NODE_MAX_W,
  NODE_TIDY_W,
  NODE_TIDY_H,
  type NodeRect,
  type FreeRect
} from './layout'

describe('isFreeCanvasEmpty', () => {
  const empty = { sessions: 0, tombstones: 0, mediaPanes: 0, widgets: 0, hasUserDecor: false }

  it('keeps the welcome card on a presentation-only canvas', () => {
    expect(isFreeCanvasEmpty(empty)).toBe(true)
  })

  it.each(['sessions', 'tombstones', 'mediaPanes', 'widgets'] as const)(
    'hides it when %s contains content',
    (field) => {
      expect(isFreeCanvasEmpty({ ...empty, [field]: 1 })).toBe(false)
    }
  )

  it('hides it when operator-created decor exists', () => {
    expect(isFreeCanvasEmpty({ ...empty, hasUserDecor: true })).toBe(false)
  })
})

describe('clampZoom', () => {
  it('clamps below, within, and above the range', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
  })
})

describe('clampNodeSize', () => {
  it('enforces the min in both axes', () => {
    expect(clampNodeSize(10, 10)).toEqual({ w: NODE_MIN_W, h: NODE_MIN_H })
  })
  it('enforces the max in both axes', () => {
    expect(clampNodeSize(99999, 99999)).toEqual({ w: NODE_MAX_W, h: expect.any(Number) })
  })
  it('passes a legal size through unchanged', () => {
    expect(clampNodeSize(400, 300)).toEqual({ w: 400, h: 300 })
  })
})

describe('screenToCanvas / canvasToScreen', () => {
  it('round-trips a point through the transform', () => {
    const t = { pan: { x: 120, y: -40 }, zoom: 1.25 }
    const screen = canvasToScreen({ x: 200, y: 80 }, t)
    expect(screen).toEqual({ x: 200 * 1.25 + 120, y: 80 * 1.25 - 40 })
    expect(screenToCanvas(screen, t)).toEqual({ x: 200, y: 80 })
  })
})

describe('autoPlace', () => {
  it('seeds the first node at the origin gap and flows into a grid', () => {
    const a = autoPlace(0)
    const b = autoPlace(1)
    const d = autoPlace(3) // wraps to the next row at COLS=3
    expect(a.x).toBeLessThan(b.x) // second node is to the right
    expect(a.y).toBe(b.y) // same row
    expect(d.y).toBeGreaterThan(a.y) // fourth node wrapped down a row
  })
})

describe('fitView', () => {
  it('returns identity-ish transform for no nodes', () => {
    expect(fitView([], { width: 1000, height: 800 })).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 })
  })
  it('computes a zoom that bounds all nodes and never zooms past 1', () => {
    const nodes: NodeRect[] = [
      { x: 0, y: 0, w: 300, h: 200 },
      { x: 2000, y: 1500, w: 300, h: 200 }
    ]
    const t = fitView(nodes, { width: 1000, height: 800 })
    expect(t.zoom).toBeGreaterThan(0)
    expect(t.zoom).toBeLessThanOrEqual(1)
    for (const n of nodes) {
      const tl = canvasToScreen({ x: n.x, y: n.y }, t)
      const br = canvasToScreen({ x: n.x + n.w, y: n.y + n.h }, t)
      expect(tl.x).toBeGreaterThanOrEqual(-1)
      expect(tl.y).toBeGreaterThanOrEqual(-1)
      expect(br.x).toBeLessThanOrEqual(1001)
      expect(br.y).toBeLessThanOrEqual(801)
    }
  })
})

describe('tidyRect', () => {
  it('gives every box the uniform small tidy size', () => {
    for (const i of [0, 1, 5, 9]) {
      const r = tidyRect(i)
      expect(r.w).toBe(NODE_TIDY_W)
      expect(r.h).toBe(NODE_TIDY_H)
    }
  })

  it('lays boxes out left-to-right then wraps to the next row', () => {
    const a = tidyRect(0)
    const b = tidyRect(1)
    expect(b.x).toBeGreaterThan(a.x) // second box is to the right
    expect(b.y).toBe(a.y) // same row
    const wrapped = tidyRect(4) // TIDY_COLS = 4 -> index 4 starts row 2
    expect(wrapped.x).toBe(a.x) // back to the first column
    expect(wrapped.y).toBeGreaterThan(a.y) // next row down
  })

  it('never overlaps neighbors (gap between boxes is positive)', () => {
    const a = tidyRect(0)
    const b = tidyRect(1)
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.w) // next column starts past the first box
  })
})

describe('freeToPixels / pixelsToFree', () => {
  it('scales a fractional rect to the surface size', () => {
    expect(freeToPixels({ fx: 0.5, fy: 0.25, fw: 0.5, fh: 0.5 }, 1000, 800)).toEqual({
      x: 500,
      y: 200,
      w: 500,
      h: 400
    })
  })

  it('floors width/height to the usable minimum (panes never shrink to nothing)', () => {
    const r = freeToPixels({ fx: 0, fy: 0, fw: 0.01, fh: 0.01 }, 1000, 800)
    expect(r.w).toBe(NODE_MIN_W)
    expect(r.h).toBe(NODE_MIN_H)
  })

  it('round-trips a comfortably-sized rect through pixels and back', () => {
    const f: FreeRect = { fx: 0.2, fy: 0.3, fw: 0.4, fh: 0.45 }
    const px = freeToPixels(f, 1200, 900)
    expect(pixelsToFree(px, 1200, 900)).toEqual(f)
  })

  it('guards an unmeasured (zero) surface', () => {
    expect(pixelsToFree({ x: 0, y: 0, w: 0, h: 0 }, 0, 0)).toEqual({ fx: 0, fy: 0, fw: 0.3, fh: 0.4 })
  })
})

describe('clampFree', () => {
  it('keeps a rect inside the [0,1] bounds', () => {
    const c = clampFree({ fx: -0.2, fy: 0.95, fw: 0.4, fh: 0.4 }, 1200, 900)
    expect(c.fx).toBe(0) // pushed back from the left edge
    expect(c.fy).toBeCloseTo(0.6) // pulled up so fy + fh <= 1
    expect(c.fx + c.fw).toBeLessThanOrEqual(1)
    expect(c.fy + c.fh).toBeLessThanOrEqual(1)
  })

  it('enforces a minimum fractional size derived from the min pixel size', () => {
    const c = clampFree({ fx: 0, fy: 0, fw: 0.01, fh: 0.01 }, 1100, 700)
    expect(c.fw).toBeCloseTo(NODE_MIN_W / 1100)
    expect(c.fh).toBeCloseTo(NODE_MIN_H / 700)
  })
})

describe('Free canvas horizon', () => {
  it('maps client points through the home rect, including the right and lower scroll room', () => {
    const home = { left: 300, top: 120, width: 900, height: 600 }
    expect(clientToHomeFractions(300, 120, home)).toEqual({ x: 0, y: 0 })
    expect(clientToHomeFractions(1500, 920, home).x).toBeCloseTo(1 + EXTRA_RIGHT_FRAC)
    expect(clientToHomeFractions(1500, 920, home).y).toBeCloseTo(1 + EXTRA_DOWN_FRAC)
  })

  it('accepts a whole pane in the right and lower horizon', () => {
    const c = clampFreeHorizon({ fx: 1 + EXTRA_RIGHT_FRAC - 0.2, fy: 1.05, fw: 0.2, fh: 0.2 }, 1200, 900)
    expect(c.fx).toBeCloseTo(1 + EXTRA_RIGHT_FRAC - 0.2, 4)
    expect(c.fy).toBe(1.05)
    expect(c.fx + c.fw).toBeLessThanOrEqual(1 + EXTRA_RIGHT_FRAC)
    expect(c.fy + c.fh).toBeLessThanOrEqual(1 + EXTRA_DOWN_FRAC)
  })

  it('clamps beyond the horizon and keeps the entire pane on-board (home pinned at 0,0)', () => {
    const tooFarLeftUp = clampFreeHorizon({ fx: -9, fy: -2, fw: 0.4, fh: 0.4 }, 1200, 900)
    expect(tooFarLeftUp.fx).toBe(0) // no room left of home anymore
    expect(tooFarLeftUp.fy).toBe(0)

    const tooFarRightDown = clampFreeHorizon({ fx: 9, fy: 9, fw: 0.2, fh: 0.25 }, 1200, 900)
    expect(tooFarRightDown.fx + tooFarRightDown.fw).toBeCloseTo(1 + EXTRA_RIGHT_FRAC, 4)
    expect(tooFarRightDown.fy + tooFarRightDown.fh).toBeCloseTo(1 + EXTRA_DOWN_FRAC, 4)

    const fullBoard = clampFreeHorizon({ fx: 0, fy: 0, fw: 9, fh: 9 }, 1200, 900)
    expect(fullBoard.fx).toBe(0)
    expect(fullBoard.fx + fullBoard.fw).toBeLessThanOrEqual(1 + EXTRA_RIGHT_FRAC)
    expect(fullBoard.fy + fullBoard.fh).toBeLessThanOrEqual(1 + EXTRA_DOWN_FRAC)
  })

  it('legacy left-room coordinates (pre re-anchor) self-heal onto the new board', () => {
    const parkedLeft = clampFreeHorizon({ fx: -0.25, fy: 0.4, fw: 0.2, fh: 0.2 }, 1200, 900)
    expect(parkedLeft.fx).toBe(0) // pulled back to the home edge, still visible/reachable
    expect(parkedLeft.fy).toBe(0.4)
  })
})

describe('nudgeOutOfRect (dock exclusion zone)', () => {
  const bounds: NodeRect = { x: 0, y: 0, w: 1600, h: 1000 }
  // A pin-center-like column: full height, floating mid-canvas.
  const column: NodeRect = { x: 600, y: 0, w: 400, h: 800 }

  it('ignores a pane that does not touch the exclusion', () => {
    expect(nudgeOutOfRect({ x: 100, y: 100, w: 300, h: 200 }, column, bounds)).toBeNull()
  })

  it('tolerates a small overlap that leaves the pane grabbable', () => {
    // 100px of the 300px width is covered: 1/3 of the area, under the 35% threshold, header free.
    expect(nudgeOutOfRect({ x: 400, y: 100, w: 300, h: 200 }, column, bounds)).toBeNull()
  })

  it('tolerates an overlap of exactly the threshold (strictly-greater trigger)', () => {
    // 35 of 100 px covered = exactly 35% of the area; header wider than the exclusion, not buried.
    expect(nudgeOutOfRect({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 35, h: 100 }, bounds)).toBeNull()
  })

  it('escapes out the nearest (left) edge with a clearance gap', () => {
    const p = nudgeOutOfRect({ x: 560, y: 100, w: 300, h: 200 }, column, bounds)
    expect(p).toEqual({ x: column.x - 300 - NUDGE_GAP, y: 100 })
  })

  it('escapes right when that is the shortest clear move', () => {
    const p = nudgeOutOfRect({ x: 800, y: 100, w: 300, h: 200 }, column, bounds)
    expect(p).toEqual({ x: column.x + column.w + NUDGE_GAP, y: 100 })
  })

  it('a pane exactly matching the column pops out from the column edge', () => {
    // A pane left hidden behind the pinned column: same position and size as the docked column.
    const p = nudgeOutOfRect({ ...column }, column, bounds)
    expect(p).toEqual({ x: column.x - column.w - NUDGE_GAP, y: column.y })
  })

  it('a buried header triggers the nudge even under the area threshold', () => {
    // Tall pane, wide short exclusion across its top: ~12% of the area, but the whole header
    // strip is covered so the pane cannot be grabbed.
    const p = nudgeOutOfRect({ x: 600, y: 50, w: 200, h: 600 }, { x: 550, y: 0, w: 300, h: 120 }, bounds)
    expect(p).toEqual({ x: 600, y: 120 + NUDGE_GAP })
  })

  it('an exclusion on the canvas edge pushes the pane inward, never out of bounds', () => {
    const edgeColumn: NodeRect = { x: 0, y: 0, w: 360, h: 1000 }
    const p = nudgeOutOfRect({ x: 100, y: 200, w: 300, h: 200 }, edgeColumn, bounds)
    expect(p).toEqual({ x: 360 + NUDGE_GAP, y: 200 })
  })

  it('a pane wider than both side gaps escapes below when there is room', () => {
    const b: NodeRect = { x: 0, y: 0, w: 1000, h: 900 }
    const excl: NodeRect = { x: 300, y: 0, w: 400, h: 600 }
    const p = nudgeOutOfRect({ x: 350, y: 100, w: 700, h: 280 }, excl, b)
    expect(p).toEqual({ x: 350, y: 600 + NUDGE_GAP })
  })

  it('a trapped pane (nowhere to go) is left in place', () => {
    const b: NodeRect = { x: 0, y: 0, w: 300, h: 200 }
    expect(nudgeOutOfRect({ x: 0, y: 0, w: 300, h: 200 }, { x: 0, y: 0, w: 300, h: 200 }, b)).toBeNull()
  })

  it('converges: re-running from the nudged position is a no-op', () => {
    const pane: NodeRect = { x: 560, y: 100, w: 300, h: 200 }
    const p = nudgeOutOfRect(pane, column, bounds)
    expect(p).not.toBeNull()
    expect(nudgeOutOfRect({ ...pane, x: p!.x, y: p!.y }, column, bounds)).toBeNull()
  })
})

describe('fitInsideHome (home-fold fit-at-rest)', () => {
  const home: NodeRect = { x: 0, y: 0, w: 1200, h: 800 }

  it('leaves a pane fully inside home alone', () => {
    expect(fitInsideHome({ x: 100, y: 100, w: 400, h: 300 }, home)).toBeNull()
  })

  it('pulls a bottom-bleeding pane up to the fold', () => {
    expect(fitInsideHome({ x: 100, y: 600, w: 400, h: 300 }, home)).toEqual({ x: 100, y: 500, w: 400, h: 300 })
  })

  it('pulls a right-bleeding pane left to the fold', () => {
    expect(fitInsideHome({ x: 950, y: 100, w: 400, h: 300 }, home)).toEqual({ x: 800, y: 100, w: 400, h: 300 })
  })

  it('pulls a corner-bleeding pane up and left', () => {
    expect(fitInsideHome({ x: 950, y: 600, w: 300, h: 220 }, home)).toEqual({ x: 900, y: 580, w: 300, h: 220 })
  })

  it('clamps a pane larger than home down to the home size', () => {
    expect(fitInsideHome({ x: 0, y: 0, w: 1400, h: 900 }, home)).toEqual({ x: 0, y: 0, w: 1200, h: 800 })
  })

  it('leaves a pane parked mostly in the scroll room alone', () => {
    expect(fitInsideHome({ x: 1150, y: 100, w: 400, h: 300 }, home)).toBeNull() // ~12% in home
    expect(fitInsideHome({ x: 100, y: 700, w: 300, h: 200 }, home)).toBeNull() // half out — parked
  })

  it('treats exactly-60%-in-home as parked (strictly-greater trigger)', () => {
    expect(fitInsideHome({ x: 0, y: 500, w: 100, h: 500 }, home)).toBeNull()
  })

  it('converges: a fitted pane re-fits to null', () => {
    const r = fitInsideHome({ x: 100, y: 600, w: 400, h: 300 }, home)
    expect(r).not.toBeNull()
    expect(fitInsideHome(r!, home)).toBeNull()
  })
})
