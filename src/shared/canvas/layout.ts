// Pure geometry for the canvas view — no React, no DOM. The view transform is
// translate(pan) scale(zoom): a canvas point p maps to screen as p*zoom + pan.

export interface Point {
  x: number
  y: number
}
export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}
export type ClientToCanvasPoint = (clientX: number, clientY: number) => Point
export interface NodeRect {
  x: number
  y: number
  w: number
  h: number
}
/** A rect stored as FRACTIONS of the surface (0..1) so panes move AND scale with the window. */
export interface FreeRect {
  fx: number
  fy: number
  fw: number
  fh: number
}
export interface Viewport {
  width: number
  height: number
}
export interface Transform {
  pan: Point
  zoom: number
}

export interface FreeCanvasOccupancy {
  sessions: number
  tombstones: number
  mediaPanes: number
  widgets: number
  hasUserDecor: boolean
}

export const ZOOM_MIN = 0.4
export const ZOOM_MAX = 1.5
export const NODE_MIN_W = 220
export const NODE_MIN_H = 140
export const NODE_MAX_W = 1400
export const NODE_MAX_H = 1000
export const NODE_DEFAULT_W = 320
export const NODE_DEFAULT_H = 200
export const NODE_ENLARGED_W = 720
export const NODE_ENLARGED_H = 460
export const NODE_TIDY_W = 260
export const NODE_TIDY_H = 170

/** Free canvas scroll room, expressed in fractions of the unchanged home viewport. Home is
 *  PINNED at the board origin — scroll (0,0) IS home — and the extra room extends RIGHT and
 *  DOWN only; down+left room would leave home at a scrolled offset. */
export const EXTRA_RIGHT_FRAC = 1 / 3
export const EXTRA_DOWN_FRAC = 1 / 3
export const HORIZON_MIN_X = 0
export const HORIZON_MAX_X = 1 + EXTRA_RIGHT_FRAC
export const HORIZON_MIN_Y = 0
export const HORIZON_MAX_Y = 1 + EXTRA_DOWN_FRAC
export const HORIZON_WIDTH_FRAC = HORIZON_MAX_X - HORIZON_MIN_X
export const HORIZON_HEIGHT_FRAC = HORIZON_MAX_Y - HORIZON_MIN_Y

const PLACE_COLS = 3
const PLACE_GAP = 28

const TIDY_COLS = 4
const TIDY_GAP = 20

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

export function clampNodeSize(w: number, h: number): { w: number; h: number } {
  return {
    w: Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, w)),
    h: Math.min(NODE_MAX_H, Math.max(NODE_MIN_H, h))
  }
}

/** Whether the first-run card can occupy Home. Kept pure so every app-owned content surface
 *  (terminal, tombstone, floating widget, or decor) stays in the same emptiness rule. */
export function isFreeCanvasEmpty(occupancy: FreeCanvasOccupancy): boolean {
  return (
    occupancy.sessions === 0 &&
    occupancy.tombstones === 0 &&
    occupancy.mediaPanes === 0 &&
    occupancy.widgets === 0 &&
    !occupancy.hasUserDecor
  )
}

/** Convert a client point to fractions of the live Free home rect. The result is intentionally
 *  unclamped: callers apply size-aware horizon bounds after computing gesture deltas. */
export function clientToHomeFractions(clientX: number, clientY: number, rect: ClientRectLike | null): Point {
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
}

