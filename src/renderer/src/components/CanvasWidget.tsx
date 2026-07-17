import React, { useCallback, useEffect, useRef } from 'react'
import {
  WIDGET_CARD_W,
  WIDGET_CATALOG,
  WIDGET_MAX_FRAC,
  WIDGET_MIN_FRAC,
  WIDGET_MIN_H,
  type PlacedWidget
} from '@shared/widgets/catalog'
import {
  HORIZON_MAX_X,
  HORIZON_MAX_Y,
  clampHorizonX,
  clampHorizonY,
  type ClientToCanvasPoint
} from '@shared/canvas/layout'
import { WidgetBody } from './WidgetCards'
import './widgets.css'

// A widget card detached from the rail, free-floating on the canvas. The CONTENT is the exact rail
// body (WidgetBody — never forked); only the chrome differs: a move grip, a corner resize handle,
// and a ⇤ dock-back control. Position AND size are fractional (fx,fy,fw,fh) — the CanvasNote
// unified move/resize drag, including the buttons===0 glue-guard for a mouseup swallowed by a
// <webview>. Resize floors at the rail card's pixel footprint (a floating card never shrinks below
// the rail look) and the pure transition caps at most-of-viewport / the horizon edge.
export function CanvasWidget({
  placed,
  projectId,
  surfW,
  surfH,
  toCanvasPoint,
  onMove,
  onResize,
  onDock,
  onRemove
}: {
  placed: PlacedWidget
  projectId: string | null
  surfW: number
  surfH: number
  toCanvasPoint: ClientToCanvasPoint
  onMove: (fx: number, fy: number) => void
  onResize: (fw: number, fh: number) => void
  onDock: () => void
  onRemove: () => void
}): React.JSX.Element {
  const drag = useRef<{ move?: (e: MouseEvent) => void; up?: () => void } | null>(null)

  const start = useCallback(
    (mode: 'move' | 'resize', e: React.MouseEvent): void => {
      if (mode === 'move' && (e.target as HTMLElement).closest('button, .canvas-widget-resize')) return
      e.preventDefault()
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
      const p0 = toCanvasPoint(e.clientX, e.clientY)
      const { fx, fy, fw, fh } = placed
      // Gesture-time minimum = the rail card's footprint in fractions of the live surface.
      const minFw = surfW > 0 ? Math.min(WIDGET_MAX_FRAC, WIDGET_CARD_W / surfW) : WIDGET_MIN_FRAC
      const minFh = surfH > 0 ? Math.min(WIDGET_MAX_FRAC, WIDGET_MIN_H / surfH) : WIDGET_MIN_FRAC
      const move = (ev: MouseEvent): void => {
        // Released over a <webview> swallows the mouseup — buttons===0 → tear down, don't glue to cursor.
        if (ev.buttons === 0) return up()
        if (surfW <= 0 || surfH <= 0) return
        const p = toCanvasPoint(ev.clientX, ev.clientY)
        const dfx = p.x - p0.x
        const dfy = p.y - p0.y
        if (mode === 'move') {
          onMove(clampHorizonX(fx + dfx, fw), clampHorizonY(fy + dfy, fh))
        } else {
          onResize(
            Math.min(HORIZON_MAX_X - fx, Math.max(minFw, fw + dfx)),
            Math.min(HORIZON_MAX_Y - fy, Math.max(minFh, fh + dfy))
          )
        }
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        drag.current = null
      }
      drag.current = { move, up }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [placed, surfW, surfH, toCanvasPoint, onMove, onResize]
  )

  useEffect(
    () => () => {
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
    },
    []
  )

  const meta = WIDGET_CATALOG[placed.id]
  return (
    <div
      className="widget-card canvas-widget"
      style={{
        left: placed.fx * surfW,
        top: placed.fy * surfH,
        width: placed.fw * surfW,
        height: placed.fh * surfH
      }}
    >
      <div className="widget-card-head" onMouseDown={(e) => start('move', e)} title="Drag to move">
        <span className="canvas-widget-grip">⠿</span>
        <span className="wc-icon">{meta.icon}</span>
        <span className="wc-head-title">{meta.label}</span>
        <button className="wc-ctrl" onClick={onDock} title="Dock back to the rail">
          ⇤
        </button>
        <button className="wc-ctrl close" onClick={onRemove} title="Remove from the canvas">
          ✕
        </button>
      </div>
      <div className="widget-card-body">
        <WidgetBody id={placed.id} projectId={projectId} />
      </div>
      <span className="canvas-widget-resize" onMouseDown={(e) => start('resize', e)} title="Resize" />
    </div>
  )
}
