// Pure logic for the canvas SEMANTIC ZOOM — no React, no DOM. Three discrete stops
// (Overview -> Default -> Focus) driven by one behavior across pinch / Ctrl+wheel /
// keys / on-screen controls.

import type { NodeRect, Point } from './layout'

export type ZoomLevel = 'overview' | 'default' | 'focus'
/** 1 = zoom in (toward Focus), -1 = zoom out (toward Overview). */
export type ZoomStepDirection = -1 | 1

const ZOOM_ORDER: ZoomLevel[] = ['overview', 'default', 'focus']

/** The Overview<->Default<->Focus state machine: one discrete stop per step, clamped at the ends. */
export function stepZoom(level: ZoomLevel, direction: ZoomStepDirection): ZoomLevel {
  const at = ZOOM_ORDER.indexOf(level)
  const next = Math.min(ZOOM_ORDER.length - 1, Math.max(0, at + direction))
  return ZOOM_ORDER[next]
}

// --- Discrete wheel stepping -------------------------------------------------------------------
// Trackpad pinch and mouse Ctrl+wheel both arrive as `wheel` events with ctrlKey===true; a pinch
// is a burst of small deltas, a mouse notch is one big one. Accumulate past a threshold to move
// exactly one stop, then a cooldown eats the rest of the gesture so one pinch = one step.

/** Accumulated |deltaY| needed to move one stop (a mouse notch is ~120, pinch deltas 1-20). */
export const ZOOM_STEP_THRESHOLD = 60
/** After a step, further deltas are swallowed for this long so one gesture can't double-step. */
export const ZOOM_STEP_COOLDOWN_MS = 350
/** A pause this long abandons a partial accumulation (no hair-trigger left behind). */
export const ZOOM_ACCUM_IDLE_RESET_MS = 400

export interface ZoomWheelState {
  accum: number
  lastStepAt: number
  lastEventAt: number
}

export const ZOOM_WHEEL_IDLE: ZoomWheelState = {
  accum: 0,
  lastStepAt: Number.NEGATIVE_INFINITY,
  lastEventAt: Number.NEGATIVE_INFINITY
}

/** Fold one wheel delta into the accumulator. step: 1 = zoom in (negative deltaY, pinch-in /
 *  scroll-up), -1 = zoom out, 0 = keep accumulating. Pure — caller supplies the clock. */
export function accumulateZoomWheel(
  state: ZoomWheelState,
  deltaY: number,
  now: number
): { step: -1 | 0 | 1; next: ZoomWheelState } {
  if (now - state.lastStepAt < ZOOM_STEP_COOLDOWN_MS) {
    // Tail of the gesture that just stepped — swallow it entirely (never bank it).
    return { step: 0, next: { accum: 0, lastStepAt: state.lastStepAt, lastEventAt: now } }
  }
  const stale = now - state.lastEventAt > ZOOM_ACCUM_IDLE_RESET_MS
  const accum = (stale ? 0 : state.accum) + (Number.isFinite(deltaY) ? deltaY : 0)
  if (Math.abs(accum) >= ZOOM_STEP_THRESHOLD) {
    return { step: accum < 0 ? 1 : -1, next: { accum: 0, lastStepAt: now, lastEventAt: now } }
  }
  return { step: 0, next: { accum, lastStepAt: state.lastStepAt, lastEventAt: now } }
}

// --- Overview scale-to-fit ---------------------------------------------------------------------

export interface BoxSize {
  width: number
  height: number
}

/** Scale factor that fits `content` inside `viewport` (never upscales past 1). Degenerate
 *  boxes fall back to 1 so a bad measurement renders the canvas unscaled, never inverted. */
export function fitScale(content: BoxSize, viewport: BoxSize): number {
  const cw = content.width
  const ch = content.height
  const vw = viewport.width
  const vh = viewport.height
  if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0) return 1
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return 1
  return Math.min(vw / cw, vh / ch, 1)
}

// --- Focus spotlight geometry --------------------------------------------------------------------
// On a big monitor a full-viewport Focus is too much: the focused pane is a SPOTLIGHT instead —
// brought ~2x forward, centered, with the starfield and receded siblings visible around it. Uniform
// scale (a true zoom on the pane, aspect kept), never the whole screen.

/** Focus brings the pane this many times forward ("100% zoom on the pane"). */
export const FOCUS_SCALE = 2
/** Hard cap: the spotlight never exceeds this fraction of the viewport in either axis. */
export const FOCUS_MAX_VIEWPORT_FRAC = 0.85
/** Floor: small panes still come meaningfully forward, at least this fraction of viewport width. */
export const FOCUS_MIN_WIDTH_FRAC = 0.55

/** Centered spotlight rect for the focused pane: 2x its size, floored at 55% viewport width,
 *  capped at 85% of the viewport in both axes (the cap wins — a pane already bigger than the cap
 *  SHRINKS to it). Same coordinate space as the pane rects (home pixels; home is viewport-sized
 *  while Focus pins the scroll to the origin). A degenerate viewport returns the pane unchanged. */
export function focusRect(pane: NodeRect, viewport: BoxSize): NodeRect {
  const vw = viewport.width
  const vh = viewport.height
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return { ...pane }
  const w0 = Math.max(1, pane.w)
  const h0 = Math.max(1, pane.h)
  let s = Math.max(FOCUS_SCALE, (FOCUS_MIN_WIDTH_FRAC * vw) / w0)
  s = Math.min(s, (FOCUS_MAX_VIEWPORT_FRAC * vw) / w0, (FOCUS_MAX_VIEWPORT_FRAC * vh) / h0)
  const w = w0 * s
  const h = h0 * s
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
}

// --- Focus-target hit-test ---------------------------------------------------------------------

export interface ZoomPaneBox {
  id: string
  rect: NodeRect
}

/** Topmost pane under `point`, in the same coordinate space as the rects (the Free canvas passes
 *  home-pixel rects straight from freeToPixels). `panes` is paint order (later = on top); a hit
 *  on `frontId` wins outright because the front pane renders above DOM order (z-index 5). */
export function hitTestPane(point: Point, panes: ZoomPaneBox[], frontId?: string | null): string | null {
  let top: string | null = null
  for (const p of panes) {
    const { x, y, w, h } = p.rect
    if (point.x >= x && point.x < x + w && point.y >= y && point.y < y + h) {
      if (frontId && p.id === frontId) return frontId
      top = p.id
    }
  }
  return top
}

/** Resolve which pane a Default -> Focus step promotes — HOVER wins, so the pane under the mouse
 *  is promoted instead of a different selected pane: the pane under `point` when one hits; the
 *  front pane only as the no-point / point-over-empty-canvas fallback; else the first pane.
 *  `point` is in the rects' space, or null when the pointer isn't over the canvas at all.
 *  Returns null only when there is nothing to focus. */
export function pickFocusPane(point: Point | null, panes: ZoomPaneBox[], frontId?: string | null): string | null {
  if (panes.length === 0) return null
  if (point) {
    const hit = hitTestPane(point, panes, frontId)
    if (hit) return hit
  }
  if (frontId && panes.some((p) => p.id === frontId)) return frontId
  return panes[0].id
}