function finiteOrZero(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/** Round horizon fractions to the same compact precision used by persisted canvas decor. */
export function roundCanvasFrac(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/** Clamp an element's left edge to the horizon, accounting for its fractional width. */
export function clampHorizonX(n: unknown, width = 0): number {
  const cleanWidth = Math.min(HORIZON_WIDTH_FRAC, Math.max(0, finiteOrZero(width)))
  const max = HORIZON_MAX_X - cleanWidth
  const clamped = Math.min(max, Math.max(HORIZON_MIN_X, finiteOrZero(n)))
  return Math.min(max, Math.max(HORIZON_MIN_X, roundCanvasFrac(clamped)))
}

/** Clamp an element's top edge to the horizon, accounting for its fractional height. */
export function clampHorizonY(n: unknown, height = 0): number {
  const cleanHeight = Math.min(HORIZON_HEIGHT_FRAC, Math.max(0, finiteOrZero(height)))
  const max = HORIZON_MAX_Y - cleanHeight
  const clamped = Math.min(max, Math.max(HORIZON_MIN_Y, finiteOrZero(n)))
  return Math.min(max, Math.max(HORIZON_MIN_Y, roundCanvasFrac(clamped)))
}

/**
 * "Tidy" rect for the Nth pane — a compact, organized grid of uniform SMALL boxes the user can then
 * move and expand. Used by Free mode's reset. Its own tight spacing (not autoPlace's default-pane
 * spacing) so the boxes pack neatly.
 */
export function tidyRect(index: number): NodeRect {
  return {
    x: TIDY_GAP + (index % TIDY_COLS) * (NODE_TIDY_W + TIDY_GAP),
    y: TIDY_GAP + Math.floor(index / TIDY_COLS) * (NODE_TIDY_H + TIDY_GAP),
    w: NODE_TIDY_W,
    h: NODE_TIDY_H
  }
}

// --- Free mode: fractional geometry so panes scale with the window ---------------------------

/** Render a fractional rect to pixels for the given surface, flooring to the usable min size
 *  (below the floor the surface scrolls rather than shrinking a terminal to nothing). */
export function freeToPixels(f: FreeRect, surfW: number, surfH: number): NodeRect {
  return {
    x: f.fx * surfW,
    y: f.fy * surfH,
    w: Math.max(NODE_MIN_W, f.fw * surfW),
    h: Math.max(NODE_MIN_H, f.fh * surfH)
  }
}

/** Convert a pixel rect back to fractions of the surface. Guards a zero/unmeasured surface. */
export function pixelsToFree(r: NodeRect, surfW: number, surfH: number): FreeRect {
  if (surfW <= 0 || surfH <= 0) return { fx: 0, fy: 0, fw: 0.3, fh: 0.4 }
  return { fx: r.x / surfW, fy: r.y / surfH, fw: r.w / surfW, fh: r.h / surfH }
}

/** Keep a fractional rect within [0,1] and at least the min usable size (in fractions of surface). */
export function clampFree(f: FreeRect, surfW: number, surfH: number): FreeRect {
  const minFw = surfW > 0 ? Math.min(1, NODE_MIN_W / surfW) : 0.1
  const minFh = surfH > 0 ? Math.min(1, NODE_MIN_H / surfH) : 0.1
  const fw = Math.min(1, Math.max(minFw, f.fw))
  const fh = Math.min(1, Math.max(minFh, f.fh))
  const fx = Math.min(Math.max(0, f.fx), 1 - fw)
  const fy = Math.min(Math.max(0, f.fy), 1 - fh)
  return { fx, fy, fw, fh }
}

/** Keep a Free-canvas pane within the right/down horizon. The legacy clampFree remains home-only
 *  for other canvas surfaces and for new-pane/Tidy placement. */
export function clampFreeHorizon(f: FreeRect, surfW: number, surfH: number): FreeRect {
  const minFw = surfW > 0 ? Math.min(HORIZON_WIDTH_FRAC, NODE_MIN_W / surfW) : 0.1
  const minFh = surfH > 0 ? Math.min(HORIZON_HEIGHT_FRAC, NODE_MIN_H / surfH) : 0.1
  const fw = Math.min(HORIZON_WIDTH_FRAC, Math.max(minFw, Number.isFinite(f.fw) ? f.fw : minFw))
  const fh = Math.min(HORIZON_HEIGHT_FRAC, Math.max(minFh, Number.isFinite(f.fh) ? f.fh : minFh))
  return { fx: clampHorizonX(f.fx, fw), fy: clampHorizonY(f.fy, fh), fw, fh }
}

// --- At-rest placement rules: dock exclusion zone + home-fold fit ----------------------------
// Both run at REST moments only (drag release, layout load, pin-mode change) — panes pass through
// freely mid-drag. Both are convergent: applying a rule to its own output is a no-op, so the
// persisted geometry can never churn.

/** Overlap beyond this fraction of the pane's area counts as "hiding behind the dock". */
export const NUDGE_OVERLAP_FRAC = 0.35
/** The pane header strip (px) that must stay grabbable — .pane-head is ~34px tall. */
export const NUDGE_HEADER_PX = 34
/** Clearance left between a nudged pane and the exclusion edge it merged out from. */
export const NUDGE_GAP = 12
/** A pane keeping more than this fraction of its area inside home gets pulled fully inside;
 *  at or below it, the pane is deliberately parked in the scroll room and left alone. */
export const FOLD_HOME_AREA_FRAC = 0.6
/** Persisted fractions round to 1e-4 (~0.2px on a big surface) — don't re-trigger on that noise. */
const REST_EPS = 0.5

function overlapArea(a: NodeRect, b: NodeRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function containsRect(outer: NodeRect, inner: NodeRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

/**
 * Dock exclusion zone: a pane resting behind the pinned [Workspaces+Orchestrator] column is
 * invisible (the column is near-opaque and above the canvas). If the pane's overlap with
 * `exclusion` exceeds NUDGE_OVERLAP_FRAC of its area — or the exclusion fully covers the pane's
 * header strip, leaving nothing to grab — translate it out of the nearest exclusion edge
 * (left/right/above/below, ties broken in that order) with NUDGE_GAP clearance, staying inside
 * `bounds`. When no direction fully clears (pane bigger than every gap), the move that leaves the
 * least residual overlap wins; a pane with nowhere better to go returns null.
 */
export function nudgeOutOfRect(
  pane: NodeRect,
  exclusion: NodeRect,
  bounds: NodeRect,
  opts: { areaFrac?: number; headerH?: number; gap?: number } = {}
): Point | null {
  const areaFrac = opts.areaFrac ?? NUDGE_OVERLAP_FRAC
  const headerH = opts.headerH ?? NUDGE_HEADER_PX
  const gap = opts.gap ?? NUDGE_GAP
  if (pane.w <= 0 || pane.h <= 0) return null
  const overlap = overlapArea(pane, exclusion)
  if (overlap <= 0) return null
  const header = { x: pane.x, y: pane.y, w: pane.w, h: Math.min(headerH, pane.h) }
  if (overlap <= areaFrac * pane.w * pane.h && !containsRect(exclusion, header)) return null
  const clampX = (x: number): number =>
    Math.min(Math.max(bounds.x, x), Math.max(bounds.x, bounds.x + bounds.w - pane.w))
  const clampY = (y: number): number =>
    Math.min(Math.max(bounds.y, y), Math.max(bounds.y, bounds.y + bounds.h - pane.h))
  const candidates: Point[] = [
    { x: clampX(exclusion.x - pane.w - gap), y: pane.y }, // out the left edge
    { x: clampX(exclusion.x + exclusion.w + gap), y: pane.y }, // out the right edge
    { x: pane.x, y: clampY(exclusion.y - pane.h - gap) }, // out above
    { x: pane.x, y: clampY(exclusion.y + exclusion.h + gap) } // out below
  ]
  // Staying put is the baseline: a candidate must strictly reduce the overlap (or reduce the
  // move at equal overlap) to win, so a trapped pane is left in place instead of jittered.
  let best: Point = { x: pane.x, y: pane.y }
  let bestResidual = overlap
  let bestDist = 0
  for (const c of candidates) {
    const residual = overlapArea({ ...pane, x: c.x, y: c.y }, exclusion)
    const dist = Math.abs(c.x - pane.x) + Math.abs(c.y - pane.y)
    if (residual < bestResidual - 1e-6 || (Math.abs(residual - bestResidual) <= 1e-6 && dist < bestDist)) {
      best = c
      bestResidual = residual
      bestDist = dist
    }
  }
  if (Math.abs(best.x - pane.x) < REST_EPS && Math.abs(best.y - pane.y) < REST_EPS) return null
  return best
}

/**
 * Home-fold fit-at-rest: the board extends 1/3 past the home viewport (the scroll room), so a
 * pane whose bottom/right slice crosses the fold renders visually cut at the surface edge. A pane
 * MOSTLY inside home (more than FOLD_HOME_AREA_FRAC of its area) is pulled fully inside; one
 * larger than home is also clamped to home's size (the caller's normal resize path re-fits the
 * terminal). A pane resting mostly in the scroll room is deliberate parking — untouched.
 * Returns the corrected rect, or null when nothing needs to change.
 */
export function fitInsideHome(pane: NodeRect, home: NodeRect, areaFrac = FOLD_HOME_AREA_FRAC): NodeRect | null {
  if (pane.w <= 0 || pane.h <= 0) return null
  const inside =
    pane.x >= home.x - REST_EPS &&
    pane.y >= home.y - REST_EPS &&
    pane.x + pane.w <= home.x + home.w + REST_EPS &&
    pane.y + pane.h <= home.y + home.h + REST_EPS
  if (inside) return null
  if (overlapArea(pane, home) <= areaFrac * pane.w * pane.h) return null
  const w = Math.min(pane.w, home.w)
  const h = Math.min(pane.h, home.h)
  const x = Math.min(Math.max(home.x, pane.x), home.x + home.w - w)
  const y = Math.min(Math.max(home.y, pane.y), home.y + home.h - h)
  return { x, y, w, h }
}

/** Normalize two corner points into a positive-size rect (x,y = top-left). Used by the rect and
 *  ellipse ink shapes, which are captured as start→end drags in any direction. */
export function rectFromPoints(x0: number, y0: number, x1: number, y1: number): NodeRect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}

/** The two wing points of an arrowhead at `tip`, pointing along the tail→tip direction.
 *  Pure/degenerate-safe (tail===tip → atan2(0,0)=0, finite wings). Coords are whatever space
 *  the caller passes (the ink layer passes pixels). */
export function arrowHead(tailX: number, tailY: number, tipX: number, tipY: number, size = 12): [Point, Point] {
  const angle = Math.atan2(tipY - tailY, tipX - tailX)
  const spread = 0.5 // radians (~29°) each side of the shaft
  return [
    { x: tipX - size * Math.cos(angle - spread), y: tipY - size * Math.sin(angle - spread) },
    { x: tipX - size * Math.cos(angle + spread), y: tipY - size * Math.sin(angle + spread) }
  ]
}

export function canvasToScreen(p: Point, t: Transform): Point {
  return { x: p.x * t.zoom + t.pan.x, y: p.y * t.zoom + t.pan.y }
}

export function screenToCanvas(p: Point, t: Transform): Point {
  return { x: (p.x - t.pan.x) / t.zoom, y: (p.y - t.pan.y) / t.zoom }
}

/** Seed position for the Nth node — a simple left-to-right, top-to-bottom flow grid. */
export function autoPlace(index: number): Point {
  const col = index % PLACE_COLS
  const row = Math.floor(index / PLACE_COLS)
  return {
    x: PLACE_GAP + col * (NODE_DEFAULT_W + PLACE_GAP),
    y: PLACE_GAP + row * (NODE_DEFAULT_H + PLACE_GAP)
  }
}

/** Pan/zoom that fits every node into the viewport (never zooms past 1:1). */
export function fitView(nodes: NodeRect[], viewport: Viewport, pad = 40): Transform {
  if (nodes.length === 0) return { pan: { x: 0, y: 0 }, zoom: 1 }
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + n.w))
  const maxY = Math.max(...nodes.map((n) => n.y + n.h))
  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const zoom = clampZoom(Math.min((viewport.width - 2 * pad) / contentW, (viewport.height - 2 * pad) / contentH, 1))
  const pan = {
    x: (viewport.width - contentW * zoom) / 2 - minX * zoom,
    y: (viewport.height - contentH * zoom) / 2 - minY * zoom
  }
  return { pan, zoom }
}
