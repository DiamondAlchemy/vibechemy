// Hover-peek: dwell on a small Free-canvas terminal and it genuinely enlarges through a real
// geometry change, so the pty resizes and the CLI reflows at full width. The enlarged rect is
// transient: never committed to the layout and restored the moment the pointer leaves. Pure math
// lives here; timers live in FreePane and the rect override in FreePaneLayout.
import { NODE_TIDY_W, NODE_TIDY_H, type NodeRect } from './layout'

/** Peek is for reading panes at tidy-grid size. A deliberately larger pane must not balloon on
 *  hover, so this gates arming to at-or-near the tidy footprint. The slop accounts for tidy
 *  fractions rendering at different pixel sizes as the window changes and permits hand-shrunk
 *  panes to peek.
 */
export function isPeekablePaneSize(pane: NodeRect): boolean {
  return pane.w <= NODE_TIDY_W * 1.4 && pane.h <= NODE_TIDY_H * 1.4
}

/** Dwell before the peek fires, long enough that passing the pointer across the grid does not
 *  trigger it. */
export const HOVER_PEEK_DELAY_MS = 1500

/** The peeked pane aims for this fraction of the visible viewport's smaller-fitting dimension. */
export const HOVER_PEEK_VIEWPORT_FRAC = 0.72

/** Never grow beyond this linear factor so a tiny strip pane cannot explode to 10x. */
export const HOVER_PEEK_MAX_FACTOR = 4

/** Breathing room the peeked pane keeps from the visible viewport's edges. */
export const HOVER_PEEK_MARGIN = 14

/**
 * The transient rect a dwelled-on pane enlarges to: grown about its center toward
 * HOVER_PEEK_VIEWPORT_FRAC of the viewport (aspect preserved, factor capped), clamped fully
 * inside `viewport` (both rects in the same coordinate space). Growing about the center keeps
 * the pointer inside the enlarged pane, so hover does not flap. Returns null when there is no
 * meaningful growth.
 */
export function peekRect(pane: NodeRect, viewport: NodeRect): NodeRect | null {
  if (pane.w <= 0 || pane.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return null
  const m = HOVER_PEEK_MARGIN
  const k = Math.min(
    HOVER_PEEK_MAX_FACTOR,
    (viewport.w * HOVER_PEEK_VIEWPORT_FRAC) / pane.w,
    (viewport.h * HOVER_PEEK_VIEWPORT_FRAC) / pane.h,
    (viewport.w - 2 * m) / pane.w,
    (viewport.h - 2 * m) / pane.h
  )
  if (!Number.isFinite(k) || k <= 1.05) return null // nothing worth resizing for

  const w = pane.w * k
  const h = pane.h * k
  let x = pane.x + pane.w / 2 - w / 2
  let y = pane.y + pane.h / 2 - h / 2
  const loX = viewport.x + m
  const hiX = viewport.x + viewport.w - m - w
  const loY = viewport.y + m
  const hiY = viewport.y + viewport.h - m - h
  x = loX > hiX ? viewport.x + (viewport.w - w) / 2 : Math.min(hiX, Math.max(loX, x))
  y = loY > hiY ? viewport.y + (viewport.h - h) / 2 : Math.min(hiY, Math.max(loY, y))
  return { x, y, w, h }
}
