import React, { useCallback, useEffect, useRef, useState } from 'react'
import { TWO_POINT_KINDS, type CanvasStroke, type StrokeKind } from '@shared/canvas/decor'
import {
  HORIZON_HEIGHT_FRAC,
  HORIZON_MIN_X,
  HORIZON_WIDTH_FRAC,
  arrowHead,
  clampHorizonX,
  clampHorizonY,
  rectFromPoints,
  type ClientToCanvasPoint
} from '@shared/canvas/layout'

export type DrawMode = 'off' | 'draw' | 'erase'

// Ink overlay for the Free-mode canvas. Sits ABOVE the panes so strokes can annotate over live
// terminals, but only intercepts the mouse in 'draw' mode (pointer-events toggled in CSS by the
// mode class) — so in 'off' mode you draw nothing and the panes stay fully usable. Three tools:
// pen (opaque freehand), highlighter (wide translucent freehand), arrow (a straight 2-point line
// with a head). Points are captured in surface fractions (0..1) so ink scales with the window.
export function CanvasInk({
  strokes,
  surfW,
  surfH,
  toCanvasPoint,
  mode,
  tool,
  penColor,
  penWidth,
  onCommit,
  onErase
}: {
  strokes: CanvasStroke[]
  surfW: number
  surfH: number
  toCanvasPoint: ClientToCanvasPoint
  mode: DrawMode
  tool: StrokeKind
  penColor: string
  penWidth: number
  onCommit: (kind: StrokeKind, color: string, width: number, pts: number[]) => void
  onErase: (id: string) => void
}): React.JSX.Element {
  const [current, setCurrent] = useState<number[] | null>(null) // fractional flat pts being drawn now
  const draw = useRef<{ pts: number[]; move?: (e: MouseEvent) => void; up?: () => void } | null>(null)

  // Client px → home-basis fraction through the one live home-rect mapper shared by every gesture.
  const toFrac = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const p = toCanvasPoint(clientX, clientY)
      return [clampHorizonX(p.x), clampHorizonY(p.y)]
    },
    [toCanvasPoint]
  )

  const toAttr = (pts: number[]): string => {
    let s = ''
    for (let i = 0; i + 1 < pts.length; i += 2) s += `${pts[i] * surfW},${pts[i + 1] * surfH} `
    return s.trim()
  }

  const startDraw = useCallback(
    (e: React.MouseEvent): void => {
      if (mode !== 'draw') return
      e.preventDefault()
      const [fx, fy] = toFrac(e.clientX, e.clientY)
      const twoPoint = TWO_POINT_KINDS.includes(tool)
      const pts = twoPoint ? [fx, fy, fx, fy] : [fx, fy]
      setCurrent(pts)
      if (draw.current?.move) window.removeEventListener('mousemove', draw.current.move)
      if (draw.current?.up) window.removeEventListener('mouseup', draw.current.up)
      const move = (ev: MouseEvent): void => {
        // Released over a <webview> swallows the mouseup — buttons===0 → commit/tear down the stroke.
        if (ev.buttons === 0) return up()
        const n = draw.current?.pts
        if (!n) return
        const [nx, ny] = toFrac(ev.clientX, ev.clientY)
        if (twoPoint) {
          // Arrow/rect/ellipse are one start→end drag: keep the start, track the end (no throttle).
          n[2] = nx
          n[3] = ny
          setCurrent([...n])
          return
        }
        // Freehand throttle: skip a point closer than ~2px to the last, to keep stroke arrays small.
        const lx = n[n.length - 2]
        const ly = n[n.length - 1]
        if (Math.abs(nx - lx) * surfW < 2 && Math.abs(ny - ly) * surfH < 2) return
        n.push(nx, ny)
        setCurrent([...n])
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        const final = draw.current?.pts ?? []
        draw.current = null
        setCurrent(null)
        if (twoPoint) {
          // Discard a click-with-no-drag shape (would render as a dot/zero-size box).
          const dx = (final[2] - final[0]) * surfW
          const dy = (final[3] - final[1]) * surfH
          if (final.length >= 4 && Math.hypot(dx, dy) > 4) {
            onCommit(tool, penColor, penWidth, [final[0], final[1], final[2], final[3]])
          }
        } else if (final.length >= 4) {
          onCommit(tool, penColor, penWidth, final)
        }
      }
      draw.current = { pts, move, up }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [mode, tool, penColor, penWidth, surfW, surfH, onCommit, toFrac]
  )

  useEffect(() => {
    return () => {
      if (draw.current?.move) window.removeEventListener('mousemove', draw.current.move)
      if (draw.current?.up) window.removeEventListener('mouseup', draw.current.up)
    }
  }, [])

  // Render one stroke by kind. `live` strokes (the in-progress preview) never get an erase handler.
  const renderStroke = (s: CanvasStroke, key: string, live = false): React.JSX.Element => {
    const erase = !live && mode === 'erase' ? () => onErase(s.id) : undefined
    if (s.kind === 'arrow' || s.kind === 'rect' || s.kind === 'ellipse') {
      const x0 = s.pts[0] * surfW
      const y0 = s.pts[1] * surfH
      const x1 = s.pts[2] * surfW
      const y1 = s.pts[3] * surfH
      if (s.kind === 'rect') {
        const r = rectFromPoints(x0, y0, x1, y1)
        return (
          <rect
            key={key}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={4}
            stroke={s.color}
            strokeWidth={s.width}
            fill="none"
            onMouseDown={erase}
          />
        )
      }
      if (s.kind === 'ellipse') {
        const r = rectFromPoints(x0, y0, x1, y1)
        return (
          <ellipse
            key={key}
            cx={r.x + r.w / 2}
            cy={r.y + r.h / 2}
            rx={r.w / 2}
            ry={r.h / 2}
            stroke={s.color}
            strokeWidth={s.width}
            fill="none"
            onMouseDown={erase}
          />
        )
      }
      const [w1, w2] = arrowHead(x0, y0, x1, y1, Math.max(9, s.width * 3))
      return (
        <g key={key} onMouseDown={erase}>
          <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" />
          <polygon points={`${x1},${y1} ${w1.x},${w1.y} ${w2.x},${w2.y}`} fill={s.color} />
        </g>
      )
    }
    const hl = s.kind === 'highlighter'
    return (
      <polyline
        key={key}
        points={toAttr(s.pts)}
        stroke={s.color}
        strokeWidth={hl ? s.width * 4 : s.width}
        opacity={hl ? 0.35 : 1}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        onMouseDown={erase}
      />
    )
  }

  return (
    <svg
      className={`free-ink${mode === 'draw' ? ' drawing' : ''}${mode === 'erase' ? ' erasing' : ''}`}
      style={{ left: HORIZON_MIN_X * surfW, top: 0 }}
      width={HORIZON_WIDTH_FRAC * surfW}
      height={HORIZON_HEIGHT_FRAC * surfH}
      viewBox={`${HORIZON_MIN_X * surfW} 0 ${HORIZON_WIDTH_FRAC * surfW} ${HORIZON_HEIGHT_FRAC * surfH}`}
      onMouseDown={startDraw}
    >
      {strokes.map((s) => renderStroke(s, s.id))}
      {current &&
        current.length >= 4 &&
        renderStroke({ id: '__live__', kind: tool, color: penColor, width: penWidth, pts: current }, '__live__', true)}
    </svg>
  )
}
