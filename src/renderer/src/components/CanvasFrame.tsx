import React, { useCallback, useEffect, useRef } from 'react'
import { FRAME_COLORS, MAX_FRAME_LABEL, MIN_FRAME_FRAC, type CanvasFrame as Frame } from '@shared/canvas/decor'
import {
  HORIZON_MAX_X,
  HORIZON_MAX_Y,
  clampHorizonX,
  clampHorizonY,
  type ClientToCanvasPoint
} from '@shared/canvas/layout'

// A section frame ("zone") on the Free-mode canvas: a translucent labeled rectangle that sits
// BEHIND the panes to group them (Building / Reviewing / Prod …). Dragged by its header, resized
// from the corner, renamed inline, recolored, deleted. Fractional rect so it scales with the surface.
export function CanvasFrame({
  frame,
  surfW,
  surfH,
  toCanvasPoint,
  onMove,
  onResize,
  onLabel,
  onColor,
  onRemove
}: {
  frame: Frame
  surfW: number
  surfH: number
  toCanvasPoint: ClientToCanvasPoint
  onMove: (fx: number, fy: number) => void
  onResize: (fw: number, fh: number) => void
  onLabel: (label: string) => void
  onColor: (color: string) => void
  onRemove: () => void
}): React.JSX.Element {
  const drag = useRef<{ move?: (e: MouseEvent) => void; up?: () => void } | null>(null)

  const start = useCallback(
    (mode: 'move' | 'resize', e: React.MouseEvent): void => {
      if (mode === 'move' && (e.target as HTMLElement).closest('button, input, .canvas-note-dot')) return
      e.preventDefault()
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
      const p0 = toCanvasPoint(e.clientX, e.clientY)
      const { fx, fy, fw, fh } = frame
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
            Math.min(HORIZON_MAX_X - fx, Math.max(MIN_FRAME_FRAC, fw + dfx)),
            Math.min(HORIZON_MAX_Y - fy, Math.max(MIN_FRAME_FRAC, fh + dfy))
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
    [frame, surfW, surfH, toCanvasPoint, onMove, onResize]
  )

  useEffect(() => {
    return () => {
      if (drag.current?.move) window.removeEventListener('mousemove', drag.current.move)
      if (drag.current?.up) window.removeEventListener('mouseup', drag.current.up)
    }
  }, [])

  return (
    <div
      className="canvas-frame"
      style={{
        left: frame.fx * surfW,
        top: frame.fy * surfH,
        width: frame.fw * surfW,
        height: frame.fh * surfH,
        background: `${frame.color}14`,
        borderColor: `${frame.color}99`
      }}
    >
      <div
        className="canvas-frame-head"
        style={{ background: `${frame.color}24` }}
        onMouseDown={(e) => start('move', e)}
        title="Drag to move the zone"
      >
        <span className="canvas-frame-grip">⠿</span>
        <input
          className="canvas-frame-label"
          value={frame.label}
          placeholder="Zone…"
          spellCheck={false}
          maxLength={MAX_FRAME_LABEL}
          onChange={(e) => onLabel(e.target.value)}
        />
        <div className="canvas-note-dots">
          {FRAME_COLORS.map((c) => (
            <button
              key={c}
              className={`canvas-note-dot${c === frame.color ? ' on' : ''}`}
              style={{ background: c }}
              title="Zone color"
              onClick={() => onColor(c)}
            />
          ))}
        </div>
        <button className="canvas-frame-x" title="Delete zone" onClick={onRemove}>
          ✕
        </button>
      </div>
      <span className="canvas-frame-resize" onMouseDown={(e) => start('resize', e)} title="Resize" />
    </div>
  )
}
