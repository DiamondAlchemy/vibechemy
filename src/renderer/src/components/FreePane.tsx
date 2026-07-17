import React, { useCallback, useEffect, useRef } from 'react'
import { clampNodeSize, type ClientToCanvasPoint, type NodeRect } from '@shared/canvas/layout'

// Content-agnostic floating shell: owns move/resize/z-order; the child content receives
// startMove to use as its header drag handle.
export function FreePane({
  rect,
  front,
  onGeom,
  onDragEnd,
  onFront,
  toCanvasPoint,
  surfW,
  surfH,
  zoomState,
  children
}: {
  rect: NodeRect
  front: boolean
  onGeom: (rect: NodeRect) => void
  /** Fired once when a move/resize drag actually ends (never on a plain header click), with the
   *  last rect reported to onGeom — the layout settles at-rest placement rules there. */
  onDragEnd?: (last: NodeRect) => void
  onFront: () => void
  /** Free canvas supplies its home-basis mapper; other canvas surfaces omit it and keep legacy px bounds. */
  toCanvasPoint?: ClientToCanvasPoint
  surfW?: number
  surfH?: number
  /** Semantic-zoom Focus role: 'focused' = the promoted spotlight pane (resize handle hidden),
   *  'hidden' = a receded sibling (kept mounted so its terminal never remounts, just invisible). */
  zoomState?: 'focused' | 'hidden'
  children: (startMove: (e: React.MouseEvent) => void) => React.JSX.Element
}): React.JSX.Element {
  const drag = useRef<{
    mode: 'move' | 'resize'
    x: number
    y: number
    rect: NodeRect
    last?: NodeRect
    move?: (e: MouseEvent) => void
    up?: () => void
  } | null>(null)
  // Latest-ref: the mouseup listener is bound at mousedown time, but the drag can outlive that
  // render — the release must call the CURRENT handler, not a stale closure.
  const onDragEndRef = useRef(onDragEnd)
  useEffect(() => {
    onDragEndRef.current = onDragEnd
  })

  const start = useCallback(
    (mode: 'move' | 'resize', e: React.MouseEvent): void => {
      // Let header control buttons (close/hide/lead/color) work without starting a move.
      if (mode === 'move' && (e.target as HTMLElement).closest('button')) return
      e.preventDefault()
      onFront()
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
      const useHomeFractions = !!toCanvasPoint && !!surfW && !!surfH
      const move = (ev: MouseEvent): void => {
        // Released over embedded panes swallows the mouseup — buttons===0 means
        // the drag is over, so tear down instead of leaving the pane glued to the cursor.
        if (ev.buttons === 0) return up()
        if (!drag.current) return
        const p = useHomeFractions ? toCanvasPoint(ev.clientX, ev.clientY) : null
        const dx = p ? (p.x - drag.current.x) * (surfW ?? 1) : ev.clientX - drag.current.x
        const dy = p ? (p.y - drag.current.y) * (surfH ?? 1) : ev.clientY - drag.current.y
        const r = drag.current.rect
        let next: NodeRect
        if (drag.current.mode === 'move') {
          next = {
            ...r,
            x: useHomeFractions ? r.x + dx : Math.max(0, r.x + dx),
            y: Math.max(0, r.y + dy)
          }
        } else {
          const sized = clampNodeSize(r.w + dx, r.h + dy)
          next = { x: r.x, y: r.y, w: sized.w, h: sized.h }
        }
        drag.current.last = next
        onGeom(next)
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        const last = drag.current?.last
        drag.current = null
        if (last) onDragEndRef.current?.(last)
      }
      const p0 = useHomeFractions ? toCanvasPoint(e.clientX, e.clientY) : null
      drag.current = { mode, x: p0?.x ?? e.clientX, y: p0?.y ?? e.clientY, rect, move, up }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [rect, onGeom, onFront, toCanvasPoint, surfW, surfH]
  )

  useEffect(() => {
    return () => {
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
    }
  }, [])

  // Stable identity so the render-prop call isn't re-created (and the refs rule sees a plain
  // event handler, not a render-time ref access).
  const startMove = useCallback((e: React.MouseEvent) => start('move', e), [start])

  return (
    <div
      className={`free-pane${zoomState ? ` zoom-${zoomState}` : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: front ? 5 : 1 }}
      onMouseDownCapture={onFront}
    >
      {/* eslint-disable-next-line react-hooks/refs -- false positive: children() only stores
          startMove as the child's onMoveStart event handler; nothing reads a ref during render. */}
      {children(startMove)}
      <span className="free-resize" onMouseDown={(e) => start('resize', e)} title="Resize" />
    </div>
  )
}
